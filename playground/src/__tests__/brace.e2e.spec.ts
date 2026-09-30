import { config, flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { BraceEmpty, BraceTry } from '@cockernutx/brace-template'

import DynamicTag from './DynamicTag.vue'
import IfFor from './IfFor.vue'
import PendingDemo from './PendingDemo.vue'
import SwitchDemo from './SwitchDemo.vue'
import TryDemo from './TryDemo.vue'

// `@try` compiles to a `<BraceTry>` tag and `@empty` to `<BraceEmpty>`, and a template
// preprocessor cannot add the imports that would resolve them. `main.ts` calls
// `installBrace(app)`; tests mount their own app, so they have to register both the same way.
// Skip this and the tags quietly become DOM elements called `<BraceTry>` / `<BraceEmpty>` — no
// error boundary, and no empty-state fallback.
config.global.components = { BraceTry, BraceEmpty }

const items = [
  { id: 1, title: 'Ginsu' },
  { id: 2, title: 'Cleaver' },
]

describe('@if / @else if / @else', () => {
  it('renders the matching arm', async () => {
    const wrapper = mount(IfFor, { props: { status: 'loading', items } })
    expect(wrapper.find('[data-test="loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="list"]').exists()).toBe(false)

    await wrapper.setProps({ status: 'error' })
    expect(wrapper.find('[data-test="error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="loading"]').exists()).toBe(false)

    await wrapper.setProps({ status: 'success' })
    expect(wrapper.find('[data-test="list"]').exists()).toBe(true)
  })
})

describe('@for / @empty', () => {
  it('renders each item with its index', () => {
    const wrapper = mount(IfFor, { props: { status: 'success', items } })
    expect(wrapper.find('[data-test="row-1"]').text()).toBe('1 · Ginsu')
    expect(wrapper.find('[data-test="row-2"]').text()).toBe('2 · Cleaver')
    expect(wrapper.find('[data-test="empty"]').exists()).toBe(false)
  })

  it('renders the @empty arm for an empty list', () => {
    const wrapper = mount(IfFor, { props: { status: 'success', items: [] } })
    expect(wrapper.find('[data-test="empty"]').text()).toBe('Sold out')
    expect(wrapper.findAll('li')).toHaveLength(1)
  })

  it('keeps rows keyed across reorders', async () => {
    const wrapper = mount(IfFor, { props: { status: 'success', items } })
    const first = wrapper.find('[data-test="row-1"]').element

    await wrapper.setProps({ items: [items[1], items[0]] })
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([
      '1 · Cleaver',
      '2 · Ginsu',
    ])
    // `:key="item.id"` means the row element is reused, not recreated.
    expect(wrapper.find('[data-test="row-1"]').element).toBe(first)
  })
})

describe('@switch', () => {
  it.each([
    ['loading', 'loading'],
    ['success', 'success'],
    ['anything-else', 'default'],
  ])('renders the %s arm for status %s', (status, arm) => {
    const wrapper = mount(SwitchDemo, { props: { status } })
    expect(wrapper.find(`[data-test="${arm}"]`).exists()).toBe(true)
  })
})

describe('@try / @catch', () => {
  it('catches a descendant error and renders the catch arm', async () => {
    const wrapper = mount(TryDemo)
    // The caught error flips BraceTry's state, so the fallback appears on the next tick.
    await flushPromises()

    expect(wrapper.find('[data-test="catch"]').text()).toBe('boom')
    expect(wrapper.find('[data-test="ok"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="retries"]').text()).toBe('0')
  })

  it('remounts the subtree when the catch arm calls reset()', async () => {
    const wrapper = mount(TryDemo)
    await flushPromises()

    await wrapper.find('[data-test="retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="catch"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ok"]').text()).toBe('fine')
    expect(wrapper.find('[data-test="retries"]').text()).toBe('1')
  })
})

describe('@try / @pending', () => {
  it('shows the pending arm until the async child resolves', async () => {
    const wrapper = mount(PendingDemo)
    expect(wrapper.find('[data-test="pending"]').exists()).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()

    expect(wrapper.find('[data-test="pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="slow"]').text()).toBe('chart ready')
  })
})

describe('dynamic tags and comments', () => {
  it('renders the tag named by the expression', async () => {
    const wrapper = mount(DynamicTag)
    expect(wrapper.find('[data-test="panel"]').element.tagName).toBe('SECTION')

    wrapper.vm.tag = 'article'
    await flushPromises()
    expect(wrapper.find('[data-test="panel"]').element.tagName).toBe('ARTICLE')
  })

  it('does not render the // comment as visible text', () => {
    const wrapper = mount(DynamicTag)
    expect(wrapper.text()).not.toContain('this comment must not become visible text')
    expect(wrapper.find('[data-test="inner"]').exists()).toBe(true)
  })
})
