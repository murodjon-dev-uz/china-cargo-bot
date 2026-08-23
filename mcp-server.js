// MCP server exposing cargo-status tools to OpenClaw/Defender, so a manager
// can look up and change a shipment's status by chatting naturally instead
// of opening the Google Sheet or the china-cargo-bot's own /status command.
//
// Design constraints (see conversation with the business owner):
// - Status text is free-form, written/dictated by the AI assistant itself —
//   there is no fixed catalog of status codes. Whatever text is provided is
//   stored and shown to the client exactly as written, no inference, no
//   dropdown, nothing to keep in sync.
// - Writing a new status updates the DB immediately (so "Мои заявки" always
//   reflects the latest truth if a client checks), but deliberately does
//   NOT send an immediate push notification — the owner wants notifications
//   batched into the existing 09:00 digest, not one-off pings triggered by
//   ad-hoc Defender chats through the day.
// - Also appends an audit row to the "Трекинг" sheet tab and pre-marks it as
//   already processed (via sync_log), so the manager still sees a full
//   history in the spreadsheet and no other process double-applies or
//   double-notifies for a change Defender already made.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const config = require('./config');
const queries = require('./db/queries');
const sheets = require('./sheets');
const logger = require('./lib/logger');
const { formatDateRu, formatDateTimeRu } = require('./lib/format');

const server = new McpServer({ name: 'china-cargo-status', version: '1.0.0' });

server.registerTool(
  'lookup_cargo_status',
  {
    title: 'Посмотреть статус груза',
    description:
      'Возвращает текущий статус, маршрут, груз, ETA и полную историю по номеру заявки China Cargo (например, CL-001).',
    inputSchema: { order_number: z.string().describe('Номер заявки, например CL-001') },
  },
  async ({ order_number }) => {
    const order = queries.findOrder(order_number);
    if (!order) {
      return { content: [{ type: 'text', text: `Заявка ${order_number} не найдена.` }] };
    }
    const history = queries.getOrderHistory(order_number);
    const lines = [
      `Заявка ${order.order_number}`,
      order.cargo_description ? `Груз: ${order.cargo_description}` : null,
      order.route ? `Маршрут: ${order.route}` : null,
      order.current_status ? `Статус: ${order.current_status}` : 'Статус: не задан',
      order.eta_date ? `ETA: ${formatDateRu(order.eta_date)}` : null,
      order.telegram_id ? `Клиент привязан (id ${order.telegram_id})` : 'Клиент ещё не привязан',
      '',
      'История:',
      ...history.map((h) => `${formatDateTimeRu(h.changed_at)} — ${h.status_text} [${h.source}]`),
    ].filter((l) => l !== null);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// Helper: find next empty (Status N, Date N) pair in tracking sheet
function numberToColumn(num) {
  let col = '';
  while (num > 0) {
    num--;
    col = String.fromCharCode(65 + (num % 26)) + col;
    num = Math.floor(num / 26);
  }
  return col;
}

server.registerTool(
  'set_cargo_status',
  {
    title: 'Добавить статус груза',
    description:
      'Добавляет новый статус в таблицу "Трекинг". Принимает свободный текст сообщения для клиента ' +
      '(например «Груз на границе, ожидает таможенного оформления»). Текст сохраняется и показывается клиенту как есть — ' +
      'никакой кодировки/каталога статусов нет. ' +
      'ВСЕГДА сначала подтверди у менеджера точный номер заявки и текст сообщения словами — отменить рассылку потом нельзя. ' +
      'Статус применяется в базе сразу, клиент увидит в «Мои заявки» сразу, уведомление в дайджесте 09:00.',
    inputSchema: {
      order_number: z.string().describe('Номер заявки, например CL-001'),
      message: z.string().describe('Текст сообщения для клиента, описывающий текущий статус'),
    },
  },
  async ({ order_number, message }) => {
    const order = queries.findOrder(order_number);
    if (!order) {
      return { content: [{ type: 'text', text: `Ошибка: заявка ${order_number} не найдена.` }], isError: true };
    }

    try {
      // Read tracking sheet to find next empty (Status N, Date N) pair
      const trackingRows = await sheets.readTab(config.sheets.trackingTab);
      const cargoRow = trackingRows.find((r) => r[config.sheets.orderNumberCol] === order_number);

      if (!cargoRow) {
        // First time: add cargo to tracking sheet
        await sheets.appendRow(config.sheets.trackingTab, [order_number]);
        trackingRows.push({ [config.sheets.orderNumberCol]: order_number });
      }

      // Find next empty pair (Status N, Date N)
      let colIndex = 2;
      let statusCol, dateCol, statusKey, dateKey;
      while (colIndex < 100) {
        statusCol = numberToColumn(colIndex);
        dateCol = numberToColumn(colIndex + 1);
        const pairNum = Math.floor((colIndex - 1) / 2) + 1;
        statusKey = `${config.sheets.statusColPrefix} ${pairNum}`;
        dateKey = `${config.sheets.dateColPrefix} ${pairNum}`;

        if (!cargoRow || !cargoRow[statusKey]) {
          break;
        }
        colIndex += 2;
      }

      // Add headers if first time
      const headerRow = trackingRows[0] || {};
      if (!headerRow[statusKey]) {
        await sheets.writeCell(config.sheets.trackingTab, 1, statusCol, statusKey);
        await sheets.writeCell(config.sheets.trackingTab, 1, dateCol, dateKey);
      }

      // Write status and date
      const rowNum = trackingRows.findIndex((r) => r[config.sheets.orderNumberCol] === order_number) + 2;
      const today = new Date().toISOString().split('T')[0];
      await sheets.writeCell(config.sheets.trackingTab, rowNum, statusCol, message);
      await sheets.writeCell(config.sheets.trackingTab, rowNum, dateCol, today);

      // Update DB
      if (!queries.hasSyncedBefore(order_number, message, null)) {
        queries.withTransaction(() => {
          queries.updateOrderStatus({ orderNumber: order_number, statusText: message, comment: null });
          queries.appendStatusHistory({ orderNumber: order_number, statusText: message, comment: null, source: 'openclaw_manager' });
          queries.recordSyncLog(order_number, message, null, 'applied');
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Статус добавлен для ${order_number}.\nКлиент увидит в «Мои заявки» сразу, уведомление в дайджесте 09:00.`,
          },
        ],
      };
    } catch (err) {
      logger.error('set_cargo_status failed', order_number, err.message);
      return { content: [{ type: 'text', text: `Ошибка: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  logger.error('MCP server failed to start', err);
  process.exit(1);
});
