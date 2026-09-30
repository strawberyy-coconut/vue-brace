import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'

import * as core from '@vue/language-core'
import { describe, expect, it } from 'vitest'

import plugin from '../index.ts'

/** Instantiate the plugin the way language-core does, with only `modules` populated. */
function createInstance() {
  const factory = plugin as unknown as (ctx: { modules: Record<string, unknown> }) => any
  return factory({ modules: { '@vue/language-core': core } })
}

interface Located {
  content: string
  start: number
  end?: number
}

interface Loc {
  start: { offset: number }
  end: { offset: number }
}

/** Apply `visit` to every object in the tree, once. */
function walk(ast: unknown, visit: (node: Record<string, any>) => void): void {
  const seen = new Set<object>()
  const step = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const record = value as Record<string, any>
    visit(record)
    for (const key in record) step(record[key])
  }
  step(ast)
}

/** The compiled `v-for` element, if the template has one. */
function findVForNode(ast: unknown): Record<string, any> | undefined {
  let found: Record<string, any> | undefined
  walk(ast, (node) => {
    if (!found && node.parseResult?.source && node.loc?.source) found = node
  })
  return found
}

/**
 * Collect expression nodes carrying a source location. This AST generation records
 * positions on `loc` rather than a top-level `offset`, so that is what to look at.
 */
function collectExpressions(ast: unknown): Located[] {
  const found: Located[] = []
  walk(ast, (node) => {
    const loc = node.loc as { start?: { offset?: number }; end?: { offset?: number } } | undefined
    if (typeof node.content === 'string' && typeof loc?.start?.offset === 'number') {
      found.push({ content: node.content, start: loc.start.offset, end: loc.end?.offset })
    }
  })
  return found
}

const TEMPLATE = `<section>
  @if (ready.ok) {
    <p>{{ foo.bar }}</p>
  }
</section>`

function compile(template: string) {
  const errors: { message?: string }[] = []
  const result = createInstance().compileSFCTemplate!('brace', template, {
    onError: (error: { message?: string }) => errors.push(error),
    onWarn: () => {},
  }) as { ast: unknown } | undefined
  return { errors, result }
}

/**
 * The first directive with the given name — and argument, if one is given — anywhere in the AST.
 *
 * `#catch` is not a prop named `catch`: the compiler parses it as a *slot* directive whose
 * argument is `catch`, so the name to look for is `slot`.
 */
function findDirective(ast: unknown, name: string, arg?: string): Record<string, any> | undefined {
  let found: Record<string, any> | undefined
  walk(ast, (node) => {
    if (found || !Array.isArray(node.props)) return
    found = node.props.find(
      (candidate: any) =>
        candidate?.name === name &&
        (arg === undefined || candidate.arg?.content === arg || candidate.arg === arg),
    )
  })
  return found
}

