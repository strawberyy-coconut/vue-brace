/**
 * Publish-readiness check: every entry point in `exports` exists, nothing hands a consumer
 * TypeScript, and each package's shipping set is one vsce/npm can actually build.
 *
 * `npm pack --dry-run` answers a similar question, but npm is not available in this container —
 * and this catches the failures that actually matter. An `exports` target that no longer exists
 * breaks every consumer while the repository keeps working, because the workspace resolves the
 * package to the same files that were just built. A package carrying both `files` and a
 * `.vscodeignore` fails at extension package time instead, on a runner, after a round trip.
 *
 * Run it after `deno task build:plugin`.
 */
import { existsSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname
const packages = [
  'packages/brace-template',
  'packages/language-plugin-brace',
  // Not published by `deno task release`, but it is shipped — by `vsce` — so it gets the same
  // treatment for the shipping set.
  'packages/vscode-vue-brace',
]

let failures = 0

for (const dir of packages) {
  const manifest = JSON.parse(await Deno.readTextFile(`${root}${dir}/package.json`))

  if (manifest.files?.includes('src')) {
    console.error(`${dir}: \`files\` ships src/, which is TypeScript source`)
    failures += 1
  }

  // vsce refuses to combine the two strategies for choosing what an extension ships, and only says
  // so while packaging — on a runner, after a round trip. This extension uses `files`, so a
  // `.vscodeignore` must never reappear beside it.
  if (manifest.files && existsSync(`${root}${dir}/.vscodeignore`)) {
    console.error(`${dir}: has both \`files\` and .vscodeignore — vsce rejects that combination`)
    failures += 1
  }

  // `files` is the shipping set: anything listed has to exist, or the published package is
  // missing a file nobody notices until a consumer reads the README or the licence.
  for (const entry of manifest.files ?? []) {
    if (!existsSync(`${root}${dir}/${entry}`)) {
      console.error(`${dir}: \`files\` lists ${entry}, which does not exist`)
      failures += 1
    }
  }

  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const conditions = typeof value === 'string' ? { default: value } : (value as object)
    for (const [condition, target] of Object.entries(conditions)) {
      const location = `exports[${subpath}].${condition}`
      // A `.d.ts` is a declaration and is exactly what `types` should point at; a `.ts` that is
      // not a declaration is source a consumer's toolchain would have to compile.
      if (target.endsWith('.ts') && !target.endsWith('.d.ts')) {
        console.error(`${dir}: ${location} → ${target}: consumers cannot load TypeScript`)
        failures += 1
      } else if (!existsSync(`${root}${dir}/${target}`)) {
        console.error(
          `${dir}: ${location} → ${target} is missing — run \`deno task build:plugin\``,
        )
        failures += 1
      }
    }
  }

  console.log(`checked ${dir}`)
}

if (failures) Deno.exit(1)
