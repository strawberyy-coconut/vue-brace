// Volar loads language plugins by resolving a specifier and calling `require()` on the
// result, with no `.default` unwrapping — see how `@vue/language-plugin-pug` ships as
// CommonJS.
//
// This file used to require `./src/index.ts`, which only works because Deno can `require()`
// TypeScript. The editor's language server and `vue-tsc` are Node processes, where that is a
// `SyntaxError`: Volar catches it and carries on without the plugin, so every brace template
// silently loses brace syntax, hover and diagnostics, and the only trace is a warning in the
// language server's output channel. `deno task build:plugin` compiles the plugin to `dist/`,
// which is what Node loads.
module.exports = require('./dist/index.js').default
