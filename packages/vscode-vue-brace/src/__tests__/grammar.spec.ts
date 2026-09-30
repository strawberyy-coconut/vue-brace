import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'
import * as oniguruma from 'vscode-oniguruma'
import * as textmate from 'vscode-textmate'

const here = dirname(fileURLToPath(import.meta.url))
const grammarPath = resolve(here, '../../syntaxes/brace.tmLanguage.json')

let grammar: textmate.IGrammar

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'))
  await oniguruma.loadWASM(wasm.buffer as ArrayBuffer)

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'text.html.brace') {
        return JSON.parse(readFileSync(grammarPath, 'utf8'))
      }
      // `text.html.basic`, `source.js` and friends ship with VS Code. Stub them so the
      // includes resolve; the assertions below only concern brace-specific scopes.
      return { scopeName, patterns: [] }
    },
  })

  grammar = (await registry.loadGrammar('text.html.brace'))!
})

interface Token {
  text: string
  scope: string | undefined
}

function tokenize(line: string): Token[] {
  const result = grammar.tokenizeLine(line, textmate.INITIAL)
  return result.tokens.map((token) => ({
    text: line.slice(token.startIndex, token.endIndex),
    scope: token.scopes[token.scopes.length - 1],
  }))
}

/** The scope applied to the token whose text is exactly `text`. */
function scopeOf(line: string, text: string): string | undefined {
  return tokenize(line).find((token) => token.text === text)?.scope
}

describe('brace grammar', () => {
  it('scopes a block opener', () => {
    const line = '  @if (ready.ok) {'
    expect(scopeOf(line, '@')).toBe('punctuation.definition.keyword.brace')
    expect(scopeOf(line, 'if')).toBe('keyword.control.brace')
    expect(scopeOf(line, '{')).toBe('punctuation.section.block.begin.brace')
  })

  it.each(['for', 'switch', 'try'])('scopes @%s', (keyword) => {
    expect(scopeOf(`@${keyword} (x) {`, keyword)).toBe('keyword.control.brace')
  })

  /**
   * `index i` and `key item.id` are part of the `@for` syntax, not expression text. Scoping
   * them through the expression grammar highlighted them as TypeScript variables, which is
   * what "the highlighting is broken on the @for line" looked like.
   *
   * The bindings themselves are handled by the expression grammar, which is stubbed here —
   * `deno task scopes` is what shows those.
   */
  it('scopes the @for clauses as syntax, not as identifiers', () => {
    const line = '  @for (item of items; index i; key item.id) {'
    expect(scopeOf(line, 'index')).toBe('keyword.control.brace')
    expect(scopeOf(line, 'key')).toBe('keyword.control.brace')
    expect(scopeOf(line, '{')).toBe('punctuation.section.block.begin.brace')
  })

  it('scopes a @for without clauses', () => {
    const line = '  @for (item of items) {'
    expect(scopeOf(line, 'for')).toBe('keyword.control.brace')
    expect(scopeOf(line, '{')).toBe('punctuation.section.block.begin.brace')
  })

  it('scopes a continuation line', () => {
    const line = '  } @else if (!items.length) {'
    expect(scopeOf(line, '}')).toBe('punctuation.section.block.end.brace')
    expect(scopeOf(line, 'else')).toBe('keyword.control.brace')
    expect(scopeOf(line, 'if')).toBe('keyword.control.brace')
  })

  it.each(['else', 'empty', 'pending', 'catch'])('scopes } @%s {', (keyword) => {
    expect(scopeOf(`} @${keyword} {`, keyword)).toBe('keyword.control.brace')
  })

  it('scopes switch arms', () => {
    const line = "  @case 'loading': {"
    expect(scopeOf(line, 'case')).toBe('keyword.control.brace')
    expect(scopeOf(line, ':')).toBe('punctuation.separator.key-value.brace')
    expect(scopeOf('  @default: {', 'default')).toBe('keyword.control.brace')
  })

  it('scopes a block closer', () => {
    expect(scopeOf('  }', '}')).toBe('punctuation.section.block.end.brace')
    // The line is nothing but the closer (indentation aside).
    expect(tokenize('  }').filter((token) => token.text.trim())).toEqual([
      { text: '}', scope: 'punctuation.section.block.end.brace' },
    ])
  })

  it('scopes line comments and leaves URLs alone', () => {
    expect(scopeOf('// a note', '//')).toBe('punctuation.definition.comment.begin.brace')
    expect(scopeOf('// a note', ' a note')).toBe('comment.line.double-slash.brace')

    // Not anchored to a line start, so this stays text rather than becoming a comment.
    const url = tokenize('<p>Visit https://example.com for more</p>')
    expect(url.some((token) => token.scope?.startsWith('comment.line'))).toBe(false)
  })

  it('scopes dynamic tags', () => {
    const line = '<{as} class="panel">'
    expect(scopeOf(line, '{')).toBe('punctuation.section.embedded.begin.brace')
    expect(scopeOf(line, 'as')).toBeDefined()
    // The attributes are handed to Vue's own tag rules. `text.html.basic#attribute` and
    // `text.html.vue#vue-directives` ship with VS Code / Vue.volar rather than on disk, so
    // here they resolve to nothing; `vue-block.spec.ts` covers them with the real grammars.
    expect(scopeOf(line, ' class="panel"')).toBe('text.html.brace')

    expect(scopeOf('<{Body} :item="item" />', 'Body')).toBeDefined()
    expect(scopeOf('</{as}>', '>')).toBe('punctuation.definition.tag.end.brace')
  })

  it('scopes interpolation', () => {
    const line = '<li>{{ item.title }}</li>'
    expect(scopeOf(line, '{{')).toBe('punctuation.definition.interpolation.begin.brace')
    expect(scopeOf(line, '}}')).toBe('punctuation.definition.interpolation.end.brace')
  })

  /**
   * Vue declares its interpolations in `text.html.vue` but only injects them into
   * `text.html.derivative`, `text.html.markdown` and `text.pug` — never into a custom scope
   * like ours. This rule is therefore what highlights `{{ … }}` in a brace template, and it
   * must not be removed on the assumption that Volar provides one.
   */
  it('owns interpolation highlighting rather than inheriting it', () => {
    const grammar = JSON.parse(readFileSync(grammarPath, 'utf8')) as {
      repository: { 'brace-interpolation'?: unknown }
    }
    expect(grammar.repository['brace-interpolation']).toBeDefined()
  })

  /**
   * Expressions delegate to `source.ts#expression`, the same grammar Vue's directive and
   * interpolation rules use: TypeScript is a superset of JavaScript, so a template
   * expression highlights exactly as it does in a normal `<template>`.
   */
  it('delegates expressions to the same grammar Vue uses', () => {
    const grammar = JSON.parse(readFileSync(grammarPath, 'utf8')) as {
      repository: { 'brace-expression': { patterns: { include: string }[] } }
    }
    expect(grammar.repository['brace-expression'].patterns).toContainEqual({
      include: 'source.ts#expression',
    })
  })

  it('does not treat an unknown @word as a keyword', () => {
    expect(scopeOf('@nope (x) {', '@')).toBeUndefined()
  })
})
