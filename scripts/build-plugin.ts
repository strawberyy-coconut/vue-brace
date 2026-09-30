/**
 * Build the packages so Node can load them, and so package consumers get compiled JavaScript.
 *
 * Volar resolves a language plugin and calls `require()` on the result — in `vue-tsc` and in
 * the editor's language server, both of which are Node processes. Serving the TypeScript
 * source works only under Deno, which can `require()` `.ts` directly; in Node the plugin
 * fails to load with a `SyntaxError`, Volar catches it, and the only trace is a warning in
 * the language server's output channel. That is a silent failure of every language feature,
 * so the plugin ships built JavaScript instead.
 *
 * Run after changing anything either package imports:
 *
 * ```sh
 * deno task build:plugin
 * ```
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

/**
 * Each package, and the `tsc` projects it has to be built with.
 *
 * `brace-template` needs two: a CommonJS build, because Volar's language server and `vue-tsc`
 * `require()` the entries the plugin uses, and an ESM build for bundlers and Deno — the entries
 * a browser app imports. The plugin itself is loaded by Node, so one is enough.
 */
const packages = [
  { name: 'packages/brace-template', projects: ['tsconfig.build.json', 'tsconfig.esm.json'] },
  { name: 'packages/language-plugin-brace', projects: ['tsconfig.build.json'] },
]

for (const { name, projects } of packages) {
  // Start from an empty output directory. `tsc` here runs without `--force`, so anything it
  // already considers up to date is left alone — and a `dist` that is not rewritten looks
  // exactly like a successful build. That silently cost two rounds of plugin changes: the
  // editor kept loading the previous build and the only symptom was behaviour that did not
  // match the source.
  await Deno.remove(join(root, name, 'dist'), { recursive: true }).catch(() => {})

  for (const project of projects) {
    const { code, stderr, stdout } = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', 'npm:typescript/bin/tsc', '--project', join(root, name, project)],
      stdout: 'piped',
      stderr: 'piped',
    }).output()

    const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
    if (output.trim()) console.log(output.trim())
    if (code !== 0) Deno.exit(code)
  }

  // A `tsconfig` that loses its `outDir` makes `tsc` emit *beside* the sources instead of into
  // `dist/`, and those strays are worse than no build at all: any `.js`-suffixed import from
  // `src/` then loads stale compiled code while `dist/` looks freshly built. Three such files
  // sat in `packages/brace-template/src/` — `compile.js` among them — until one was read as
  // the real compiler. Fail loudly rather than shipping both copies.
  for (const stray of strayJs(join(root, name, 'src'))) {
    console.error(`[build-plugin] ${name}/${stray}: tsc emitted beside the source`)
    Deno.exit(1)
  }

  // Both packages are `"type": "module"`, which would make Node read the CommonJS output as
  // ESM. A marker in `dist/` is the standard way to say otherwise without renaming files; the
  // ESM build gets its own marker under `dist/esm/`.
  await Deno.writeTextFile(join(root, name, 'dist', 'package.json'), pkgJson('commonjs'))
  if (existsSync(join(root, name, 'dist', 'esm'))) {
    await Deno.writeTextFile(join(root, name, 'dist', 'esm', 'package.json'), pkgJson('module'))
  }
  console.log(`built ${name}/dist`)
}

/** A `package.json` whose only job is to set the module type of the directory it sits in. */
function pkgJson(type: 'commonjs' | 'module'): string {
  return `${JSON.stringify({ type }, null, 2)}\n`
}

/** Paths of compiled JavaScript under `dir`, relative to it. */
function strayJs(dir: string): string[] {
  const found: string[] = []
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.isDirectory) found.push(...strayJs(join(dir, entry.name)).map((p) => join(entry.name, p)))
    else if (entry.name.endsWith('.js')) found.push(entry.name)
  }
  return found
}
