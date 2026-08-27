const crypto = require('node:crypto');
const { pool, withTransaction } = require('./db');
const { normalizePhone } = require('../lib/phone');

const STAGES = { AT_FACTORY: { emoji: '🏭', label: 'На заводе' }, IN_TRANSIT: { emoji: '🚚', label: 'В пути' }, DELIVERED: { emoji: '✅', label: 'Доставлен' } };
const DEFAULT_STAGE = 'AT_FACTORY';
const STAGE_BY_CELL_TEXT = Object.fromEntries(Object.entries(STAGES).map(([code, value]) => [`${value.emoji} ${value.label}`, code]));
const nowIso = () => new Date().toISOString();
const normalizeStage = (stage) => stage && (STAGES[stage] ? stage : STAGE_BY_CELL_TEXT[String(stage).trim()]) || null;
const getStageInfo = (stage) => STAGES[stage] || STAGES[DEFAULT_STAGE];
const contentHash = (statusText, comment) => crypto.createHash('sha256').update(`${statusText}|${comment || ''}`).digest('hex');
const runner = (client) => client || pool;

async function upsertClient({ telegramId, firstName }, client) {
  const now = nowIso();
  await runner(client).query(`INSERT INTO clients(telegram_id,first_name,first_seen_at,last_seen_at) VALUES($1,$2,$3,$3)
    ON CONFLICT(telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name,last_seen_at=EXCLUDED.last_seen_at`,
  [telegramId, firstName || null, now]);
}
async function getClient(telegramId, client) {
  return (await runner(client).query('SELECT * FROM clients WHERE telegram_id=$1', [telegramId])).rows[0];
}
async function setClientName(telegramId, fullName, client) {
  await runner(client).query("UPDATE clients SET full_name=$1,registration_state='AWAITING_PHONE',last_seen_at=$2 WHERE telegram_id=$3", [fullName, nowIso(), telegramId]);
}
async function completeClientRegistration(telegramId, phone, client) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Invalid phone number');
  const owner = (await runner(client).query('SELECT telegram_id FROM clients WHERE phone=$1 AND telegram_id<>$2 LIMIT 1', [normalized, telegramId])).rows[0];
  if (owner) {
    const error = new Error('Phone number is already registered');
    error.code = 'PHONE_IN_USE';
    error.ownerTelegramId = owner.telegram_id;
    error.phone = normalized;
    throw error;
  }
  await runner(client).query(`UPDATE clients SET phone=$1,registration_state='REGISTERED',registration_completed_at=$2,last_seen_at=$2 WHERE telegram_id=$3`, [normalized, nowIso(), telegramId]);
  return normalized;
}
async function createOrder(data, client) {
  const now = nowIso();
  await runner(client).query(`INSERT INTO orders(order_number,cargo_description,route,eta_date,current_status,telegram_id,client_name,bound_phone,stage,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, [data.orderNumber,data.cargoDescription||null,data.route||null,data.etaDate||null,data.currentStatus||null,data.telegramId||null,data.clientName||null,normalizePhone(data.boundPhone),normalizeStage(data.stage)||DEFAULT_STAGE,now]);
}
async function findOrder(orderNumber, client) { return (await runner(client).query('SELECT * FROM orders WHERE order_number=$1',[orderNumber])).rows[0]; }
async function updateOrder(data, client) { await runner(client).query('UPDATE orders SET cargo_description=$1,route=$2,eta_date=$3,client_name=$4,bound_phone=$5,updated_at=$6 WHERE order_number=$7',[data.cargoDescription,data.route,data.etaDate||null,data.clientName,normalizePhone(data.boundPhone),nowIso(),data.orderNumber]); }
async function upsertOrderMasterData(data, client) {
  const existing = await findOrder(data.orderNumber, client);
  const phone = normalizePhone(data.boundPhone);
  const boundClient = phone ? (await runner(client).query('SELECT * FROM clients WHERE phone=$1 LIMIT 1', [phone])).rows[0] : null;
  const telegramId = boundClient ? boundClient.telegram_id : null;
  if (!existing) { await createOrder({ ...data, telegramId }, client); return { created: true }; }
  await runner(client).query(`UPDATE orders SET cargo_description=$1,route=$2,eta_date=$3,client_name=$4,bound_phone=$5,telegram_id=$6,stage=$7,updated_at=$8 WHERE order_number=$9`,
    [data.cargoDescription,data.route,data.etaDate||null,data.clientName,phone,telegramId,normalizeStage(data.stage)||existing.stage,nowIso(),data.orderNumber]);
  return { created: false };
}
async function resolveClientBindings(client) {
  const db = runner(client);
  const now = nowIso();
  await db.query(`UPDATE orders o SET telegram_id=NULL,updated_at=$1
    WHERE telegram_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.telegram_id=o.telegram_id AND c.phone=o.bound_phone)`, [now]);
  return (await db.query(`UPDATE orders o SET telegram_id=c.telegram_id,updated_at=$1 FROM clients c
    WHERE o.bound_phone IS NOT NULL AND c.phone=o.bound_phone AND o.telegram_id IS DISTINCT FROM c.telegram_id`,[now])).rowCount;
}
async function updateOrderStatus(data, client) { await runner(client).query('UPDATE orders SET current_status=$1,current_comment=$2,updated_at=$3 WHERE order_number=$4',[data.statusText,data.comment||null,nowIso(),data.orderNumber]); }
async function listOrdersForClient(id) { return (await pool.query('SELECT * FROM orders WHERE telegram_id=$1 ORDER BY created_at DESC',[id])).rows; }
async function listActiveOrdersWithClients() { return (await pool.query("SELECT * FROM orders WHERE telegram_id IS NOT NULL AND stage!='DELIVERED' ORDER BY telegram_id")).rows; }
async function listAllOrdersForOverview() { return (await pool.query("SELECT * FROM orders ORDER BY COALESCE(client_name,''),telegram_id NULLS LAST,created_at")).rows; }
async function appendStatusHistory(data, client) { await runner(client).query('INSERT INTO status_history(order_number,status_text,comment,changed_at,source) VALUES($1,$2,$3,$4,$5)',[data.orderNumber,data.statusText,data.comment||null,nowIso(),data.source||'manual']); }
async function getOrderHistory(orderNumber) { return (await pool.query(`SELECT * FROM (SELECT h.*,ROW_NUMBER() OVER(PARTITION BY status_text ORDER BY changed_at DESC) rn FROM status_history h WHERE order_number=$1) x WHERE rn=1 ORDER BY changed_at`,[orderNumber])).rows; }
async function replaceSheetStatusHistory(orderNumber, statuses, client) {
  const db=runner(client); await db.query("DELETE FROM status_history WHERE order_number=$1 AND source='sheet_webhook'",[orderNumber]); let lastText=null;
  for(let i=0;i<statuses.length;i++){const s=statuses[i];if(!s.text)continue;const changedAt=s.date?new Date(new Date(s.date).getTime()+i*1000):new Date(Date.now()+i*1000);await db.query("INSERT INTO status_history(order_number,status_text,comment,changed_at,source) VALUES($1,$2,NULL,$3,'sheet_webhook')",[orderNumber,s.text,changedAt.toISOString()]);lastText=s.text;}
  await db.query('UPDATE orders SET current_status=$1,updated_at=$2 WHERE order_number=$3',[lastText,nowIso(),orderNumber]);
}
async function recordSyncLog(orderNumber,statusText,comment,result,client){await runner(client).query(`INSERT INTO sync_log(order_number,content_hash,processed_at,result) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[orderNumber,contentHash(statusText,comment),nowIso(),result]);}
async function hasSyncedBefore(orderNumber,statusText,comment){return (await pool.query('SELECT 1 FROM sync_log WHERE order_number=$1 AND content_hash=$2',[orderNumber,contentHash(statusText,comment)])).rowCount>0;}
async function claimDigestDate(date){return (await pool.query('INSERT INTO digest_log(digest_date,sent_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[date,nowIso()])).rowCount>0;}
async function recordDigestResult(date,clients,delivered){await pool.query('UPDATE digest_log SET clients=$1,delivered=$2,sent_at=$3 WHERE digest_date=$4',[clients,delivered,nowIso(),date]);}
async function releaseDigestDate(date){await pool.query('DELETE FROM digest_log WHERE digest_date=$1',[date]);}
async function recordManagerAction(data,client){await runner(client).query('INSERT INTO manager_actions_log(manager_telegram_id,order_number,new_status_text,comment,created_at) VALUES($1,$2,$3,$4,$5)',[data.managerTelegramId,data.orderNumber,data.statusText||null,data.comment||null,nowIso()]);}

module.exports={withTransaction,contentHash,upsertClient,getClient,setClientName,completeClientRegistration,createOrder,findOrder,updateOrder,upsertOrderMasterData,resolveClientBindings,updateOrderStatus,listOrdersForClient,listActiveOrdersWithClients,listAllOrdersForOverview,STAGES,getStageInfo,appendStatusHistory,getOrderHistory,replaceSheetStatusHistory,recordSyncLog,hasSyncedBefore,claimDigestDate,recordDigestResult,releaseDigestDate,recordManagerAction};
