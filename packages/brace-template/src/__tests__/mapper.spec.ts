import { describe, expect, it } from 'vitest'

import { compileBraceWithMap } from '../compile.ts'
import { createOffsetMapper } from '../mapper.ts'

/**
 * Map a position in the generated code back to the source, then read the source there.
 *
 * `genLine` is a 0-based index into the generated output, `genToken` a substring to locate
 * within it and `within` an extra column offset into that substring.
 */
function readMapped(source: string, genLine: number, genToken: string, within = 0, length?: number) {
  const { code, lines } = compileBraceWithMap(source)
  const toSourceOffset = createOffsetMapper(source, code, lines)

  const generatedLines = code.split('\n')
  const target = generatedLines[genLine]
  expect(target, `generated line ${genLine}`).toBeDefined()

  const column = target!.indexOf(genToken)
  expect(column, `"${genToken}" in generated line ${genLine}`).toBeGreaterThanOrEqual(0)

  const offset =
    generatedLines.slice(0, genLine).reduce((sum, line) => sum + line.length + 1, 0) +
    column +
    within
  const mapped = toSourceOffset(offset)

  const size = length ?? genToken.length - within
  return source.slice(mapped, mapped + size)
}

describe('createOffsetMapper', () => {
  it('maps untouched lines exactly', () => {
    const source = `<ul>\n  <li>{{ item.title }}</li>\n</ul>`
    expect(readMapped(source, 1, 'item.title')).toBe('item.title')
  })

  it('maps the expression inside an @if wrapper', () => {
    const source = `@if (foo.bar) {\n  <p />\n}`
    expect(readMapped(source, 0, 'foo.bar')).toBe('foo.bar')
  })

  it('maps the condition inside a @else if', () => {
    const source = `@if (a) {\n  <p />\n} @else if (ready.ok) {\n  <p />\n}`
    expect(readMapped(source, 2, 'ready.ok')).toBe('ready.ok')
  })

  /**
   * The regression that motivated per-fragment segments: four expressions on one line land
   * at unrelated columns, so a single column shift per line mapped three of them wrongly and
   * hover/go-to-definition silently stopped working on them.
   */
  describe('@for', () => {
    const source = `@for (item of items; index i; key item.id) {\n  <li>{{ item.title }}</li>\n}`
    const generated = `<template v-for="(item, i) in items" :key="item.id">`

    it('maps the item binding', () => {
      expect(readMapped(source, 0, '(item', 1)).toBe('item')
    })

    it('maps the index', () => {
      expect(readMapped(source, 0, ', i)', 2, 1)).toBe('i')
    })

    it('maps the list', () => {
      expect(readMapped(source, 0, 'items')).toBe('items')
    })

    it('maps the key expression', () => {
      expect(readMapped(source, 0, 'item.id')).toBe('item.id')
    })

    it('produces the expected wrapper', () => {
      expect(compileBraceWithMap(source).code.split('\n')[0]).toBe(generated)
    })

    /**
     * Ranges, not just positions: the end of a range lands one column *past* the last copied
     * character, so mapping only columns strictly inside a segment sent every range end back
     * to the start of the line. Hover then highlighted the wrong span and diagnostics drew
     * squiggles over unrelated text.
     */
    it('maps whole ranges, including the position after the last character', () => {
      const { code, lines } = compileBraceWithMap(source)
      const toSourceOffset = createOffsetMapper(source, code, lines)
      const line = code.split('\n')[0]!
      const lineStart = 0

      for (const token of ['items', 'item.id']) {
        const start = lineStart + line.indexOf(token)
        const end = start + token.length
        expect(source.slice(toSourceOffset(start), toSourceOffset(end))).toBe(token)
      }
    })
  })

  it('maps a @case value but not the switch scrutinee', () => {
    const source = `@switch (status) {\n  @case 'loading': {\n    <p />\n  }\n}`
    expect(readMapped(source, 1, `'loading'`)).toBe(`'loading'`)
  })

  /**
   * The scrutinee is written on the `@switch` line, which emits no code, so every `@case`
   * comparison copies it and attributes the copy to that line. Otherwise hovering `status`
   * had nothing to resolve against — `@switch` variables never produced a hover at all.
   */
  it('maps the switch scrutinee through the @case comparisons', () => {
    const source = `@switch (status) {\n  @case 'loading': {\n    <p />\n  }\n}`
    const { code, lines } = compileBraceWithMap(source)
    const toSourceOffset = createOffsetMapper(source, code, lines)
    const generated = code.split('\n')

    // `@switch` emits an empty line, so the comparison is the second generated line.
    const lineStart =
      generated[0]!.length + 1
    const start = lineStart + generated[1]!.indexOf('status')
    const end = start + 'status'.length
    expect(source.slice(toSourceOffset(start), toSourceOffset(end))).toBe('status')
  })

  /**
   * The `@catch` parameters are a positional copy, so each one maps to exactly where the
   * author wrote it — that is what keeps Volar's semantic tokens for them off the surrounding
   * markup.
   */
  it('maps @catch parameter names', () => {
    const source = `@try {\n  <Child />\n} @catch (e, retry) {\n  <p>{{ e.message }}</p>\n}`
    const { code, lines } = compileBraceWithMap(source)
    const toSourceOffset = createOffsetMapper(source, code, lines)

    const generated = code.split('\n')
    const line = generated[2]!
    const list = line.slice(line.indexOf('[') + 1, line.indexOf(']'))
    expect(list).toBe('e, retry')

    const listStart =
      generated.slice(0, 2).reduce((sum, text) => sum + text.length + 1, 0) + line.indexOf('[') + 1
    for (const name of ['e', 'retry']) {
      const start = listStart + list.indexOf(name)
      const end = start + name.length
      expect(source.slice(toSourceOffset(start), toSourceOffset(end))).toBe(name)
    }

    // The bracket is anchored on the author's `(` rather than left to `lit`. Volar maps a
    // directive expression as a single run *from its start*, so the synthesised `[` decides
    // where every character after it lands: unmapped, the mapper resolves the expression to the
    // end of the source line and the names above map only by luck of the copies underneath.
    // That is precisely the failure this anchor fixes — tokens were right, hover found nothing.
    expect(source[toSourceOffset(listStart - 1)]).toBe('(')
    // The closing bracket is anchored on the `)` for the same reason, and additionally keeps
    // the expression's *end* on the paren rather than one character short of it.
    expect(source[toSourceOffset(listStart + list.length)]).toBe(')')
  })

  /**
   * The anchor is the paren itself, not the character before the first name.
   *
   * `@catch ( e, retry )` is the same clause with breathing room, and an anchor derived from the
   * first parameter's offset would land one character late — on the space — shifting both names
   * with it and putting hover one column off what the author typed.
   */
  it('maps @catch parameters spaced inside the parens', () => {
    const source = `@try {\n  <Child />\n} @catch ( e, retry ) {\n  <p />\n}`
    const { code, lines } = compileBraceWithMap(source)
    const toSourceOffset = createOffsetMapper(source, code, lines)

    const generated = code.split('\n')
    const line = generated[2]!
    expect(line).toContain('#catch="[ e, retry ]"')

    const lineStart = generated.slice(0, 2).reduce((sum, text) => sum + text.length + 1, 0)
    const bracket = lineStart + line.indexOf('[')
    const inside = lineStart + line.indexOf(' e')
    const mapped = (offset: number, length: number) =>
      source.slice(toSourceOffset(offset), toSourceOffset(offset + length))

    expect(mapped(bracket, 1)).toBe('(')
    expect(mapped(inside + 1, 1)).toBe('e')
    expect(mapped(inside + 4, 5)).toBe('retry')
  })

  it('maps the expression and the attributes of a dynamic tag', () => {
    const source = `<{tag} class="panel">\n  <p />\n</{tag}>`
    // The generated line is `<component :is="tag" class="panel">`, so the closing quote
    // after `tag` is generated text and the source token is only three characters long.
    expect(readMapped(source, 0, '"tag"', 1, 3)).toBe('tag')
    expect(readMapped(source, 0, 'class="panel"')).toBe('class="panel"')
  })

  /**
   * Synthesised markup has no source counterpart, and *where* it is reported matters.
   *
   * It used to resolve to the start of the source line — but that is where the delimiter sits
   * (`} @pending {`), and Volar derives semantic tokens from the compiled template, so tokens
   * for scaffolding repainted those keywords: they came out as blue `property` text instead of
   * keywords. Reporting past the end of the line leaves them nowhere to land.
   */
  it('reports synthesised markup past the end of the source line', () => {
    const source = `<section>\n  @if (a) {\n    <p />\n  }\n</section>`
    const { code, lines } = compileBraceWithMap(source)
    const toSourceOffset = createOffsetMapper(source, code, lines)

    // The closer line is pure synthesised markup, so it has no source position of its own.
    const closerOffset = code.indexOf('</template>')
    const closerLine = source.split('\n')[3]!
    expect(toSourceOffset(closerOffset)).toBe(source.indexOf('  }') + closerLine.length)
    expect(toSourceOffset(closerOffset)).not.toBe(source.indexOf('  }'))
  })

  it('reports scaffolding after the last copied run on a mixed line', () => {
    // `} @empty {` becomes `</template><BraceEmpty :list="items">`: the list is copied — from the
    // `@for` line, where the author wrote it — and the closing `">` after it is synthesised, so
    // that resolves to the end of the copy rather than to the end of the `@empty` line.
    const source = `@for (item of items) {\n  <li />\n} @empty {\n  <li />\n}`
    const { code, lines } = compileBraceWithMap(source)
    const toSourceOffset = createOffsetMapper(source, code, lines)

    const generated = code.split('\n')
    const lineStart = generated.slice(0, 2).reduce((sum, line) => sum + line.length + 1, 0)
    const line = generated[2]!
    expect(line).toBe('</template><BraceEmpty :list="items">')

    // The list maps onto the `@for` line, not onto the `@empty` line it was copied into.
    const listStart = lineStart + line.indexOf('items')
    const written = source.indexOf('items')
    expect(source.slice(toSourceOffset(listStart), toSourceOffset(listStart + 5))).toBe('items')
    expect(toSourceOffset(listStart + 5)).toBe(written + 5)
    expect(toSourceOffset(lineStart + line.length)).toBe(written + 5)
  })

  it('returns the offset unchanged when the line is unknown', () => {
    expect(createOffsetMapper('a\nb', 'a\nb', [])(3)).toBe(3)
  })
})
