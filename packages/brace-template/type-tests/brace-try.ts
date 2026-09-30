/**
 * Type-level checks for the `@catch` slot props, run by `tsc` (the package's `check:types`
 * task) rather than by Vitest, because they assert on types rather than on behaviour.
 *
 * `@catch (e, retry) {` compiles to `<template #catch="[e, retry]">` — a positional copy of the
 * author's parameter list — so these are the tuple props Volar types those bindings from. If this declaration stops having an effect,
 * every `e` / `retry` in a brace template silently becomes `any` again — the "hover says
 * `any`" complaint this file exists to keep from coming back.
 *
 * Two details matter:
 *
 * - Assert on `$slots`, not on an `h(…)` call. `h`'s slots parameter is `RawSlots` (a plain
 *   record), so it does not type slot callbacks however the component is declared, and a probe
 *   written that way fails for the wrong reason.
 * - Use `tsc`, not `deno check`. Deno's checker does not honour Vue's `SlotsType`, which is a
 *   `unique symbol`-branded type, so a correct declaration looks like it has no effect there.
 *   `tsc` is also what Volar uses, so its verdict is the one that counts.
 */
import type { GlobalComponents } from 'vue'

import type { BraceTry } from '../src/BraceTry.ts'

type BraceTrySlots = InstanceType<typeof BraceTry>['$slots']

/** `error` is an `Error` and `reset` is callable, so the author's bindings are usable. */
export function positiveChecks(slots: BraceTrySlots) {
  const render = slots.catch
  if (!render) return undefined

  // `@catch (e, retry) {` destructures this tuple by position: `e` is the error, `retry` the
  // reset. Positional rather than an aliased object pattern because the generated slot
  // expression has to look like what the author wrote — see `BraceCatchProps`.
  const describe = ([error, reset]: Parameters<typeof render>[0]) => {
    reset()
    return error.message
  }
  return describe
}

/**
 * The negative half is what proves the types are real: with `any` these lines compile
 * happily, and `@ts-expect-error` then reports itself as unused.
 */
export function negativeChecks(slots: BraceTrySlots) {
  const render = slots.catch
  if (!render) return undefined
  // @ts-expect-error the props are a tuple, not an object.
  render({ error: new Error('boom'), reset: () => {} })
  // @ts-expect-error the first element must be an Error.
  render(['boom', () => {}])
  return undefined
}

/**
 * Volar resolves `<BraceTry>` through `GlobalComponents`, which this package augments, so
 * that is the declaration to assert on: were it missing, the tag would be an unknown
 * component and the bindings would be `any` again.
 */
export function globalComponentChecks(components: GlobalComponents) {
  const slots = (null as unknown as InstanceType<typeof components.BraceTry>)['$slots']
  const render = slots.catch
  if (render) {
    // @ts-expect-error the props are a tuple, not an object.
    render({ error: new Error('boom'), reset: () => {} })
    // Position 0 is the error and position 1 the reset.
    const [error, reset] = [new Error('boom'), () => {}] as Parameters<typeof render>[0]
    reset()
    return error.message
  }
  return undefined
}