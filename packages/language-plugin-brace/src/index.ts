import type { CompilerError, RootNode } from '@vue/compiler-dom'
import type { VueLanguagePlugin } from '@vue/language-core'
import { compileBraceWithMap } from '@vue-brace/brace-template/compile'
import { createOffsetMapper, type OffsetMapper } from '@vue-brace/brace-template/mapper'
import { BRACE_LANG } from '@vue-brace/brace-template/preprocessor'

function asCompilerError(error: unknown): CompilerError {
  return {
    name: 'BraceCompileError',
    message: error instanceof Error ? error.message : String(error),
    code: 0,
  } as unknown as CompilerError
}

/**
 * Apply `visit` to every object in the tree, once.
 *
 * Every *object*, not every AST node: `remapOffsets` has to reach the `{ start, end }`
 * locations nested inside `loc`, which carry no `type` of their own, so the filter has to be
 * the callback's business.
 */
function walk(
  value: unknown,
  visit: (node: Record<string, any>) => void,
  seen = new Set<object>(),
): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  const record = value as Record<string, any>
  visit(record)
  for (const key in record) walk(record[key], visit, seen)
}

/**
 * Rewrite `offset` on every node of the tree, in place.
 *
 * The compiler's AST carries offsets on expression nodes and locations; Volar derives lines
 * and columns from them, so every one of them has to move into brace-source coordinates.
 */
function remapOffsets(value: unknown, toSourceOffset: OffsetMapper): void {
  walk(value, (node) => {
    if (typeof node.offset === 'number') node.offset = toSourceOffset(node.offset)
  })
}

/** A `v-for`'s binding pattern as Volar reads it — see `collectVForPatterns`. */
interface VForPattern {
  node: Record<string, any>
  value: Record<string, any>
  /** Each binding name, with the text to emit for it. */
  names: [Record<string, any>, string][]
}

/**
 * Point each element's `loc.start` at its tag name rather than at the `<`.
 *
 * Volar's component-name tokens (`vue-component-semantic-tokens` in the language server) compute
 * the range like this:
 *
 * ```js
 * let start = element.loc.start.offset
 * if (template.lang === 'html') start += 1          // skip the `<`
 * push({ start, length: element.tag.length })
 * ```
 *
 * So for `lang === 'html'` the AST is assumed to start an element at the `<` and the provider
 * compensates; for any other lang it takes `loc.start` to be the *name*. Our brace AST follows
 * the html convention, so the token came out covering `<FragileChil` — one character wide of the
 * name, leaving the last character to the grammar's colour. Volar's own mappings were exact
 * throughout, which is what made this look like a mapping bug on our side; it is a convention
 * mismatch in a branch keyed on the template's `lang`.
 *
 * Shifting by one keeps every other consumer working: `getElementTagOffsets` searches with
 * `indexOf(node.tag, node.loc.start.offset)`, and the name starts exactly at that position, so
 * the offset it returns is unchanged.
 */
function alignElementStartsToTagNames(ast: unknown): void {
  walk(ast, (node) => {
    if (node.type !== 1 || typeof node.tag !== 'string' || !node.loc?.start) return
    node.loc.start.offset += 1
  })
}

/**
 * A `v-for`'s binding pattern, as Volar reads it.
 *
 * `codegen/template/vFor.js` (`parseVForNode`) rebuilds the pattern by slicing the element's
 * own text between two offsets, relative to the element:
 *
 * ```js
 * node.loc.source.slice(value.loc.start.offset - node.loc.start.offset,
 *                       (index ?? key ?? value).loc.end.offset - node.loc.start.offset)
 * ```
 *
 * It then emits `for (const [<slice>] of …)` and maps the slice 1:1 onto the source range
 * `[value.loc.start, (index ?? key ?? value).loc.end)`. Two coordinate spaces meet here:
 *
 * - `loc.source` is the element's text as parsed from the *generated* markup, so it has to be
 *   read with **generated** offsets;
 * - the offsets themselves are remapped to **source** coordinates, because the same `loc` drives
 *   hover and navigation for the author's file.
 *
 * Reading the names with remapped offsets silently returned `"(it` instead of `item`. And
 * because the emitted pattern is only as long as the slice, the range it maps onto has to be
 * the author's clause — otherwise the two bindings land on the wrong columns (`index` used to
 * be mapped onto `of`, and the whole range was scaled down to seven characters).
 */
function collectVForPatterns(ast: unknown): VForPattern[] {
  const found: VForPattern[] = []
  walk(ast, (node) => {
    const parseResult = node.parseResult as
      | { value?: Record<string, any>; index?: Record<string, any>; key?: Record<string, any> }
      | undefined
    const { value, index, key } = parseResult ?? {}
    if (!value?.loc || !node.loc) return
    const last = index ?? key ?? value
    const pattern = node.loc.source as string
    if (typeof pattern !== 'string') return

    const relative = (offset: number) => offset - node.loc.start.offset
    const names = [value, last].filter((name, i, all) => all.indexOf(name) === i)
    found.push({
      node,
      value,
      names: names.map((name) => [
        name,
        pattern.slice(relative(name.loc.start.offset), relative(name.loc.end.offset)),
      ]),
    })
  })
  return found
}

