/**
 * Deploy toolchain: build both packages, pack them as npm tarballs, publish them to a registry.
 *
 * ```sh
 * deno task registry           # in one terminal: the repo's own registry, on :4873
 * deno task release --local    # in another: build, pack and publish there
 * deno task release --registry https://npm.pkg.github.com --token "$NPM_TOKEN"
 * deno task release --local --dry-run    # pack and verify, publish nothing
 * ```
 *
 * Publishing to a registry rather than distributing by git ref is deliberate: npm cannot install
 * from a subdirectory of a git repository (its git spec has a commit-ish but no path), so a
 * monorepo package cannot be `npm i github:…`-able without a subtree branch per package. A
 * registry install is by name and version, which is what the consumer's lockfile wants anyway,
 * and the tarball carries the built `dist/` — so `files` in each manifest, not the repository
 * tree, decides what a consumer gets.
 *
 * What this adds over `npm publish`: it works with Deno alone (no Node in this container), it
 * checks *before* publishing that every `exports` target is present in the tarball and that no
 * source file slipped in, and it refuses to publish a version that already exists.
 */
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  args: Deno.args,
  options: {
    registry: { type: 'string' },
    token: { type: 'string' },
    tag: { type: 'string', default: 'latest' },
    local: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

const root = new URL('..', import.meta.url).pathname
const packages = ['packages/brace-template', 'packages/language-plugin-brace']

const registry = (
  values.local ? 'http://127.0.0.1:4873' : (values.registry ?? Deno.env.get('NPM_REGISTRY') ?? '')
).replace(/\/$/, '')

if (!registry) {
  console.error('No registry. Pass --local, or --registry <url> (or set NPM_REGISTRY).')
  Deno.exit(2)
}

const token = values.token ?? Deno.env.get('NPM_TOKEN')

async function run(args: string[]): Promise<void> {
  const { code } = await new Deno.Command(args[0]!, { args: args.slice(1) }).output()
  if (code !== 0) {
    console.error(`failed: ${args.join(' ')}`)
    Deno.exit(code)
  }
}

/** The files a consumer gets: `files` from the manifest, which npm itself would honour. */
async function stage(dir: string, target: string): Promise<Record<string, any>> {
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const pkg = join(target, 'package')
  await mkdir(pkg, { recursive: true })

  await cp(join(dir, 'package.json'), join(pkg, 'package.json'))
  for (const entry of manifest.files ?? []) {
    await cp(join(dir, entry), join(pkg, entry), { recursive: true })
  }
  return manifest
}

/**
 * A tarball npm can extract: gzipped, with everything under `package/`.
 *
 * Fixed mtime and sorted entries, so the same source produces the same bytes — which makes the
 * integrity in the packument mean something.
 */
async function pack(staging: string, out: string): Promise<Uint8Array> {
  await run([
    'tar',
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf',
    out,
    '-C',
    staging,
    'package',
  ])
  return await readFile(out)
}

async function listTarball(file: string): Promise<string[]> {
  const { stdout } = await new Deno.Command('tar', {
    args: ['-tzf', file],
    stdout: 'piped',
  }).output()
  return new TextDecoder().decode(stdout).trim().split('\n')
}

/** Every entry point the manifest advertises has to be inside the tarball. */
function checkContents(name: string, manifest: Record<string, any>, entries: string[]): void {
  const files = new Set(entries.map((entry) => entry.replace(/^package\//, '')))
  const problems: string[] = []

  for (const src of files) {
    if (src.startsWith('src/')) problems.push(`shipped source: ${src}`)
  }
  if (!files.has('package.json')) problems.push('no package.json')

  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const conditions = typeof value === 'string' ? { default: value } : (value as object)
    for (const [condition, target] of Object.entries(conditions)) {
      const path = String(target).replace(/^\.\//, '')
      if (!files.has(path)) {
        problems.push(`exports[${subpath}].${condition} → ${path} is not in the tarball`)
      }
    }
  }

  if (problems.length) {
    console.error(`${name}: refusing to publish`)
    for (const problem of problems) console.error(`  ${problem}`)
    Deno.exit(1)
  }
}

/** npm refuses to replace a published version, and so does this — before it uploads anything. */
async function publishedVersions(name: string): Promise<string[]> {
  const response = await fetch(`${registry}/${name}`)
  if (!response.ok) return []
  const packument = await response.json()
  return Object.keys(packument.versions ?? {})
}

async function publish(dir: string): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), 'brace-release-'))
  try {
    const manifest = await stage(dir, staging)
    const { name, version } = manifest
    const file = `${name.replace(/^@[^/]+\//, '')}-${version}.tgz`
    const tarball = join(staging, file)

    const bytes = await pack(staging, tarball)
    checkContents(name, manifest, await listTarball(tarball))

    console.log(`${name}@${version}: ${bytes.length} bytes, ${file}`)
    if (values['dry-run']) return

    if ((await publishedVersions(name)).includes(version)) {
      console.error(`${name}@${version} already exists on ${registry} — bump the version.`)
      Deno.exit(1)
    }

    // The version's manifest, without `devDependencies`: npm strips those from what a registry
    // stores, and a consumer has no use for them.
    const published = { ...manifest }
    delete published.devDependencies
    const integrity = `sha512-${base64(await crypto.subtle.digest('SHA-512', bytes))}`
    const body = {
      _id: name,
      name,
      description: manifest.description,
      'dist-tags': { [values.tag]: version },
      versions: {
        [version]: {
          ...published,
          dist: {
            tarball: `${registry}/${name}/-/${file}`,
            integrity,
            shasum: createHash('sha1').update(bytes).digest('hex'),
          },
        },
      },
      _attachments: {
        [file]: {
          content_type: 'application/octet-stream',
          data: base64(bytes),
          length: bytes.length,
        },
      },
    }

    const response = await fetch(`${registry}/${name}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error(`${name}@${version}: ${response.status} ${await response.text()}`)
      Deno.exit(1)
    }
    console.log(`  published to ${registry} (${integrity})`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Base64 of binary data.
 *
 * Takes an `ArrayBuffer` as well as a typed array: `crypto.subtle.digest` resolves to the former,
 * and an `ArrayBuffer` has no iterator — passing one straight to a `for…of` loop is the kind of
 * mistake that surfaces as "bytes is not iterable" three frames away from the cause.
 */
function base64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// Build first: a tarball packed from a stale `dist/` is the failure this repo has been bitten
// by twice, and it is invisible from the outside.
await run(['deno', 'task', '--cwd', root.replace(/\/$/, ''), 'build:plugin'])

for (const dir of packages) {
  await publish(join(root, dir))
}
