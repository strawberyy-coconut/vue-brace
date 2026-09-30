/**
 * Pack the publishable packages and check the tarballs.
 *
 * `npm publish` does the publishing. What it will not do is notice that a tarball is broken: a
 * `files` set missing a built `dist/` entry, or an `exports` target that no longer exists,
 * publishes happily and breaks every consumer. That is the one question worth a script, and this
 * script leaves the tarballs in `.release/` so they can be inspected by hand too.
 *
 * Run by `containers/release/run.sh` before it publishes:
 *
 *   deno run -A containers/release/pack.ts
 */
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname
const out = join(root, '.release')

/** Published by npm. `vscode-vue-brace` shares the version but is packaged by `vsce`. */
const packages = ['packages/brace-template', 'packages/language-plugin-brace']

/**
 * A tarball npm can extract: gzipped, with everything under `package/`.
 *
 * Fixed mtime and sorted entries, so the same source produces the same bytes.
 */
async function pack(staging: string, file: string): Promise<void> {
  const { code } = await new Deno.Command('tar', {
    args: [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      file,
      '-C',
      staging,
      'package',
    ],
  }).output()
  if (code !== 0) Deno.exit(code)
}

/** Every file inside a tarball, with the leading `package/` removed. */
async function contents(file: string): Promise<string[]> {
  const { stdout } = await new Deno.Command('tar', {
    args: ['-tzf', file],
    stdout: 'piped',
  }).output()
  return new TextDecoder()
    .decode(stdout)
    .trim()
    .split('\n')
    .map((entry) => entry.replace(/^package\//, ''))
}

/** What is wrong with this package's shipping set, if anything. */
function problemsWith(manifest: Record<string, any>, files: string[]): string[] {
  const present = new Set(files)
  const problems: string[] = []

  for (const file of files) {
    if (file.startsWith('src/')) problems.push(`ships source: ${file}`)
  }
  if (!present.has('package.json')) problems.push('no package.json')

  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const conditions = typeof value === 'string' ? { default: value } : (value as object)
    for (const [condition, target] of Object.entries(conditions)) {
      const path = String(target).replace(/^\.\//, '')
      if (!present.has(path)) {
        problems.push(`exports[${subpath}].${condition} → ${path} is not in the tarball`)
      }
    }
  }

  return problems
}

await rm(out, { recursive: true, force: true })

let broken = 0

for (const dir of packages) {
  const manifest = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8'))
  const name = String(manifest.name).replace(/^@[^/]+\//, '')
  const staging = join(out, name)
  const pkg = join(staging, 'package')

  await mkdir(pkg, { recursive: true })
  await cp(join(root, dir, 'package.json'), join(pkg, 'package.json'))
  for (const entry of manifest.files ?? []) {
    await cp(join(root, dir, entry), join(pkg, entry), { recursive: true })
  }

  const file = join(out, `${name}-${manifest.version}.tgz`)
  await pack(staging, file)

  const problems = problemsWith(manifest, await contents(file))
  if (problems.length) {
    console.error(`${manifest.name}@${manifest.version}: refusing to publish`)
    for (const problem of problems) console.error(`  ${problem}`)
    broken += 1
  } else {
    console.log(`${manifest.name}@${manifest.version}: ok — ${file}`)
  }
}

if (broken) Deno.exit(1)
