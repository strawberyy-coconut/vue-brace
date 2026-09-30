import {
  defineComponent,
  h,
  onErrorCaptured,
  shallowRef,
  Suspense,
  type App,
  type SlotsType,
} from 'vue'

import { BraceEmpty } from './BraceEmpty.ts'

/**
 * What the `#catch` slot receives, positionally.
 *
 * `@catch (e, retry) {` compiles to `#catch="[e, retry]"` — a tuple, destructured by
 * position — rather than an aliased object pattern. The reason is not taste: Volar maps
 * positions inside a directive expression as a single run, so an aliased form
 * (`{ error: e, reset: retry }`) is longer than what the author wrote and every semantic
 * token inside it drifts onto the surrounding markup. A positional copy has the same shape
 * as the source, so the author's own names line up.
 */
export type BraceCatchProps = [
  /**
   * The captured error, normalised to an `Error` because anything can be thrown (a string,
   * a rejection reason, `undefined`) and the template should not have to guess which.
   */
  error: Error,
  /** Clears the captured error so the `@try` body renders again. */
  reset: () => void,
]

/**
 * Runtime boundary for `@try` / `@catch` / `@pending`.
 *
 * Vue has no template-level error handling, and a template preprocessor can only
 * produce template text — it cannot add imports to `<script setup>`. So the `<BraceTry>`
 * tag that `compileBrace` emits has to resolve globally; see `installBrace`.
 *
 * `onErrorCaptured` covers descendant `setup()`, render functions, lifecycle hooks,
 * watchers and `Suspense`. It does **not** catch errors thrown inside event handlers.
 *
 * The `slots` type is what makes `@catch (e, retry) {` useful to type-aware tooling: without
 * it the destructured slot props are `any`, so hover on `e` and `retry` says nothing.
 */
export const BraceTry = defineComponent({
  name: 'BraceTry',
  slots: Object as SlotsType<{
    default?: () => unknown
    catch?: (props: BraceCatchProps) => unknown
    pending?: () => unknown
  }>,
  setup(_, { slots }) {
    const error = shallowRef<Error | null>(null)

    onErrorCaptured((thrown) => {
      // Keep Errors as they are, so `message`, `stack` and identity survive.
      error.value = thrown instanceof Error ? thrown : new Error(String(thrown))
      return false // handled: don't forward to app.config.errorHandler
    })

    const reset = () => {
      error.value = null
    }

    const body = () =>
      slots.pending
        ? h(Suspense, null, {
            default: () => slots.default?.(),
            fallback: () => slots.pending?.(),
          })
        : slots.default?.()

    return () =>
      error.value === null
        ? body()
        : slots.catch?.([error.value, reset])
  },
})

/**
 * Register the runtime components `compileBrace` emits on an app instance.
 *
 * ```ts
 * const app = createApp(App)
 * installBrace(app)
 * ```
 *
 * A template preprocessor cannot add imports to `<script setup>`, so both tags have to resolve
 * globally. If they do not, the tags degrade into DOM elements literally called `<BraceTry>` and
 * `<BraceEmpty>` — no error, and the `@catch` / `@empty` arms silently render nothing useful.
 */
export function installBrace(app: App): App {
  app.component('BraceTry', BraceTry)
  app.component('BraceEmpty', BraceEmpty)
  return app
}

/**
 * Teach type-aware tooling that `<BraceTry>` exists.
 *
 * `compileBrace` emits tags but nothing imports them, so Volar only knows their props and
 * slots — including the `@catch (e, retry)` bindings — through this augmentation. Without it
 * the destructured slot props come back as `any`, which is exactly the `any` that hover used
 * to report for both `e` and `retry`.
 */
declare module 'vue' {
  interface GlobalComponents {
    BraceTry: typeof BraceTry
    BraceEmpty: typeof BraceEmpty
  }
}
