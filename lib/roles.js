const config = require('../config');

/**
 * Managers and the owner see every client's shipments and get a different
 * main menu. Lives here rather than in a handler so both the keyboard layer
 * and the handlers can ask without depending on each other.
 */
function isManager(telegramId) {
  return config.managerTelegramIds.includes(telegramId);
}

module.exports = { isManager };
