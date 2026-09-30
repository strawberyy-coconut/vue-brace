import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { BraceEmpty } from '@cockernutx/brace-template'

/**
 * `@empty` renders through this component, so its emptiness test is the dialect's semantics,
 * not an implementation detail. The template form it replaced (`v-if="!<list>.length"`) threw
 * on `undefined`, and treated anything without a `length` as empty; this is deliberately both
 * more forgiving and more careful.
 */
describe('BraceEmpty', () => {
  const render = (list: unknown) =>
    mount(BraceEmpty, { props: { list }, slots: { default: () => 'fallback' } }).text()

  it('renders its slot only when the list is empty', () => {
    expect(render([])).toBe('fallback')
    expect(render([1])).toBe('')
  })

  it('treats null and undefined as empty instead of throwing', () => {
    expect(render(null)).toBe('fallback')
    expect(render(undefined)).toBe('fallback')
  })

  it('does not treat a value with no length as empty', () => {
    expect(render({})).toBe('')
    expect(render(0)).toBe('')
  })
})
