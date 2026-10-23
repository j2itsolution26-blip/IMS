// Integration suites call server modules directly, outside Next.js. Their
// `import 'server-only'` guard exists to keep them out of browser bundles,
// which a Node test process is not, so it resolves to the package's own
// empty module here (what Next.js does on the server).
const Module = require('node:module');
const path = require('node:path');

const empty = path.join(path.dirname(require.resolve('server-only')), 'empty.js');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return empty;
  return resolve.call(this, request, ...rest);
};
