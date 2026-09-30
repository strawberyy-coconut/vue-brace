import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  name: string
  publisher: string
  version: string
  contributes: {
    languages: { id: string; configuration?: string }[]
    grammars: {
      language?: string
      scopeName: string
      path: string
      injectTo?: string[]
      unbalancedBracketScopes: string[]
    }[]
  }
}

const braceGrammar = manifest.contributes.grammars.find(
  (grammar) => grammar.language === 'brace',
)
const vueSupport = manifest.contributes.grammars.find(
  (grammar) => grammar.scopeName === 'brace.vue-support',
)

/** Every `include` value anywhere in a grammar file. */
function collectIncludes(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found
  const record = value as Record<string, unknown>
  if (typeof record.include === 'string') found.push(record.include)
  for (const key in record) collectIncludes(record[key], found)
  return found
}

/**
 * The grammars this extension ships, plus their injection targets, as an include graph.
 *
 * Only whole-grammar includes count as edges. `text.html.vue#some-rule` pulls in a single
 * repository rule and cannot close a loop, but `text.html.vue` pulls in every root pattern.
 */
function buildGrammarGraph() {
  const edges = new Map<string, Set<string>>()
  const add = (from: string, to: string) => {
    if (!edges.has(from)) edges.set(from, new Set())
    edges.get(from)!.add(to)
  }

  for (const grammar of manifest.contributes.grammars) {
    const file = JSON.parse(
      readFileSync(new URL(`../..${grammar.path.slice(1)}`, import.meta.url), 'utf8'),
    ) as object
    for (const include of collectIncludes(file)) {
      if (!include.includes('#')) add(grammar.scopeName, include)
    }
    // `injectTo` means the target grammar gains this grammar's rules, so it is an edge in the
    // other direction — and the direction that made a whole-grammar include recursive.
    for (const target of grammar.injectTo ?? []) add(target, grammar.scopeName)
  }
  return edges
}

function findCycle(edges: Map<string, Set<string>>): string[] | undefined {
  const path: string[] = []
  const done = new Set<string>()

  const visit = (node: string): string[] | undefined => {
    if (path.includes(node)) return [...path.slice(path.indexOf(node)), node]
    if (done.has(node)) return undefined
    path.push(node)
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    path.pop()
    done.add(node)
    return undefined
  }

  for (const node of edges.keys()) {
    const cycle = visit(node)
    if (cycle) return cycle
  }
  return undefined
}

describe('extension manifest', () => {
  it('registers the brace language with a configuration', () => {
    const language = manifest.contributes.languages.find((l) => l.id === 'brace')
    expect(language).toBeDefined()
    expect(language!.configuration).toBe('./language-configuration.json')
  })

  /**
   * Volar maps an unknown template `lang` straight through (`resolveCommonLanguageId`
   * in language-core returns the lang unchanged), so the embedded document for a brace
   * block is language id `brace`. This grammar is what VS Code then tokenizes it with.
   */
  it('binds the grammar to the brace language', () => {
    expect(braceGrammar).toEqual({
      language: 'brace',
      scopeName: 'text.html.brace',
      path: './syntaxes/brace.tmLanguage.json',
      unbalancedBracketScopes: [
        'punctuation.section.block.begin.brace',
        'punctuation.section.block.end.brace',
        'punctuation.section.embedded.begin.brace',
        'punctuation.section.embedded.end.brace',
        'punctuation.definition.interpolation.begin.brace',
        'punctuation.definition.interpolation.end.brace',
      ],
    })
  })

  /**
   * A block delimiter is deliberately unbalanced: `@if (x) {` opens a brace that closes
   * several lines later. VS Code highlights brackets it cannot match, so without this every
   * delimiter would be coloured as an error.
   */
  it('exempts the block delimiters from unbalanced-bracket colouring', () => {
    const grammar = readFileSync(
      new URL('../../syntaxes/brace.tmLanguage.json', import.meta.url),
      'utf8',
    )
    expect(braceGrammar!.unbalancedBracketScopes.length).toBeGreaterThan(0)
    for (const scope of braceGrammar!.unbalancedBracketScopes) {
      expect(grammar).toContain(scope)
    }
  })

  /**
   * Volar only injects `vue.directives` into `text.html.vue`, `text.html.markdown`,
   * `text.html.derivative` and `text.pug`, so without this the demo's `@click` and `:count`
   * would render as plain HTML attributes.
   */
  it('injects Vue syntax into the brace scope', () => {
    expect(vueSupport).toBeDefined()
    expect(vueSupport!.injectTo).toEqual(['text.html.brace'])
  })

  /**
   * Measured, not assumed: adding `{ include: 'vue.interpolations' }` here changes nothing —
   * `{{` still resolves to the brace grammar's own interpolation rule, because Volar's
   * interpolation patterns are written for scopes it injects into itself. Leaving the
   * include in would look like it does something, so the test pins its absence and the
   * brace grammar owns `{{ … }}` (`grammar.spec.ts` covers that).
   */
  it('does not pretend to inherit interpolation from Volar', () => {
    const file = JSON.parse(
      readFileSync(new URL('../../syntaxes/brace.vue-support.json', import.meta.url), 'utf8'),
    ) as { patterns: { include: string }[] }
    expect(file.patterns).toContainEqual({ include: 'vue.directives' })
    expect(file.patterns.some((p) => p.include.includes('interpolations'))).toBe(false)
  })

  /**
   * A whole-grammar include that closes a loop through an injection silently costs *all*
   * markup scoping, which looks like "the highlighting is completely broken" rather than
   * like a mistake in a grammar file.
   *
   * It happened: `text.html.brace` included `text.html.vue`, and the block rule is injected
   * into `text.html.vue`, so the brace grammar was reachable from itself. Repository includes
   * (`text.html.vue#capitalized-tag`) are fine — they pull in one rule, not the root.
   */
  it('keeps its include and injection graph acyclic', () => {
    const cycle = findCycle(buildGrammarGraph())
    expect(cycle, cycle && `grammar include cycle: ${cycle.join(' → ')}`).toBeUndefined()
  })

  it('is named so VS Code can install it from a folder', () => {
    // VS Code keys the extensions directory on `<publisher>.<name>-<version>`, so the folder name
    // documented in the README has to stay derived from these fields. A mismatch loads nothing and
    // reports nothing: the grammar simply never appears.
    expect(manifest.publisher).toBe('cockernutx')
    expect(manifest.name).toBe('vscode-vue-brace')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)

    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    expect(readme).toContain(`${manifest.publisher}.${manifest.name}-${manifest.version}`)
  })

  /**
   * A malformed grammar file fails silently in VS Code — the language simply stops being
   * highlighted — so parse every declared path and check it agrees with the manifest.
   */
  it.each(manifest.contributes.grammars)(
    'grammar $scopeName exists and is well formed',
    (grammar) => {
      const file = JSON.parse(
        readFileSync(new URL(`../..${grammar.path.slice(1)}`, import.meta.url), 'utf8'),
      ) as { scopeName?: string; patterns?: unknown[] }
      expect(file.scopeName).toBe(grammar.scopeName)
      expect(Array.isArray(file.patterns)).toBe(true)
    },
  )
})
