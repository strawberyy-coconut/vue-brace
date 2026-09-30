/**
 * Build `@cockernutx/brace-template` for both kinds of consumer.
 *
 * Volar's language server and `vue-tsc` `require()` this package's entries from a Node process,
 * so those have to be CommonJS; bundlers and Deno import the ESM build. A single `dist/` cannot
 * hold both — the nearest `package.json` decides a directory's module type — so the ESM output
 * lives in `dist/esm/`, beside a `dist/package.json` that says `commonjs`.
 *
 * Run it here (`deno task build`) or from the root (`deno task build`, which builds every
 * package in dependency order).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('.', import.meta.url).pathname

// Start from an empty output directory: `tsc` leaves anything it already considers up to date
// alone, and a `dist` that was never rewritten looks exactly like a successful build.
await Deno.remove(join(root, 'dist'), { recursive: true }).catch(() => {})

for (const project of ['tsconfig.build.json', 'tsconfig.esm.json']) {
  const { code, stderr, stdout } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', 'npm:typescript/bin/tsc', '--project', join(root, project)],
    stdout: 'piped',
    stderr: 'piped',
  }).output()

  const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
  if (output.trim()) console.log(output.trim())
  if (code !== 0) Deno.exit(code)
}

// A `tsconfig` that loses its `outDir` makes `tsc` emit *beside* the sources instead of into
// `dist/`, and those strays are worse than no build at all: any `.js`-suffixed import from
// `src/` then loads stale compiled code while `dist/` looks freshly built. Fail loudly instead
// of shipping both copies.
for (const stray of strayJs(join(root, 'src'))) {
  console.error(`[brace-template] src/${stray}: tsc emitted beside the source`)
  Deno.exit(1)
}

// Both packages are `"type": "module"`, which would make Node read the CommonJS output as ESM. A
// marker in `dist/` is the standard way to say otherwise; the ESM build gets its own marker
// under `dist/esm/`.
await Deno.writeTextFile(join(root, 'dist', 'package.json'), pkgJson('commonjs'))
if (existsSync(join(root, 'dist', 'esm'))) {
  await Deno.writeTextFile(join(root, 'dist', 'esm', 'package.json'), pkgJson('module'))
}
console.log('built brace-template/dist')

/** A `package.json` whose only job is to set the module type of the directory it sits in. */
function pkgJson(type: 'commonjs' | 'module'): string {
  return `${JSON.stringify({ type }, null, 2)}\n`
}

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
