/**
 * Print the token scopes — and optionally the colours — a `lang="brace"` template gets from
 * the real VS Code pipeline.
 *
 * The brace block inside a `.vue` file is highlighted by injecting this extension's rules
 * into Vue.volar's `text.html.vue` grammar, which is easy to get subtly wrong and hard to see
 * by squinting at the editor. This script reproduces the pipeline headlessly and prints one
 * line per token.
 *
 * Scopes alone are not the whole story: a scope nothing matches renders as plain text, and the
 * theme decides that. Pass `--theme` with a VS Code theme JSON to see the resolved colour —
 * without it the report only tells you about *scopes*.
 *
 * Usage: `deno run -A scripts/dump-scopes.ts [path/to/File.vue] [--all] [--theme theme.json]`
 *
 * By default only lines that look suspicious are shown: tokens that fall back to Vue's
 * `text.html.derivative`, tokens scoped as though they were outside the brace block, and any
 * line the brace grammar declined to tokenize at all.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StateStack } from 'vscode-textmate'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// Both are CommonJS, and Deno's ESM interop only re-exports `default` for those.
const oniguruma = require('vscode-oniguruma') as typeof import('vscode-oniguruma')
const textmate = require('vscode-textmate') as typeof import('vscode-textmate')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

const defaultFile = resolve(here, '../../../playground/src/views/BraceView.vue')
// `indexOf` returns -1 when absent, so adding one unconditionally would swallow `Deno.args[0]`.
const themeIndex = Deno.args.indexOf('--theme')
const themePath = themeIndex < 0 ? undefined : Deno.args[themeIndex + 1]
const fileArg = Deno.args.find(
  (arg, i) => !arg.startsWith('--') && i !== themeIndex + 1,
)
const file = fileArg ?? defaultFile
const showAll = Deno.args.includes('--all')

/**
 * VS Code's built-in grammars (`html`, `typescript`, `css`…) ship inside the editor, not in a
 * dev container, so the markup and expressions may show no scopes at all. Drop copies in here
 * and the script picks them up — see the README for how to fetch them.
 */
const grammarsDir = Deno.env.get('BRACE_GRAMMARS') ?? '/tmp/vscode-grammars'
const builtinFiles: Record<string, string> = {
  'text.html.basic': 'html.tmLanguage.json',
  'text.html.derivative': 'html-derivative.tmLanguage.json',
  'source.ts': 'TypeScript.tmLanguage.json',
  'source.js': 'JavaScript.tmLanguage.json',
  'source.css': 'css.tmLanguage.json',
}
const stubbed: string[] = []

function findVolarGrammars(): string | undefined {
  const home = Deno.env.get('HOME')
  if (!home) return undefined
  for (const root of [join(home, '.vscode-server', 'extensions'), join(home, '.vscode', 'extensions')]) {
    if (!existsSync(root)) continue
    const dir = readdirSync(root).find((name) => name.startsWith('vue.volar-'))
    if (!dir) continue
    const syntaxes = join(root, dir, 'syntaxes')
    if (existsSync(join(syntaxes, 'vue.tmLanguage.json'))) return syntaxes
  }
  return undefined
}

