/**
 * Publish-readiness check: every entry point in `exports` exists, and nothing hands a consumer
 * TypeScript.
 *
 * `npm pack --dry-run` answers a similar question, but npm is not available in this container —
 * and this catches the failure that actually matters. An `exports` target that no longer exists
 * breaks every consumer while the repository keeps working, because the workspace resolves the
 * package to the same files that were just built. Run it after `deno task build:plugin`.
 */
import { existsSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname
const packages = ['packages/brace-template', 'packages/language-plugin-brace']

let failures = 0

for (const dir of packages) {
  const manifest = JSON.parse(await Deno.readTextFile(`${root}${dir}/package.json`))

  if (manifest.files?.includes('src')) {
    console.error(`${dir}: \`files\` ships src/, which is TypeScript source`)
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
