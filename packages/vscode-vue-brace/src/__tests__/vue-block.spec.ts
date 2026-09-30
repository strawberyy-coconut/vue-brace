import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'
import * as oniguruma from 'vscode-oniguruma'
import * as textmate from 'vscode-textmate'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

/**
 * Locate Vue.volar's shipped grammars. They are what VS Code actually uses to tokenize a
 * `.vue` file, so testing against them is the only way to reproduce the real pipeline.
 */
function findVolarGrammars(): string | undefined {
  const home = process.env.HOME
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

const volarSyntaxes = findVolarGrammars()

/** Tokenize a whole document line by line, carrying the rule stack. */
function createTokenize(grammar: textmate.IGrammar) {
  let stack: textmate.StateStack = textmate.INITIAL
  return function tokenize(line: string) {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    return result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
      scope: token.scopes[token.scopes.length - 1],
    }))
  }
}

const SFC = [
  '<script setup lang="ts">',
  'const ready = { ok: true }',
  '</script>',
  '',
  '<template lang="brace">',
  '  @if (ready.ok) {',
  '    <p class="muted">{{ ready.ok }}</p>',
  '    <{tag} class="panel" :data-id="tag" />',
  '  }',
  '</template>',
]

const TEMPLATE_LINE = SFC.indexOf('  @if (ready.ok) {')
const DYNAMIC_TAG_LINE = SFC.indexOf('    <{tag} class="panel" :data-id="tag" />')

async function createRegistry(inject: boolean) {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'))
  await oniguruma.loadWASM(wasm.buffer as ArrayBuffer)

  const vue = read(join(volarSyntaxes!, 'vue.tmLanguage.json'))
  const injection = read(resolve(here, '../../syntaxes/brace.vue-block.json'))

  if (inject) {
    // VS Code compiles injectable grammars into the target grammar's root patterns. Doing
    // the same here is what makes this a faithful reproduction rather than an approximation.
    vue.patterns = [
      ...(injection.patterns as unknown[]),
      ...(vue.patterns as unknown[]),
    ]
  }

  return new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'text.html.vue') return vue as never
      if (scopeName === 'text.html.brace') {
        return read(resolve(here, '../../syntaxes/brace.tmLanguage.json')) as never
      }
      // Vue's injections live in their own grammars and are referenced by scope name.
      const injection = {
        'vue.directives': 'vue-directives.json',
        'vue.interpolations': 'vue-interpolations.json',
      }[scopeName]
      if (injection) return read(join(volarSyntaxes!, injection)) as never
      // Ship with VS Code and are not present in this container; stubbed so includes resolve.
      return { scopeName, patterns: [] } as never
    },
  })
}

async function loadTokenizer(inject: boolean) {
  const registry = await createRegistry(inject)
  return createTokenize((await registry.loadGrammar('text.html.vue'))!)
}

/**
 * Skips when Vue.volar is not installed, so the suite still runs outside this container.
 */
const suite = volarSyntaxes ? describe : describe.skip

