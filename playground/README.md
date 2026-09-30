# playground

The demo app. `/brace` (`src/views/BraceView.vue`) exercises every construct, and
`src/__tests__/` holds the `lang="brace"` fixtures the jsdom e2e suite mounts.

It is a workspace member, so everything runs from the repository root — there is no `npm` here,
and `deno task dev` / `test` / `build` / `lint` all reach into this package for you. See the
[root README](../README.md).