describe('language plugin', () => {
  it('ignores templates in other languages', () => {
    const instance = createInstance()
    expect(instance.compileSFCTemplate!('html', '<p />', {})).toBeUndefined()
    expect(instance.compileSFCTemplate!('pug', 'p hi', {})).toBeUndefined()
  })

  /**
   * The point of the plugin: expression locations in the returned AST refer to the *brace*
   * source, so Volar reports diagnostics on the lines the author actually wrote rather
   * than into generated HTML.
   */
  it('reports expression locations in brace-source coordinates', () => {
    const { errors, result } = compile(TEMPLATE)
    expect(errors).toEqual([])

    const expressions = collectExpressions(result!.ast)
    const pointsAt = (token: string) =>
      expressions.some((e) => TEMPLATE.slice(e.start, e.start + token.length) === token)

    // The interpolation sits on a line the transform passed through untouched.
    expect(pointsAt('foo.bar')).toBe(true)
    // `@if (ready.ok) {` became `<template v-if="ready.ok">`, a different line length.
    expect(pointsAt('ready.ok')).toBe(true)
  })

  /**
   * A `@for` line is rewritten into several fragments (`v-for`, `:key`, and the item
   * binding), so each one needs its own mapping. A single shift per line used to make
   * everything but the first fragment point a few characters off, which is what stopped
   * hover and go-to-definition from resolving bindings outside an `@if` line.
   */
  it('maps each fragment of a rewritten @for line separately', () => {
    const template = `<section>
  @for (item of items; index i; key item.id) {
    <p>{{ item.title }}</p>
  }
</section>`
    const { errors, result } = compile(template)
    expect(errors).toEqual([])

    const expressions = collectExpressions(result!.ast)
    const pointsAt = (token: string) =>
      expressions.some((e) => template.slice(e.start, e.start + token.length) === token)

    expect(pointsAt('items')).toBe(true)
    expect(pointsAt('item.id')).toBe(true)
    expect(pointsAt('item.title')).toBe(true)

    // A wrong end offset would make hover highlight the wrong span and put diagnostics on
    // the wrong characters, so assert the whole range, not just where it starts.
    const keys = expressions.find((e) => e.content === 'item.id')
    expect(keys?.end).toBe(keys!.start + 'item.id'.length)
  })

  it('turns a malformed block into a diagnostic instead of throwing', () => {
    const { errors, result } = compile('@if (a) {')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('[@brace]')
    expect(result!.ast).toBeDefined()
  })

  /**
   * Volar rebuilds a `v-for`'s binding pattern by slicing the element's own text between
   * `value` and `index ?? key ?? value`, using offsets relative to the element
   * (`codegen/template/vFor.js`, `parseVForNode`). Two coordinate spaces meet there: the text is
   * the element's as parsed from the *generated* markup, while the offsets are remapped to the
   * author's — and the emitted pattern is only as long as the slice, so it maps onto exactly as
   * many source characters. Getting that wrong made the two bindings land on the wrong columns
   * (`index` was painted onto `of`, because the range was scaled down to seven characters).
   *
   * This replicates Volar's arithmetic, which is the only way to check any of it without a
   * language server.
   */
  it.each([
    ['@for (item of items) {', 'item'],
    ['@for (item of items; index i) {', 'item, i'],
    ['@for (item of items; index i; key item.id) {', 'item, i'],
    ['@for (item of items; key item.id) {', 'item'],
  ])('makes the v-for slice for %s produce a usable pattern', (head, expected) => {
    const template = `${head}\n  <p />\n}`
    const { errors, result } = compile(template)
    expect(errors).toEqual([])

    const node = findVForNode(result!.ast)
    expect(node, 'a v-for element in the compiled template').toBeDefined()

    const { value, index, key } = node!.parseResult as Record<string, { loc: Loc }>
    const names = [value!, index ?? key ?? value!].filter((name, i, all) => all.indexOf(name) === i)
    const last = names.at(-1)!
    // Exactly Volar's arithmetic.
    const start = value!.loc.start.offset - node!.loc.start.offset
    const end = last.loc.end.offset - node!.loc.start.offset

    // The slice has to read as a binding pattern; the padding is whitespace inside `[…]`.
    expect(node!.loc.source.slice(start, end).replace(/\s+/g, '')).toBe(
      expected.replace(/\s+/g, ''),
    )

    // The offsets must stay the author's, or the pattern is mapped onto other text: the slice
    // is the same length as the source region it maps onto, so each name has to sit at the
    // column the author typed it at.
    const expectedNames = expected.split(',').map((name) => name.trim())
    for (const [i, name] of names.entries()) {
      const text = expectedNames[i]!
      expect(template.slice(name.loc.start.offset, name.loc.end.offset)).toBe(text)
    }

    // So the slice and the source region it maps onto are the same length: that is what makes
    // the mapping 1:1 rather than scaled.
    expect(node!.loc.source.slice(start, end).length).toBe(end - start)

    // And the element's own range stays inside its line. Moving it by the generated delta put
    // it before the line start, which every other consumer reads as a source position.
    expect(node!.loc.start.offset).toBeGreaterThanOrEqual(0)
    expect(node!.loc.start.offset).toBeLessThanOrEqual(head.length)
  })

  /**
   * Volar's component-name semantic tokens (`vue-component-semantic-tokens` in the language
   * server) are computed as `loc.start.offset` plus `tag.length`, with a `+1` applied only when
   * `template.lang === 'html'`:
   *
   * ```js
   * let start = element.loc.start.offset
   * if (template.lang === 'html') start += 1
   * push({ start, length: element.tag.length })
   * ```
   *
   * So for any other lang the AST has to present elements whose `loc.start` is the tag *name*.
   * Ours followed the html convention (the `<`), which made the token cover `<FragileChil` — one
   * character wide of the name, with its last character left to the grammar's colour. This
   * emulates the provider's arithmetic, which is the only way to check it without an editor.
   */
  it('starts elements at their tag name, as Volar assumes when the lang is not html', () => {
    const findAllElementsByTag = (root: unknown, tag: string): Record<string, any>[] => {
      const found: Record<string, any>[] = []
      walk(root, (node) => {
        if (node.type === 1 && node.tag === tag) found.push(node)
      })
      return found
    }

    // A component inside every construct the demo uses, because a nested one is exactly where
    // this could silently miss: `@try` wraps its body in a synthesised `<template #default>`,
    // and `@if`/`@for` wrap theirs in `<template v-if>` / `<template v-for>`.
    const template = [
      `@if (ok) {`,
      `  <FragileChild :n="1" />`,
      `} @else {`,
      `  <AsyncChart :count="1" />`,
      `}`,
      `@for (item of items) {`,
      `  <FragileChild :n="item" />`,
      `} @empty {`,
      `  <FragileChild />`,
      `}`,
      `@try {`,
      `  <AsyncChart :count="2" />`,
      `} @catch (e) {`,
      `  <FragileChild :n="e" />`,
      `}`,
      `<p>plain</p>`,
    ].join('\n')

    const { errors, result } = compile(template)
    expect(errors).toEqual([])

    for (const tag of ['FragileChild', 'AsyncChart', 'p']) {
      const nodes = findAllElementsByTag(result!.ast, tag)
      expect(nodes.length, `a <${tag}> element`).toBeGreaterThan(0)
      for (const node of nodes) {
        const start = node.loc.start.offset as number
        // `lang` here is `brace`, so the provider adds nothing and uses `loc.start` directly:
        // the range it emits has to be exactly the tag, wherever the element sits.
        expect(template.slice(start, start + tag.length), `<${tag}> at ${start}`).toBe(tag)
      }
    }
  })

  it('declares a plugin API version language-core accepts', () => {
    // language-core's `validVersions` is [2, 2.1, 2.2]; a mismatch drops the plugin.
    expect((createInstance() as { version: number }).version).toBe(2.2)
  })

  /**
   * language-core resolves `vueCompilerOptions.plugins` entries with `require()` and calls
   * the resolved module itself as the factory, so the entry must be a callable CommonJS
   * module — see `index.cjs`.
   */
  it('is require-able and callable as language-core expects', () => {
    const require = createRequire(import.meta.url)
    const loaded = require('@cockernutx/language-plugin-brace')
    expect(typeof loaded).toBe('function')
  })

  /**
   * The entry point must hand Node a built file, never TypeScript source.
   *
   * Deno can `require()` `.ts`, so serving source appears to work here while failing in the
   * editor and in `vue-tsc`, which are Node processes. The failure is invisible: Volar
   * catches the `SyntaxError` and runs *without* the plugin, so every brace template quietly
   * loses brace syntax, hover and diagnostics. `deno task build` compiles it.
   */
  it('loads the compiled entry rather than TypeScript source', () => {
    const entry = readFileSync(new URL('../../index.cjs', import.meta.url), 'utf8')
    expect(entry).not.toMatch(/require\(['"][^'"]*\.ts['"]\)/)

    const built = new URL('../../dist/index.js', import.meta.url)
    expect(existsSync(built), 'dist/index.js is missing — run `deno task build`').toBe(
      true,
    )

    // A stale build is as bad as none: the editor would run yesterday's plugin.
    const sources = ['../../src/index.ts', '../../dist/index.js'].map((path) =>
      statSync(new URL(path, import.meta.url)),
    )
    expect(
      sources[1]!.mtimeMs,
      'dist/index.js is older than src/index.ts — run `deno task build`',
    ).toBeGreaterThanOrEqual(sources[0]!.mtimeMs)
  })

  /**
   * The built-in `vue-sfc-template` plugin only emits an embedded document for
   * `lang === 'html'`, so this is what gives the editor a virtual file for a brace
   * template — and therefore highlighting plus every in-template feature.
   */
  it('publishes the brace template as embedded code', () => {
    const instance = createInstance()
    const ir = {
      template: { lang: 'brace', content: '<p />', name: 'Fixture.vue' },
    }

    expect(instance.getEmbeddedCodes('Fixture.vue', ir)).toEqual([
      { id: 'template', lang: 'brace' },
    ])

    const embeddedFile = { id: 'template', content: [] as unknown[] }
    instance.resolveEmbeddedCode('Fixture.vue', ir, embeddedFile)
    expect(embeddedFile.content).toHaveLength(1)
    expect(embeddedFile.content[0]).toEqual(['<p />', 'Fixture.vue', 0, core.codeFeatures.full])
  })

  it('leaves html templates to the built-in plugin', () => {
    const instance = createInstance()
    const ir = { template: { lang: 'html', content: '<p />', name: 'Fixture.vue' } }

    expect(instance.getEmbeddedCodes('Fixture.vue', ir)).toEqual([])

    const embeddedFile = { id: 'template', content: [] as unknown[] }
    instance.resolveEmbeddedCode('Fixture.vue', ir, embeddedFile)
    expect(embeddedFile.content).toEqual([])
  })

  /**
   * `@catch (e, retry)` becomes `#catch="[e, retry]"`, and the *start of that expression* is
   * what decides whether its bindings can be resolved.
   *
   * Volar rewrites a directive expression as a single mapping run anchored at
   * `exp.loc.start.offset`, so that one position places every binding inside it. The generated
   * `[` used to be emitted without a source anchor, which left the expression starting at the
   * *end* of the author's line: the names were parsed, typed and coloured correctly, yet
   * hovering them resolved past the line and found nothing — no hover, no go-to-definition.
   *
   * Anchoring the bracket on the author's `(` makes `[e, retry]` a character-for-character
   * stand-in for `(e, retry)`, which is why this assertion is on the parens rather than on the
   * names themselves: the names mapped correctly even while hover was broken.
   */
  it('anchors the @catch expression on the parens the author wrote', () => {
    const template = `@try {
  <Child />
} @catch (e, retry) {
  <p>{{ e.message }}</p>
  <button type="button" @click="retry">again</button>
}`
    const { errors, result } = compile(template)
    expect(errors).toEqual([])

    const prop = findDirective(result!.ast, 'slot', 'catch')
    expect(prop, 'a #catch slot').toBeDefined()

    const exp = prop!.exp as Loc & { content: string }
    expect(template.slice(exp.loc.start.offset, exp.loc.end.offset)).toBe('(e, retry)')

    // A directive's value stays an unparsed string here — Volar is what parses it, laying the
    // content out as one run over the mapped range. So the lengths have to agree for the names
    // to land on themselves, and they do: `[e, retry]` and `(e, retry)` are both ten
    // characters, which is what makes `e` → `e` and `retry` → `retry` fall out of the run.
    expect(exp.content).toBe('[e, retry]')
    expect(exp.content.length).toBe(exp.loc.end.offset - exp.loc.start.offset)
  })
})
