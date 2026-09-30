import type { LineMap, Segment } from './compile.ts'

/** Offsets at which each line of `text` starts; index 0 is line 1. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

export type OffsetMapper = (offset: number) => number

/**
 * Build a function mapping an offset in `generated` back into `source`.
 *
 * `lines[i]` describes generated line `i + 1` as the runs of source text that were copied
 * into it. Because each copied run knows both where it came from and where it landed, the
 * mapping is exact for every expression the author wrote — including several on one line,
 * as in `@for (item of items; index i; key item.id) {`, where the item binding, the index,
 * the list and the key all end up at unrelated columns.
 *
 * Offsets that fall outside every segment sit in synthesised markup (`<template v-if="`,
 * `</template>`, the `#catch="[e, retry]"` scaffolding). They resolve to the end of the nearest
 * copied run, or to the end of the source line when there is none — deliberately not the
 * start of the line, where the delimiter sits: Volar derives semantic tokens from the
 * compiled template, and tokens with no source counterpart used to land on `} @pending {` and
 * repaint those keywords.
 *
 * An offset exactly *at* the end of a segment counts as inside it. That position is not
 * decoration: it is where every range ends, so treating it as unmapped would send the end of
 * a hover range or a diagnostic back to the start of the line and underline the wrong text.
 */
export function createOffsetMapper(
  source: string,
  generated: string,
  lines: LineMap[],
): OffsetMapper {
  const sourceStarts = lineStarts(source)
  const sourceLines = source.split('\n')
  const generatedStarts = lineStarts(generated)

  return function toSourceOffset(offset: number): number {
    let low = 0
    let high = generatedStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (generatedStarts[mid]! <= offset) low = mid
      else high = mid - 1
    }

    const entry = lines[low]
    if (!entry) return offset

    const column = offset - generatedStarts[low]!
    // A segment may come from an earlier line — `@case` reuses the `@switch` scrutinee — so
    // resolve against the segment's own line rather than the generated line's.
    const origin = (segment: Segment) => sourceStarts[(segment.source ?? entry.source) - 1] ?? 0

    let closing: Segment | undefined
    for (const segment of entry.segments) {
      if (column >= segment.gen && column < segment.gen + segment.length) {
        return origin(segment) + segment.src + (column - segment.gen)
      }
      // One past the last copied character: the end of the range that covers this run.
      // Segments ascend, so keeping the last candidate finds the closest preceding one.
      if (column === segment.gen + segment.length) closing = segment
    }
    if (closing) return origin(closing) + closing.src + closing.length

    // Synthesised text with nothing copied near it: report it past the end of the source line,
    // not at its start.
    //
    // The start is where the delimiter sits — `} @pending {`, `} @empty {` — and Volar derives
    // semantic tokens from the compiled template, so tokens for scaffolding that has no source
    // counterpart used to land on those keywords and repaint them (the brace keywords showed up
    // as blue `property`). The end of the line is a position no token occupies, so such tokens
    // have nowhere to land.
    const last = entry.segments.at(-1)
    const sourceLine = sourceStarts[entry.source - 1] ?? 0
    const lineEnd = sourceLine + (sourceLines[entry.source - 1]?.length ?? 0)
    return last ? origin(last) + last.src + last.length : lineEnd
  }
}
