/**
 * `lang="brace"` → ordinary Vue template.
 *
 * Every delimiter sits alone on its line, and the transform is **one output line per input
 * line**. That invariant is load-bearing, not cosmetic: when a preprocessor runs,
 * `@vue/compiler-sfc` discards the descriptor's template AST and merges a line-only source
 * map, so preserving line count keeps template error locations pointing at the original
 * source.
 *
 * Line count alone is not enough to map *columns*, though. A rewritten line such as
 * `@for (item of items; index i; key item.id) {` produces several expressions
 * (`item`, `i`, `items`, `item.id`) that land at unrelated columns in the output, so each
 * line also records the source fragments it copied and where they ended up. Anything the
 * compiler synthesises — wrapper markup, delimiters — is absent from that list, and an
 * offset falling outside every segment belongs to generated-only text.
 */

export type Frame = { line: number } & (
  | { kind: 'if' }
  | {
      kind: 'for'
      /** The list the `@for` iterates; `@empty` hands it on, so it has to outlive the block. */
      list: Span
      /** Set by `@empty`: the block below is rendered by `BraceEmpty`, not by a `v-if`. */
      empty?: boolean
    }
  | { kind: 'try' }
  | { kind: 'switch'; expr: Span; first: boolean; open: boolean }
)

const OPENERS = {
  if: '@if',
  for: '@for',
  try: '@try',
  switch: '@switch',
} as const