/**
 * Give the element a source position, and build the pattern text Volar will slice out of it.
 *
 * The element is synthesised (`@for (…) {` becomes `<template v-for="(item, i) in …">`), so it
 * is anchored to the directive the author wrote. The names are then placed at the columns they
 * occupy in the author's clause, and the pattern is padded to the clause's length: the slice is
 * a valid binding pattern, and because it is exactly as long as the source range it maps onto,
 * each binding lands on the name that was typed. The padding is whitespace inside `[…]`, which
 * is legal and inert.
 */
function alignVForPatterns(patterns: VForPattern[], template: string): void {
  for (const { node, value, names } of patterns) {
    const sourceLineStart = template.lastIndexOf('\n', node.loc.end.offset as number) + 1
    const indent = /^[ \t]*/.exec(template.slice(sourceLineStart))?.[0].length ?? 0
    node.loc.start.offset = sourceLineStart + indent

    const end = (names.at(-1)![0].loc.end.offset as number) - node.loc.start.offset
    if (end <= 0) continue

    const chars = Array.from({ length: end }, () => ' ')
    for (const [name, text] of names) {
      const at = (name.loc.start.offset as number) - node.loc.start.offset
      if (at < 0) continue
      for (let i = 0; i < text.length && at + i < end; i += 1) chars[at + i] = text[i]!
    }
    // Separate the names, so the slice parses as a two-element binding pattern.
    if (names.length > 1) {
      chars[(value.loc.end.offset as number) - node.loc.start.offset] = ','
    }

    node.loc.source = chars.join('')
  }
}

/**
 * Volar plugin for `lang="brace"`.
 *
 * Volar only reaches a custom template language through `compileSFCTemplate`; without it
 * the brace source is handed to the HTML parser, so template expressions are never
 * type-checked. Wire it up with:
 *
 * ```jsonc
 * // tsconfig.json
 * { "vueCompilerOptions": { "plugins": ["@vue-brace/language-plugin-brace"] } }
 * ```
 */
const plugin: VueLanguagePlugin = ({ modules }) => {
  const { codeFeatures, compileTemplate } = modules['@vue/language-core']

  return {
    name: '@vue-brace/language-plugin-brace',
    // `validVersions` is [2, 2.1, 2.2]; anything else makes language-core drop the plugin
    // with only a console warning.
    version: 2.2,

    /**
     * language-core's built-in `vue-sfc-template` plugin only produces an embedded document
     * when `lang === 'html'`, so without this a brace template has no virtual file in the
     * editor at all: no highlighting, and no completions, hover, navigation or diagnostics
     * inside it.
     *
     * The content pushed in `resolveEmbeddedCode` is the *raw brace source*, which is
     * exactly the coordinate space the remapped AST uses — the two have to agree for any of
     * this to line up, and keeping them in step is why `compileBraceWithMap` exists.
     */
    getEmbeddedCodes(_fileName, ir) {
      const template = ir.template
      if (!template || template.lang !== BRACE_LANG) return []
      return [{ id: 'template', lang: BRACE_LANG }]
    },

    resolveEmbeddedCode(_fileName, ir, embeddedFile) {
      const template = ir.template
      if (embeddedFile.id !== 'template' || !template || template.lang !== BRACE_LANG) return
      embeddedFile.content.push([
        template.content,
        template.name,
        0,
        codeFeatures.full,
      ])
    },

    compileSFCTemplate(lang, template, options) {
      if (lang !== BRACE_LANG) return

      let compiled
      try {
        compiled = compileBraceWithMap(template)
      } catch (error) {
        // A malformed block must surface as a diagnostic, never as a dead language server.
        options.onError?.(asCompilerError(error))
        return { ast: compileTemplate('', options), code: '', preamble: '' }
      }

      const toSourceOffset = createOffsetMapper(template, compiled.code, compiled.lines)

      const remap = (error: CompilerError): CompilerError => {
        if (error.loc) {
          error.loc.start.offset = toSourceOffset(error.loc.start.offset)
          error.loc.end.offset = toSourceOffset(error.loc.end.offset)
        }
        return error
      }

      const ast: RootNode = compileTemplate(compiled.code, {
        ...options,
        onWarn: (warning) => options.onWarn?.(remap(warning)),
        onError: (error) => options.onError?.(remap(error)),
      })

      // The `v-for` pattern needs both coordinate spaces: the names are read from the generated
      // markup *before* the remap, and placed into the author's columns *after* it.
      const vForPatterns = collectVForPatterns(ast)
      remapOffsets(ast, toSourceOffset)
      // Volar's component-token provider reads an element's `loc.start` as its tag *name* for
      // any template whose lang is not `html` (see `alignElementStartsToTagNames`), so that has
      // to be true of the offsets we hand over — and after the remap, so the shift applies to a
      // source offset.
      alignElementStartsToTagNames(ast)
      alignVForPatterns(vForPatterns, template)

      return { ast, code: '', preamble: '' }
    },
  }
}

export default plugin