suite('brace block inside a .vue file', () => {
  let withoutInjection: ReturnType<typeof createTokenize>
  let withInjection: ReturnType<typeof createTokenize>

  beforeAll(async () => {
    withoutInjection = await loadTokenizer(false)
    withInjection = await loadTokenizer(true)
  })

  it('documents the bug: without the injection the block is plain HTML', () => {
    const lines = SFC.map((line) => withoutInjection(line))
    const tokens = lines[TEMPLATE_LINE]!

    // Neither the block scope nor the keyword scope shows up: this is the state that made
    // the editor look broken.
    expect(tokens.some((token) => token.scope === 'keyword.control.brace')).toBe(false)
    expect(tokens.some((token) => token.scopes.includes('text.html.brace'))).toBe(false)
  })

  it('hands the block to the brace grammar once injected', () => {
    const lines = SFC.map((line) => withInjection(line))
    const tokens = lines[TEMPLATE_LINE]!

    // `@` and the keyword are separate captures, as in the grammar's own tests.
    expect(tokens.find((token) => token.text === 'if')?.scope).toBe('keyword.control.brace')
    expect(tokens.find((token) => token.text === '@')?.scope).toBe(
      'punctuation.definition.keyword.brace',
    )
    expect(tokens.find((token) => token.text === '{')?.scope).toBe(
      'punctuation.section.block.begin.brace',
    )
  })

  it('scopes the block content as text.html.brace', () => {
    const lines = SFC.map((line) => withInjection(line))
    const inner = lines[TEMPLATE_LINE + 1]!
    expect(inner.some((token) => token.scopes.includes('text.html.brace'))).toBe(true)
  })

  it('leaves the script block alone', () => {
    const lines = SFC.map((line) => withInjection(line))
    expect(lines[1]!.some((token) => token.scopes.includes('text.html.brace'))).toBe(false)
  })

  it('treats a dynamic tag as a tag, not as a blob of attributes', () => {
    const lines = SFC.map((line) => withInjection(line))
    const tokens = lines[DYNAMIC_TAG_LINE]!
    const scopeOf = (text: string) => tokens.find((token) => token.text === text)?.scope

    expect(scopeOf('{')).toBe('punctuation.section.embedded.begin.brace')
    expect(scopeOf('}')).toBe('punctuation.section.embedded.end.brace')
    expect(tokens.some((token) => token.scopes.includes('text.html.brace'))).toBe(true)

    // `:data-id` proves the attributes go through Vue's directive rules. Plain attributes
    // are handled by `text.html.basic#attribute`, which is not on disk in this container.
    const shorthand = tokens.find((token) => token.text === ':')
    expect(shorthand?.scope).toBe('punctuation.attribute-shorthand.bind.html.vue')
    expect(shorthand?.scopes).toContain('meta.attribute.directive.vue')
    // The old rule scoped the whole tail as one opaque `meta.tag.attributes.brace` blob.
    expect(tokens.some((token) => token.scopes.includes('meta.tag.attributes.brace'))).toBe(false)
  })
})

/**
 * Markup inside a brace block has to be tokenized by Vue's template grammar, not by VS Code's
 * plain HTML one.
 *
 * `text.html.basic` scopes a component tag — `<FragileChild>`, any name without a hyphen —
 * as `invalid.illegal.unrecognized-tag.html`, so every component in a brace template was
 * painted with the theme's error colour. That is what "the highlighting is broken on a lot of
 * elements" looked like, and it is why the brace grammar includes `text.html.vue`.
 *
 * Tokenized with the brace grammar as the *document* grammar here, which is the faithful way
 * to test that include: reaching `text.html.brace` through an injection from `text.html.vue`
 * makes `text.html.vue` include itself, and `vscode-textmate` cannot reproduce that — it drops
 * the include, so the tags come back unscoped rather than wrong. VS Code compiles the rules
 * once, so the include resolves there.
 */
suite('markup inside a brace block', () => {
  it('scopes a component tag as a component rather than as an unrecognized tag', async () => {
    const registry = await createRegistry(false)
    const tokenize = createTokenize((await registry.loadGrammar('text.html.brace'))!)
    const tokens = tokenize('    <FragileChild :should-throw="fragile" />')

    expect(tokens.find((token) => token.text === 'FragileChild')?.scope).toBe(
      'entity.name.tag.FragileChild.html.vue',
    )
    expect(tokens.find((token) => token.text === '<')?.scope).toBe(
      'punctuation.definition.tag.begin.html.vue',
    )
    expect(
      tokens.some((token) => token.scopes.includes('invalid.illegal.unrecognized-tag.html')),
    ).toBe(false)

    // Directives ride along with Vue's own tag rules.
    expect(tokens.find((token) => token.text === ':')?.scopes).toContain(
      'meta.attribute.directive.vue',
    )
  })
})
