import { describe, expect, it } from 'vitest'
import { compileTemplate } from 'vue/compiler-sfc'
import { compileBrace, compileBraceWithMap } from '../compile.ts'

/** The worked example from the package README, and the output it documents. */
const SHOP = `<section class="shop">
  @if (status === 'loading') {
    <p class="muted">Loading…</p>
  } @else if (!items.length) {
    <p class="muted">Nothing here yet.</p>
  } @else {
    <ul class="list">
      @for (item of items; index i; key item.id) {
        <li class="row">{{ i + 1 }} {{ item.title }}</li>
      } @empty {
        <li class="row muted">Sold out</li>
      }
    </ul>
  }
</section>`

const SHOP_OUT = `<section class="shop">
  <template v-if="status === 'loading'">
    <p class="muted">Loading…</p>
  </template><template v-else-if="!items.length">
    <p class="muted">Nothing here yet.</p>
  </template><template v-else>
    <ul class="list">
      <template v-for="(item, i) in items" :key="item.id">
        <li class="row">{{ i + 1 }} {{ item.title }}</li>
      </template><BraceEmpty :list="items">
        <li class="row muted">Sold out</li>
      </BraceEmpty>
    </ul>
  </template>
</section>`

const SWITCH = `@switch (status) {
  @case 'loading': {
    <p class="muted">Loading…</p>
  }
  @default: {
    <p>Unknown status.</p>
  }
}`

const SWITCH_OUT = `
  <template v-if="status === 'loading'">
    <p class="muted">Loading…</p>
  </template>
  <template v-else>
    <p>Unknown status.</p>
  </template>
`

const TRY = `@try {
  <UserProfile :id="userId" />
} @catch (e, retry) {
  <p class="err">{{ e.message }}</p>
  <button @click="retry">Try again</button>
}`

const TRY_OUT = `<BraceTry><template #default>
  <UserProfile :id="userId" />
</template><template #catch="[e, retry]">
  <p class="err">{{ e.message }}</p>
  <button @click="retry">Try again</button>
</template></BraceTry>`

const PENDING = `@try {
  <AsyncChart :data="data" />
} @pending {
  <p class="muted">Loading…</p>
}`

const PENDING_OUT = `<BraceTry><template #default>
  <AsyncChart :data="data" />
</template><template #pending>
  <p class="muted">Loading…</p>
</template></BraceTry>`

const DYNAMIC = `<{as} class="panel">
  <{Body} :item="item" />
</{as}>`

const DYNAMIC_OUT = `<component :is="as" class="panel">
  <component :is="Body" :item="item" />
</component>`

const COMMENT = `// Comments can sit between template children.
<a href="/">Home</a>
<p>Visit https://example.com for more</p>`

const COMMENT_OUT = `<!-- Comments can sit between template children. -->
<a href="/">Home</a>
<p>Visit https://example.com for more</p>`

const FIXTURES: [name: string, source: string, expected: string][] = [
  ['the documented shop example', SHOP, SHOP_OUT],
  ['@switch', SWITCH, SWITCH_OUT],
  ['@try / @catch', TRY, TRY_OUT],
  ['@try / @pending', PENDING, PENDING_OUT],
  ['dynamic tags', DYNAMIC, DYNAMIC_OUT],
  ['line comments', COMMENT, COMMENT_OUT],
]

