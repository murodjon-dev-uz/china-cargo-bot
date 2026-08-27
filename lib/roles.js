/**
 * Roles come from the spreadsheet, not from a list of Telegram IDs: a manager
 * logs in with their phone exactly like a client, and the "Менеджеры" tab is
 * what makes them a manager. Removing their row takes their access away on
 * the next message, same as for a client.
 *
 * The lookup itself happens once per update, in bot.js, and lands on
 * ctx.state.account — so this stays a synchronous read and every handler can
 * ask without another database round trip.
 */
function isManager(ctx) {
  return ctx?.state?.account?.role === 'manager';
}

module.exports = { isManager };
