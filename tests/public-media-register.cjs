// Next aliases this marker during its build. Standalone route tests run on the server.
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (specifier, ...args) {
  return resolve.call(this, specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier, ...args);
};