const RE = {
  // block openers
  if: /^@if\s*\((.+)\)\s*\{\s*$/d,
  for: /^@for\s*\((.+)\)\s*\{\s*$/d,
  switch: /^@switch\s*\((.+)\)\s*\{\s*$/d,
  try: /^@try\s*\{\s*$/d,
  // block continuations
  elseIf: /^\}\s*@else\s+if\s*\((.+)\)\s*\{\s*$/d,
  else: /^\}\s*@else\s*\{\s*$/d,
  empty: /^\}\s*@empty\s*\{\s*$/d,
  pending: /^\}\s*@pending\s*\{\s*$/d,
  catch: /^\}\s*@catch(?:\s*\(([^)]*)\))?\s*\{\s*$/d,
  // switch arms
  case: /^@case\s+(.+):\s*\{\s*$/d,
  default: /^@default\s*:\s*\{\s*$/d,
  // misc
  close: /^\}\s*$/d,
  comment: /^\/\/\s?(.*)$/d,
} as const

/** A run of characters copied verbatim from the source line. */
export interface Segment {
  /** Offset within the generated line where this run starts. */
  gen: number
  /** Offset within the source line it was copied from. */
  src: number
  length: number
  /**
   * Source line this run came from, when it is not the line being compiled.
   *
   * A `@switch` scrutinee is written once but has to appear in every `@case` comparison,
   * so those copies point back at the `@switch` line. Without this, hovering the scrutinee
   * would have nothing to resolve against — the line it lives on emits no code of its own.
   */
  source?: number
}

/** Where one generated line came from. `lines[i]` describes output line `i + 1`. */
export interface LineMap {
  /** 1-based line in the original brace source. */
  source: number
  /**
   * Source runs copied into this line, in generated order. Offsets falling outside every
   * segment belong to synthesised markup (`<template v-if="`, `</template>`, `#catch="[e, retry]"`)
   * and have no source position of their own.
   */
  segments: Segment[]
}

export interface BraceCompileResult {
  code: string
  /** One entry per generated line, in order. */
  lines: LineMap[]
}

/** Compile brace template source to an ordinary Vue template. */
export function compileBrace(source: string): string {
  return compileBraceWithMap(source).code
}

/** Compile brace template source, also returning the generated → source line map. */
export function compileBraceWithMap(source: string): BraceCompileResult {
  const stack: Frame[] = []
  const lines: LineMap[] = []
  const sourceLines = source.split('\n')

  const out = sourceLines.map((line, i) => {
    const body = line.trimStart()
    const indent = line.slice(0, line.length - body.length)
    const text = body.trimEnd()
    let m: RegExpMatchArray | null

    let code = ''
    const segments: Segment[] = []

    /** Append compiler-synthesised text. */
    const lit = (s: string) => {
      code += s
    }

    /**
     * Append text and record where it came from, so the mapper can send it back.
     *
     * `s` is normally a run copied verbatim from the author's line, and `srcStart` is its own
     * column. It can also be *synthesised* text anchored to a column worth pointing at, which
     * is how `@catch`'s tuple brackets are mapped: they sit inside an expression Volar lays
     * out as one unit, so anchoring `[` on the author's `(` — with the parameter list copied
     * verbatim between the brackets — makes `#catch="[e, retry]"` character-for-character the
     * `(e, retry)` that was written, which is what lets the bindings resolve.
     *
     * A synthesised run with nothing to anchor to (`@empty`'s `!<list>.length`) is emitted
     * with `lit` and left to the mapper's end-of-line fallback instead; see that branch.
     */
    const copy = (s: string, srcStart: number, from = i + 1) => {
      segments.push({ gen: code.length, src: srcStart, length: s.length, source: from })
      code += s
    }

    const emit = () => {
      lines.push({ source: i + 1, segments })
      return code
    }

    /**
     * Abort with a located message.
     *
     * These errors are thrown from the preprocessor, so `compiler-sfc` reports them
     * verbatim — unlike template compile errors, whose locations go through `patchErrors`
     * (see `sfc.spec.ts`). Carrying the line here is therefore the only way a brace author
     * gets an accurate position for a malformed block.
     */
    const fail = (message: string): never => {
      throw new Error(`[@brace] ${message} (template line ${i + 1})`)
    }

    /** Source offset of capture `n`, relative to the whole line. */
    const at = (match: RegExpMatchArray, n: number): number =>
      indent.length + (indices(match)?.[n]?.[0] ?? fail('internal: missing capture index'))

    /**
     * The innermost open block, or a located failure.
     *
     * `?? fail(…)` is used rather than `if (!frame) fail(…)` because a call to a
     * `never`-returning function does not reliably narrow the caller: it does under Deno's
     * checker but not under `tsc`, and relying on it made this file fail to compile.
     */
    const topFrame = (message: string): Frame => stack.at(-1) ?? fail(message)

    /** The innermost open block, requiring it to be of `kind`. */
    const frameOf = <K extends Frame['kind']>(
      kind: K,
      message: string,
    ): Extract<Frame, { kind: K }> => {
      const frame = topFrame(message)
      if (frame.kind !== kind) fail(message)
      // The cast is unavoidable: TypeScript cannot correlate a generic `kind` with the
      // union member it selects.
      return frame as Extract<Frame, { kind: K }>
    }

    /* ---- openers ---- */

    if ((m = text.match(RE.if))) {
      stack.push({ kind: 'if', line: i + 1 })
      lit(`${indent}<template v-if="`)
      copy(m[1]!, at(m, 1))
      lit('">')
      return emit()
    }

    if ((m = text.match(RE.for))) {
      const spec = parseFor(m[1]!, at(m, 1), i + 1)
      stack.push({ kind: 'for', list: spec.list, line: i + 1 })

      lit(`${indent}<template v-for="`)
      if (spec.index) {
        lit('(')
        copy(spec.item.text, spec.item.offset)
        lit(', ')
        copy(spec.index.text, spec.index.offset)
        lit(')')
      } else {
        copy(spec.item.text, spec.item.offset)
      }
      lit(' in ')
      copy(spec.list.text, spec.list.offset)
      lit('"')
      if (spec.key) {
        lit(' :key="')
        copy(spec.key.text, spec.key.offset)
        lit('"')
      }
      lit('>')
      return emit()
    }

    if ((m = text.match(RE.switch))) {
      stack.push({
        kind: 'switch',
        expr: { text: m[1]!, offset: at(m, 1) },
        first: true,
        open: false,
        line: i + 1,
      })
      return emit() // nothing to emit: the @case arms become the v-if chain
    }

    if (RE.try.test(text)) {
      stack.push({ kind: 'try', line: i + 1 })
      lit(`${indent}<BraceTry><template #default>`)
      return emit()
    }

    /* ---- continuations ---- */

    if ((m = text.match(RE.elseIf))) {
      lit(`${indent}</template><template v-else-if="`)
      copy(m[1]!, at(m, 1))
      lit('">')
      return emit()
    }

    if (RE.else.test(text)) {
      lit(`${indent}</template><template v-else>`)
      return emit()
    }

    if (RE.empty.test(text)) {
      const frame = frameOf('for', '@empty must follow an @for block')
      // The emptiness test lives in `BraceEmpty`, not in the template. A synthesised condition
      // cannot be placed anywhere harmless: Volar highlights the identifiers in it and lays the
      // expression out from its own start, so `!<list>.length` recoloured ~13 characters of the
      // author's file wherever it was anchored. Passing the list as a prop removes the
      // synthesised expression entirely — `:list` is the author's own text, copied 1:1 and
      // attributed to the `@for` line it was written on, so every character maps to real text.
      frame.empty = true
      lit(`${indent}</template><BraceEmpty :list="`)
      copy(frame.list.text, frame.list.offset, frame.line)
      lit('">')
      return emit()
    }

    if (RE.pending.test(text)) {
      frameOf('try', '@pending must follow an @try block')
      // BraceTry wraps its default slot in <Suspense> whenever #pending is present.
      lit(`${indent}</template><template #pending>`)
      return emit()
    }

    if ((m = text.match(RE.catch))) {
      frameOf('try', '@catch must follow an @try block')
      const given = m[1]

      // The slot props arrive as a tuple and the author's names bind by position, so
      // `@catch (e, retry)` becomes `#catch="[e, retry]"`. Two details are load-bearing:
      //
      // 1. The parameter list is copied *verbatim* rather than rebuilt from the parsed names,
      //    so the generated text is character-for-character the author's list with the parens
      //    swapped for brackets. Rebuilding it normalised the spacing around the comma and
      //    shifted the names relative to the author's columns.
      // 2. The `[` is anchored on the author's `(`. Volar maps positions inside a directive
      //    expression as a single run starting from the expression, so anchoring the bracket on
      //    the paren lines every character of `[e, retry]` up with the matching character of
      //    `(e, retry)` — which is what lets hover and go-to-definition resolve `e` and `retry`
      //    to their binding. Emitted with `lit`, the bracket has no source position of its own,
      //    the mapper anchors the whole expression at the *end of the line*, and both names
      //    resolve past it: hovering them finds nothing at all.
      lit(`${indent}</template><template #catch="`)
      if (given === undefined) {
        // No names and so nothing to resolve; there is likewise no paren to anchor to.
        lit('[]">')
      } else {
        // Both brackets are anchored, on the author's parens. The opening one is what Volar's
        // single mapping run for the expression starts from — the position every character
        // after it is laid out from — and the closing one keeps the expression's *end* on the
        // `)` instead of one character short of it. The paren is taken from the text rather
        // than from the first name: `@catch ( e, retry )` is legitimate and would put the
        // anchor a character late.
        copy('[', indent.length + text.indexOf('('), i + 1)
        copy(given, at(m, 1))
        copy(']', indent.length + text.lastIndexOf(')'), i + 1)
        lit('">')
      }
      return emit()
    }

    /* ---- switch arms ---- */

    if ((m = text.match(RE.case))) {
      const frame = frameOf('switch', '@case must be inside @switch')
      const value = trimStart({ text: m[1]!, offset: at(m, 1) })

      // The scrutinee was written on the @switch line, so its copies point back there: that
      // is what gives `status` in `@switch (status)` somewhere to resolve for hover even
      // though its own line emits nothing.
      lit(`${indent}<template ${frame.first ? 'v-if' : 'v-else-if'}="`)
      copy(frame.expr.text, frame.expr.offset, frame.line)
      lit(' === ')
      copy(value.text, value.offset)
      lit('">')
      frame.open = true
      if (frame.first) frame.first = false
      return emit()
    }

    if (RE.default.test(text)) {
      const frame = frameOf('switch', '@default needs a preceding @case')
      if (frame.first) fail('@default needs a preceding @case')
      frame.open = true
      lit(`${indent}<template v-else>`)
      return emit()
    }

    /* ---- closers ---- */

    if (RE.close.test(text)) {
      const frame = stack.at(-1)

      if (frame?.kind === 'switch') {
        if (frame.open) {
          frame.open = false // closes the current @case body
          lit(`${indent}</template>`)
          return emit()
        }
        stack.pop() // closes the @switch itself
        return emit()
      }

      const open = topFrame('unexpected "}"')
      stack.pop()
      if (open.kind === 'try') {
        lit(`${indent}</template></BraceTry>`)
      } else if (open.kind === 'for' && open.empty) {
        // The `@empty` block renders through `BraceEmpty`, which is opened by that line and has
        // no inner `<template>` of its own — unlike `@try`, which opens `<template #default>`.
        lit(`${indent}</BraceEmpty>`)
      } else {
        lit(`${indent}</template>`)
      }
      return emit()
    }

    /* ---- passthrough ---- */

    if ((m = text.match(RE.comment))) {
      lit(`${indent}<!-- `)
      if (m[1]) copy(m[1], at(m, 1))
      lit(' -->')
      return emit()
    }

    if (!DYNAMIC_TAG.test(text)) {
      copy(line, 0) // untouched: the whole line maps
      return emit()
    }

    DYNAMIC_TAG.lastIndex = 0
    let cursor = 0
    for (const tag of text.matchAll(DYNAMIC_TAG)) {
      const start = tag.index

      if (start > cursor) copy(text.slice(cursor, start), indent.length + cursor)

      const [, prefix, expr, tail] = tag
      if (prefix === '</') {
        lit(`${indent}</component>`)
      } else {
        lit(`${indent}<component :is="`)
        copy(expr!, indent.length + start + prefix!.length + 1)
        lit('"')
        copy(tail!, indent.length + start + tag[0].length - tail!.length)
      }
      cursor = start + tag[0].length
    }
    if (cursor < text.length) copy(text.slice(cursor), indent.length + cursor)
    return emit()
  })

  if (stack.length) {
    const where = stack
      .map((f) => `${OPENERS[f.kind]} at template line ${f.line}`)
      .join(', ')
    throw new Error(`[@brace] ${stack.length} unclosed block(s): ${where}`)
  }
  return { code: out.join('\n'), lines }
}

/** `match.indices` needs the `d` flag; this keeps the typing civil. */
function indices(match: RegExpMatchArray): [number, number][] | undefined {
  return (match as unknown as { indices?: [number, number][] }).indices
}

interface Span {
  text: string
  offset: number
}

/** Split a `@for` clause on `;`, tracking each part's offset within the original line. */
function parts(spec: string, base: number): Span[] {
  const out: Span[] = []
  let start = 0
  for (let i = 0; i <= spec.length; i++) {
    if (i === spec.length || spec[i] === ';') {
      out.push({ text: spec.slice(start, i), offset: base + start })
      start = i + 1
    }
  }
  return out
}

/** Drop surrounding whitespace, recovering the trimmed text's own offset. */
function trimStart(span: Span): Span {
  const text = span.text.trim()
  return { text, offset: span.offset + (span.text.length - span.text.trimStart().length) }
}

/** Offset of capture `group` within a span. */
function capture(span: Span, re: RegExp, group: number): Span {
  const m = re.exec(span.text)
  if (!m) throw new Error(`[@brace] internal: ${re} did not match "${span.text}"`)
  return { text: m[group]!, offset: span.offset + (indices(m)?.[group]?.[0] ?? 0) }
}

function parseFor(spec: string, base: number, line: number) {
  const [head, ...mods] = parts(spec, base)
  const headSpan = trimStart(head!)

  if (!/^(?:const\s+)?[A-Za-z_$][\w$]*\s+of\s+[\s\S]+$/.test(headSpan.text)) {
    throw new Error(`[@brace] bad @for: "${spec}" (template line ${line})`)
  }

  const item = capture(headSpan, /^(?:const\s+)?([A-Za-z_$][\w$]*)\s+of\s+/d, 1)
  const list = capture(headSpan, /^(?:const\s+)?[A-Za-z_$][\w$]*\s+of\s+([\s\S]+)$/d, 1)

  let index: Span | undefined
  let key: Span | undefined
  for (const mod of mods) {
    const span = trimStart(mod)
    if (/^index\s+[A-Za-z_$][\w$]*$/.test(span.text)) {
      index = capture(span, /^index\s+([A-Za-z_$][\w$]*)$/d, 1)
      continue
    }
    if (/^key\s+[\s\S]+$/.test(span.text)) {
      key = capture(span, /^key\s+([\s\S]+)$/d, 1)
      continue
    }
    throw new Error(`[@brace] unknown @for clause: "${span.text}" (template line ${line})`)
  }

  return { item, list, index, key }
}

/**
 * `<{expr}>`, `<{expr} attr="x" />`, `</{expr}>` → `<component :is="expr" …>`
 *
 * The design doc's version of this used `<\{([^}]+)\}>`, which only matches when the brace
 * is immediately followed by `>`, so `<{as} class="panel">` was left untouched. Matching up
 * to the closing brace and copying the rest of the tag through handles attributed and
 * self-closing forms with the same rule.
 */
const DYNAMIC_TAG = /(<\/?)\{([^}]+)\}(\s*\/>|[^>]*>)/g
