// MCP server exposing cargo-status tools to OpenClaw/Defender, so a manager
// can look up and change a shipment's status by chatting naturally instead
// of opening the Google Sheet or the china-cargo-bot's own /status command.
//
// Design constraints (see conversation with the business owner):
// - Reuses the SAME validated status_catalog and the SAME SQLite DB as the
//   client-facing bot (no separate source of truth, no risk of an
//   AI-invented status code ever reaching a client).
// - Writing a new status updates the DB immediately (so "Мои заявки" always
//   reflects the latest truth if a client checks), but deliberately does
//   NOT send an immediate push notification — the owner wants notifications
//   batched into the existing 09:00 digest, not one-off pings triggered by
//   ad-hoc Defender chats through the day.
// - Also appends an audit row to the "Статусы для бота" sheet tab and
//   pre-marks it as already processed (via sync_log), so the manager still
//   sees a full history in the spreadsheet and the 02:30 nightly sync never
//   double-applies or double-notifies for a change Defender already made.
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
    const status = queries.getStatus(order.current_status_code);
    const history = queries.getOrderHistory(order_number);
    const lines = [
      `Заявка ${order.order_number}`,
      order.cargo_description ? `Груз: ${order.cargo_description}` : null,
      order.route ? `Маршрут: ${order.route}` : null,
      `Статус: ${status ? `${status.emoji || ''} ${status.label_ru}`.trim() : 'не задан'}`,
      order.current_comment ? `Комментарий: ${order.current_comment}` : null,
      order.eta_date ? `ETA: ${formatDateRu(order.eta_date)}` : null,
      order.telegram_id ? `Клиент привязан (id ${order.telegram_id})` : 'Клиент ещё не привязан',
      '',
      'История:',
      ...history.map(
        (h) => `${formatDateTimeRu(h.changed_at)} — ${h.emoji || ''} ${h.label_ru}${h.comment ? ` (${h.comment})` : ''} [${h.source}]`
      ),
    ].filter((l) => l !== null);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

server.registerTool(
  'list_cargo_statuses',
  {
    title: 'Список допустимых статусов',
    description: 'Возвращает список всех допустимых кодов статусов (используй перед set_cargo_status, чтобы выбрать точный код).',
    inputSchema: {},
  },
  async () => {
    const catalog = queries.listStatusCatalog();
    const lines = catalog.map((s) => `${s.code} — ${s.emoji || ''} ${s.label_ru}${s.is_final ? ' (финальный)' : ''}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

server.registerTool(
  'set_cargo_status',
  {
    title: 'Изменить статус груза',
    description:
      'Меняет текущий статус заявки. ВСЕГДА сначала подтверди у менеджера точный номер заявки, код статуса (из list_cargo_statuses) ' +
      'и текст комментария словами, прежде чем вызывать этот инструмент — отменить массовую рассылку клиенту потом нельзя. ' +
      'Статус применяется в базе сразу, но клиент получит уведомление только в ежедневном дайджесте в 09:00, не мгновенно.',
    inputSchema: {
      order_number: z.string().describe('Номер заявки, например CL-001'),
      status_code: z.string().describe('Код статуса строго из списка list_cargo_statuses, например AT_BORDER'),
      comment: z.string().optional().describe('Комментарий для клиента, необязательно'),
    },
  },
  async ({ order_number, status_code, comment }) => {
    const order = queries.findOrder(order_number);
    if (!order) {
      return { content: [{ type: 'text', text: `Ошибка: заявка ${order_number} не найдена. Ничего не изменено.` }], isError: true };
    }
    if (!queries.isValidStatusCode(status_code)) {
      const valid = queries.listStatusCatalog().map((s) => s.code).join(', ');
      return {
        content: [{ type: 'text', text: `Ошибка: неизвестный код статуса "${status_code}". Допустимые: ${valid}. Ничего не изменено.` }],
        isError: true,
      };
    }

    queries.withTransaction(() => {
      queries.updateOrderStatus({ orderNumber: order_number, statusCode: status_code, comment: comment || null });
      queries.appendStatusHistory({
        orderNumber: order_number,
        statusCode: status_code,
        comment: comment || null,
        source: 'openclaw_manager',
      });
      queries.recordSyncLog(order_number, status_code, comment || '', 'applied');
    });

    // Audit trail in the sheet + pre-mark processed so the 02:30 sync never
    // double-applies this (it checks sync_log before touching anything).
    try {
      await sheets.appendRow(config.sheets.statusesTab, [
        order_number,
        status_code,
        comment || '',
        `✅ via Defender ${formatDateTimeRu(new Date().toISOString())}`,
      ]);
    } catch (err) {
      logger.warn('set_cargo_status: sheet audit append failed (DB was still updated)', err.message);
    }

    const status = queries.getStatus(status_code);
    return {
      content: [
        {
          type: 'text',
          text:
            `Готово: ${order_number} → ${status.emoji || ''} ${status.label_ru}. ` +
            `Клиент увидит это сразу в «Мои заявки», а push-уведомление придёт в дайджесте 09:00 (или сейчас — не отправляется).`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  logger.error('MCP server failed to start', err);
  process.exit(1);
});