describe('compileBrace', () => {
  it.each(FIXTURES)('compiles %s', (_name, source, expected) => {
    expect(compileBrace(source)).toBe(expected)
  })

  it('leaves a template with no brace syntax alone', () => {
    const plain = `<div class="a">\n  <span>{{ x }}</span>\n</div>`
    expect(compileBrace(plain)).toBe(plain)
  })

  it('nests blocks freely', () => {
    const source = `@if (a) {
  @for (x of xs; key x) {
    @if (x.ok) {
      <b>{{ x.n }}</b>
    } @else {
      <i>{{ x.n }}</i>
    }
  }
}`
    expect(compileBrace(source)).toBe(`<template v-if="a">
  <template v-for="x in xs" :key="x">
    <template v-if="x.ok">
      <b>{{ x.n }}</b>
    </template><template v-else>
      <i>{{ x.n }}</i>
    </template>
  </template>
</template>`)
  })

  it('binds @catch parameters positionally', () => {
    const slot = (spec: string) =>
      compileBrace(`@try {\n  <A />\n} @catch${spec} {\n  <B />\n}`)
        .split('\n')[2]
        ?.match(/#catch="([^"]*)"/)?.[1]

    // The author's own parameter list, copied verbatim between brackets, so the generated
    // text has the same shape and length as the source. Volar maps a directive expression as
    // one run, and the aliased object pattern this replaced (`{ error: e, reset: retry }`) is
    // ten characters longer than `(e, retry)`, which drifted every semantic token inside it
    // onto the surrounding markup.
    expect(slot('')).toBe('[]')
    expect(slot('(e)')).toBe('[e]')
    expect(slot('(e, retry)')).toBe('[e, retry]')
    expect(slot('(error, reset)')).toBe('[error, reset]')
  })

  it('treats the last colon on a @case line as the delimiter', () => {
    const out = compileBrace(`@switch (x) {
  @case { a: 1 }: {
    <p />
  }
  @default: {
    <p />
  }
}`)
    expect(out).toContain(`<template v-if="x === { a: 1 }">`)
  })

  it('allows a @for without index or key', () => {
    expect(compileBrace('@for (x of xs) {\n  <p />\n}')).toBe(
      '<template v-for="x in xs">\n  <p />\n</template>',
    )
  })
})

describe('error handling', () => {
  const throws = (source: string, message: string) =>
    expect(() => compileBrace(source)).toThrowError(message)

  it('rejects unclosed blocks', () => {
    throws('@if (x) {', '[@brace] 1 unclosed block(s)')
    throws('@if (x) {\n  <p />\n', '[@brace] 1 unclosed block(s)')
  })

  it('rejects a stray closing brace', () => {
    throws('}', '[@brace] unexpected "}"')
    throws('<p />\n}', '[@brace] unexpected "}"')
  })

  it('rejects misplaced continuations', () => {
    throws('} @empty {', '[@brace] @empty must follow an @for block')
    throws('@if (x) {\n} @empty {\n}', '[@brace] @empty must follow an @for block')
    throws('} @pending {', '[@brace] @pending must follow an @try block')
    throws('} @catch {', '[@brace] @catch must follow an @try block')
  })

  it('rejects misplaced switch arms', () => {
    throws('@case 1: {', '[@brace] @case must be inside @switch')
    throws('@if (x) {\n  @case 1: {\n}\n}', '[@brace] @case must be inside @switch')
    throws('@default: {', '[@brace] @default needs a preceding @case')
    throws('@switch (x) {\n  @default: {\n  }\n}', '[@brace] @default needs a preceding @case')
  })

  it('rejects malformed @for headers', () => {
    throws('@for (x in xs) {\n}', '[@brace] bad @for')
    throws('@for (x of xs; nope y) {\n}', '[@brace] unknown @for clause: "nope y"')
  })
})

describe('source mapping', () => {
  it('keeps one generated line per source line', () => {
    for (const [name, source] of FIXTURES) {
      const { code, lines } = compileBraceWithMap(source)
      const sourceLines = source.split('\n').length
      expect(lines.length, `${name}: line map length`).toBe(sourceLines)
      expect(code.split('\n').length, `${name}: output line count`).toBe(sourceLines)
    }
  })

  it('maps every source line to itself, in order', () => {
    const { lines } = compileBraceWithMap(SHOP)
    expect(lines.map((l) => l.source)).toEqual(
      Array.from({ length: SHOP.split('\n').length }, (_, i) => i + 1),
    )
  })

  it('records a whole-line segment for untouched lines', () => {
    const { lines } = compileBraceWithMap(SHOP)
    const sourceLines = SHOP.split('\n')

    expect(lines[0]).toEqual({
      source: 1,
      segments: [{ gen: 0, src: 0, length: sourceLines[0]!.length, source: 1 }],
    })
    expect(lines[8]!.segments).toEqual([
      { gen: 0, src: 0, length: sourceLines[8]!.length, source: 9 },
    ])
  })

  it('records one segment per expression on a rewritten line', () => {
    const { lines } = compileBraceWithMap(SHOP)
    const source = SHOP.split('\n')[7]! // @for (item of items; index i; key item.id) {

    expect(
      lines[7]!.segments.map((s) => source.slice(s.src, s.src + s.length)),
    ).toEqual(['item', 'i', 'items', 'item.id'])
  })

  it('records no segments for lines that are pure scaffolding', () => {
    const { lines } = compileBraceWithMap(SHOP)
    expect(lines[11]!.segments).toEqual([]) // } closing @for
    expect(lines[13]!.segments).toEqual([]) // } closing @if

    expect(compileBraceWithMap(SWITCH).lines[0]!.segments).toEqual([]) // @switch (status) {
    expect(compileBraceWithMap(TRY).lines[0]!.segments).toEqual([]) // @try {
  })

  /**
   * The `@switch` line emits no code of its own, so the only thing that can carry its
   * scrutinee back into the source is the copy each `@case` comparison makes of it.
   */
  it('attributes each @case comparison copy back to the @switch line', () => {
    const { code, lines } = compileBraceWithMap(SWITCH)
    const source = SWITCH.split('\n')
    const generated = code.split('\n')

    // The SWITCH fixture opens with `@switch (status) {`, then its first arm.
    const switchLine = source.findIndex((line) => line.includes('@switch')) + 1
    const caseLine = source.findIndex((line) => line.includes("@case 'loading'")) + 1
    expect([switchLine, caseLine]).toEqual([1, 2])

    const scrutinee = lines[caseLine - 1]!.segments.find((s) => s.source !== caseLine)
    expect(scrutinee).toBeDefined()
    expect(scrutinee!.source).toBe(switchLine)
    expect(source[switchLine - 1]!.slice(scrutinee!.src, scrutinee!.src + scrutinee!.length))
      .toBe('status')

    // …and it really is the text the generated comparison starts with.
    expect(generated[caseLine - 1]!.slice(scrutinee!.gen, scrutinee!.gen + 6)).toBe('status')
  })

  it('copies dynamic tag expressions and attributes out of the source', () => {
    const { lines } = compileBraceWithMap(DYNAMIC)
    const source = DYNAMIC.split('\n')[0]!

    expect(
      lines[0]!.segments.map((s) => source.slice(s.src, s.src + s.length)),
    ).toEqual(['as', ' class="panel">'])
  })
})

describe('generated output is valid Vue', () => {
  it.each(FIXTURES)('%s compiles without errors', (name, source) => {
    const { code } = compileBraceWithMap(source)
    const { errors } = compileTemplate({
      source: code,
      filename: `${name}.vue`,
      id: 'brace-test',
    })
    expect(errors.map(String)).toEqual([])
  })
})
