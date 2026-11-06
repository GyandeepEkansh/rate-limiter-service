/**
 * Fix for upstream ioredis-mock bug where time() uses Math.round() and hrtime() nanoseconds,
 * causing non-monotonic time jumps during Lua EVAL execution.
 */
const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'node_modules', 'ioredis-mock', 'lib', 'index.js');

if (fs.existsSync(targetPath)) {
  let content = fs.readFileSync(targetPath, 'utf8');
  if (content.includes('Math.round((/* @__PURE__ */ new Date()).getTime() / 1e3)')) {
    content = content.replace(
      'function time() {\n  return [\n    `${Math.round((/* @__PURE__ */ new Date()).getTime() / 1e3)}`,\n    `${Math.round(process.hrtime()[1] / 1e3)}`\n  ];\n}',
      'function time() {\n  const d = new Date().getTime();\n  return [\n    `${Math.floor(d / 1e3)}`,\n    `${(d % 1000) * 1000}`\n  ];\n}'
    );
    fs.writeFileSync(targetPath, content, 'utf8');
    console.log('[Setup] Applied monotonic clock patch to ioredis-mock.');
  }
}
