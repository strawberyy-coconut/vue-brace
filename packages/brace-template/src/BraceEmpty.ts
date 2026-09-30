import { defineComponent, type SlotsType } from 'vue'

/**
 * Emptiness boundary for `@for … @empty`.
 *
 * The `@empty` block used to compile to `<template v-if="!<list>.length">`, synthesised
 * entirely by the compiler. That is the one construct Volar could not be made to map
 * harmlessly: it highlights the identifiers in a condition and lays the whole expression out
 * from its own start, so wherever the compiler anchored it, ~13 characters of the author's
 * file were recoloured — parked at the end of the line, the six-character `length` token
 * painted the line *below* (which is why `src/mapper.ts` parks synthesised text at the line end).
 *
 * Moving the test here removes the synthesised expression: the `:list` prop is the author's own
 * text, copied 1:1 and attributed to the `@for` line it was written on, so every character of
 * it maps onto real source text.
 *
 * The test is deliberately more forgiving than `!list.length` was: `null` and `undefined` count
 * as empty instead of throwing, and a value with no `length` is *not* treated as empty rather
 * than silently rendering the fallback.
 */
export const BraceEmpty = defineComponent({
  name: 'BraceEmpty',
  props: {
    /** The list the `@for` iterates. `unknown`: a template expression can be anything. */
    list: { required: false, default: undefined },
  },
  slots: Object as SlotsType<{ default?: () => unknown }>,
  setup(props, { slots }) {
    return () => (isEmpty(props.list) ? slots.default?.() : null)
  },
})

function isEmpty(list: unknown): boolean {
  if (list == null) return true
  const { length } = list as { length?: unknown }
  return length === 0
}
