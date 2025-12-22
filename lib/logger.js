const config = require('../config');

const IS_PRODUCTION = config.IS_PRODUCTION;

const logger = {
  log: (...args) => { if (!IS_PRODUCTION) {console.log(...args);} },
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  info: (...args) => { if (!IS_PRODUCTION) {console.log(...args);} }
};

module.exports = logger;
