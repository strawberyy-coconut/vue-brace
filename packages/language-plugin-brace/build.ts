/**
 * Build `@cockernutx/language-plugin-brace` for Node.
 *
 * Volar resolves a language plugin and calls `require()` on it — in the editor's language server
 * and in `vue-tsc`, both Node processes. Serving TypeScript source works only under Deno (which
 * can `require()` `.ts`); in Node it is a `SyntaxError` that Volar swallows, so every brace
 * template silently loses brace syntax, hover and diagnostics. Hence a CommonJS build.
 *
 * The package type-checks against `@cockernutx/brace-template`'s declarations, so that package
 * has to be built first — the root `deno task build` runs them in that order.
 */
import { join } from 'node:path'

const root = new URL('.', import.meta.url).pathname

// Start from an empty output directory: a `dist` that was not rewritten looks exactly like a
// successful build, which silently shipped a stale plugin more than once.
await Deno.remove(join(root, 'dist'), { recursive: true }).catch(() => {})

const { code, stderr, stdout } = await new Deno.Command(Deno.execPath(), {
  args: ['run', '-A', 'npm:typescript/bin/tsc', '--project', join(root, 'tsconfig.build.json')],
  stdout: 'piped',
  stderr: 'piped',
}).output()

const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
if (output.trim()) console.log(output.trim())
if (code !== 0) Deno.exit(code)

// A `tsconfig` that loses its `outDir` makes `tsc` emit *beside* the sources; a stray `.js` there
// is worse than no build, because a `.js`-suffixed import from `src/` then loads it silently.
for (const stray of strayJs(join(root, 'src'))) {
  console.error(`[language-plugin-brace] src/${stray}: tsc emitted beside the source`)
  Deno.exit(1)
}

// The package is `"type": "module"`, which would make Node read the CommonJS output as ESM; the
// marker is what says otherwise.
await Deno.writeTextFile(
  join(root, 'dist', 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
)
console.log('built language-plugin-brace/dist')

/** Paths of compiled JavaScript under `dir`, relative to it. */
function strayJs(dir: string): string[] {
  const found: string[] = []
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.isDirectory) {
      found.push(...strayJs(join(dir, entry.name)).map((path) => join(entry.name, path)))
    } else if (entry.name.endsWith('.js')) {
      found.push(entry.name)
    }
  }
  return found
}
