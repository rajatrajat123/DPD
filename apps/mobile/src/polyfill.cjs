const util = require('util');
if (typeof util.styleText !== 'function') {
  util.styleText = (_format, text) => String(text);
}
