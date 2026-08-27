const pino = require('pino');

const base = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'china-cargo-bot' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

function normalize(args) {
  const error = args.find((item) => item instanceof Error);
  const rest = args.filter((item) => !(item instanceof Error));
  return { object: error ? { err: error } : {}, message: rest.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(' ') };
}

module.exports = {
  info: (...args) => { const v = normalize(args); base.info(v.object, v.message); },
  warn: (...args) => { const v = normalize(args); base.warn(v.object, v.message); },
  error: (...args) => { const v = normalize(args); base.error(v.object, v.message); },
};