/** Line ranges of the `<template lang="brace">` body, so only that block is reported. */
function templateBlock(source: string) {
  const lines = source.split('\n')
  const open = lines.findIndex((line) => /<template\b[^>]*\blang\s*=\s*["']brace["']/.test(line))
  if (open < 0) throw new Error(`no <template lang="brace"> block in ${file}`)
  const close = lines.findIndex((line, i) => i > open && /<\/template>/.test(line))
  return { lines, start: open + 1, end: close < 0 ? lines.length : close }
}

const volarSyntaxes = findVolarGrammars()
if (!volarSyntaxes) {
  console.error('Vue.volar is not installed; cannot reproduce the VS Code pipeline.')
  Deno.exit(1)
}

const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'))
await oniguruma.loadWASM(wasm.buffer as ArrayBuffer)

const vue = read(join(volarSyntaxes, 'vue.tmLanguage.json'))
const brace = read(resolve(here, '../syntaxes/brace.tmLanguage.json'))

/**
 * VS Code compiles injectable grammars into the target grammar's root patterns, so doing
 * the same here reproduces the real pipeline. This extension declares two injections:
 * the block rule into `text.html.vue`, and Vue's own directive rules into `text.html.brace`.
 */
const inject = (target: Record<string, unknown>, name: string) => {
  const { patterns } = read(resolve(here, `../syntaxes/${name}`)) as { patterns: unknown[] }
  target.patterns = [...patterns, ...(target.patterns as unknown[])]
}
inject(vue, 'brace.vue-block.json')
inject(brace, 'brace.vue-support.json')

const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s: string) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async (scopeName) => {
    if (scopeName === 'text.html.vue') return vue as never
    if (scopeName === 'text.html.brace') return brace as never
    // Vue.volar ships its injections as standalone grammars that include the rules by
    // repository reference (`text.html.vue#vue-directives`), so they resolve here too.
    const volarFile = {
      'vue.directives': 'vue-directives.json',
      'vue.interpolations': 'vue-interpolations.json',
    }[scopeName]
    if (volarFile) return read(join(volarSyntaxes, volarFile)) as never

    const builtin = builtinFiles[scopeName]
    if (builtin) {
      const path = join(grammarsDir, builtin)
      if (existsSync(path)) return read(path) as never
    }
    stubbed.push(scopeName)
    return { scopeName, patterns: [] } as never
  },
})

const theme = themePath ? read(themePath) : undefined
const themeMatcher = theme ? registry.setTheme(theme) : undefined
const colorMap = registry.getColorMap()

const grammar = (await registry.loadGrammar('text.html.vue'))!
const { lines, start, end } = templateBlock(readFileSync(file, 'utf8'))

let stack: StateStack = textmate.INITIAL
let flagged = 0
let reported = 0

// Tokenize the whole file: the block rule only begins when it sees the opening tag.
lines.forEach((line, i) => {
  const result = grammar.tokenizeLine(line, stack)
  stack = result.ruleStack
  if (i < start || i > end) return
  reported++

  const tokens = result.tokens
    .filter((token) => token.startIndex !== token.endIndex)
    .map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
      scope: token.scopes[token.scopes.length - 1]!,
    }))

  // Every token of a line inside the block should carry the block scope. Without it the
  // line escaped the brace grammar and is being highlighted as something else entirely.
  const escaped = tokens.some((token) => !token.scopes.includes('text.html.brace'))
  const suspicious = escaped && line.trim() !== ''
  if (suspicious) flagged++

  if (!showAll && !suspicious) return
  console.log(`${suspicious ? '⚠' : ' '} ${i + 1}: ${line}`)
  for (const token of tokens) {
    const colour = themeMatcher
      ? (colorMap[themeMatcher.match(token.scopes as never)?.foreground ?? 0] ?? '')
      : ''
    const label = colour ? `${colour} ${token.scope}` : token.scope
    console.log(`${' '.repeat(6)}${JSON.stringify(token.text).padEnd(24)} ${label}`)
  }
})

console.log(
  flagged === 0
    ? `\nAll ${reported} template lines tokenize inside text.html.brace.`
    : `\n${flagged} of ${reported} lines escaped the brace grammar (see ⚠ above).`,
)
if (stubbed.length) {
  const names = [...new Set(stubbed)].sort().join(', ')
  console.log(
    `\nStubbed grammars (not on disk, so their tokens show no scope): ${names}\n` +
      `Fetch them into ${grammarsDir} to see markup and expressions tokenize — see the README.`,
  )
}
if (!themePath) {
  console.log('No --theme given, so no colours are shown: a scope means nothing without one.')
}
