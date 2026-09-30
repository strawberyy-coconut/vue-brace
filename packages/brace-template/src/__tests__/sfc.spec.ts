import { SourceMapConsumer } from 'source-map-js'
import { describe, expect, it } from 'vitest'
import { compileTemplate, parse } from 'vue/compiler-sfc'
import { bracePreprocessor } from '../preprocessor.ts'

/**
 * Drive a `lang="brace"` SFC through the real `compiler-sfc` pipeline, preprocessor
 * and all — the same path `@vitejs/plugin-vue` takes, minus Vite.
 */
function compileSfc(source: string) {
  const { descriptor, errors } = parse(source, {
    filename: 'Fixture.vue',
    sourceMap: true,
  })
  expect(errors).toEqual([])

  const template = descriptor.template!
  return compileTemplate({
    source: template.content,
    filename: 'Fixture.vue',
    id: 'fixture',
    get inMap() {
      return template.map
    },
    preprocessLang: template.lang,
    preprocessCustomRequire: () => bracePreprocessor,
  })
}

describe('compiler-sfc integration', () => {
  it('compiles a brace template through the preprocessor', () => {
    const result = compileSfc(`<template lang="brace">
<section>
  @if (a) {
    <p>{{ b }}</p>
  } @else {
    <p>none</p>
  }
</section>
</template>`)

    expect(result.errors.map(String)).toEqual([])
    expect(result.source).toContain('<template v-if="a">')
    expect(result.code).toContain('a')
    expect(result.code).toContain('b')
  })

  it('resolves the @try boundary as a component', () => {
    const result = compileSfc(`<template lang="brace">
@try {
  <Child />
} @catch (e, retry) {
  <p>{{ e.message }}</p>
}
</template>`)

    expect(result.errors.map(String)).toEqual([])
    expect(result.code).toContain('BraceTry')
  })

  /**
   * The reason `compileBrace` is line-preserving.
   *
   * When a preprocessor runs, `compiler-sfc` throws away the descriptor's template AST
   * and merges a *line-only* source map (`mapLines`). Because every generated line is
   * produced by exactly one source line, positions in the compiled render function
   * resolve back to the original brace source — line *and* column.
   */
  it('maps compiled code back to the original brace source', () => {
    const source = `<template lang="brace">
<section>
  @if (a) {
    <p>{{ foo.bar }}</p>
  }
</section>
</template>`
    const result = compileSfc(source)

    expect(result.map?.sources).toEqual(['Fixture.vue'])
    expect(result.map?.sourcesContent?.[0]).toBe(source)

    const lines = result.code.split('\n')
    const at = lines.findIndex((l) => l.includes('foo.bar'))
    const position = new SourceMapConsumer(result.map!).originalPositionFor({
      line: at + 1,
      column: lines[at]!.indexOf('foo.bar'),
    })

    expect(position.source).toBe('Fixture.vue')
    expect(position.line).toBe(4) // the `{{ foo.bar }}` line in the SFC
    expect(position.column).toBe(10) // 1-based column of `foo.bar`
  })

  /**
   * Brace syntax errors are thrown from the preprocessor, so `compiler-sfc` reports them
   * verbatim. Lines are relative to the template block, not the SFC.
   */
  it('locates brace syntax errors inside the template block', () => {
    const result = compileSfc(`<template lang="brace">
<section>
  @if (a) {
    <p>ok</p>
</section>
</template>`)

    expect(result.errors.length).toBe(1)
    const message = String(result.errors[0])
    expect(message).toContain('[@brace] 1 unclosed block(s)')
    // The template content starts with a newline, so `@if` is on its line 3.
    expect(message).toContain('@if at template line 3')
  })
})
