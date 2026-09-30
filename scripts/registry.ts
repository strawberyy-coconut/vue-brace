/**
 * A minimal npm registry, so the deploy toolchain has something to deploy *to* and so the whole
 * publish → install path can be exercised without an account anywhere.
 *
 * ```sh
 * deno task registry          # serves on http://127.0.0.1:4873
 * deno task release --local   # publishes both packages here
 * ```
 *
 * Point npm at it with a line in `.npmrc`:
 *
 * ```ini
 * @cockernutx:registry=http://127.0.0.1:4873/
 * ```
 *
 * It implements the part of the registry API that `npm install`, `npm publish` and `npm view`
 * actually use: the packument, the tarball, a publish, and the ping/whoami probes. It is a
 * development and self-hosting tool, not a production registry: no access control beyond an
 * optional bearer token (`NPM_TOKEN`), no yanking, no audit endpoints, no dist-tag
 * management beyond keeping `latest` pointing at the newest publish. Verdaccio, or whatever
 * registry your host provides (GitHub Packages, GitLab's per-project registry), is the right
 * choice for anything shared — `deno task release --registry <url>` targets those unchanged.
 */
import { join } from 'node:path'

const STORE = new URL('../.registry/', import.meta.url).pathname
const PORT = Number(Deno.env.get('PORT') ?? 4873)
const TOKEN = Deno.env.get('NPM_TOKEN')

/** A packument: the metadata document npm reads for a package name. */
interface Packument {
  name: string
  'dist-tags': Record<string, string>
  versions: Record<string, Record<string, unknown>>
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Registry paths are URL-encoded (`@scope%2Fname`), and come from the network. */
function packageName(raw: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  // A name becomes a directory under the store, so refuse anything that could leave it.
  if (!/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(decoded)) return undefined
  if (decoded.includes('..')) return undefined
  return decoded
}

const dirFor = (name: string) => join(STORE, name.replace('/', '+'))
const packumentPath = (name: string) => join(dirFor(name), 'packument.json')

async function readPackument(name: string): Promise<Packument | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(packumentPath(name)))
  } catch {
    return undefined
  }
}

function authorised(request: Request): boolean {
  if (!TOKEN) return true
  // npm sends `Bearer <token>` when an `.npmrc` sets `_authToken`, and `Basic <base64>` for
  // `npm login`. Accept the token in either place: both are one line of configuration.
  const header = request.headers.get('authorization') ?? ''
  if (header === `Bearer ${TOKEN}`) return true
  if (!header.startsWith('Basic ')) return false
  try {
    return atob(header.slice(6)).endsWith(`:${TOKEN}`)
  } catch {
    return false
  }
}

async function publish(request: Request, name: string): Promise<Response> {
  if (!authorised(request)) return json({ error: 'unauthorised' }, 401)

  const body = await request.json()
  const versions = (body.versions ?? {}) as Record<string, Record<string, any>>
  const attachments = (body._attachments ?? {}) as Record<string, { data: string }>
  const version = Object.keys(versions)[0]

  if (!version || Object.keys(versions).length !== 1) {
    return json({ error: 'a publish must contain exactly one version' }, 400)
  }

  const existing = await readPackument(name)
  if (existing?.versions[version]) {
    // Real registries refuse to replace a version, and so should this one: a version that can
    // change underneath a lockfile is worse than a failed publish.
    return json({ error: `cannot publish ${name}@${version}: that version already exists` }, 409)
  }

  const attachment = attachments[`${name.replace(/^@[^/]+\//, '')}-${version}.tgz`]
  if (!attachment?.data) {
    return json({ error: 'the publish is missing its tarball attachment' }, 400)
  }

  const bytes = Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0))
  await Deno.mkdir(dirFor(name), { recursive: true })
  await Deno.writeFile(join(dirFor(name), `${version}.tgz`), bytes)

  const packument: Packument = existing ?? { name, 'dist-tags': {}, versions: {} }
  packument.versions[version] = versions[version]!
  // `latest` follows the newest publish. Comparing versions properly would need semver; a
  // deploy toolchain that publishes 0.1.0 then 0.1.3 is not the case worth code for.
  packument['dist-tags'].latest = version
  await Deno.writeTextFile(packumentPath(name), JSON.stringify(packument, null, 2))

  console.log(`published ${name}@${version} (${bytes.length} bytes)`)
  return json({ ok: true }, 201)
}

async function handler(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname

  if (path === '/-/ping') return json({})
  // `npm whoami` talks to the same endpoint on the configured registry.
  if (path === '/-/whoami') return json({ username: 'vue-brace' })
  if (path === '/' || path === '/-/all') return json({})

  // `/<name>/-/<filename>.tgz`
  const tarball = /^\/(.+)\/-\/([^/]+\.tgz)$/.exec(path)
  if (tarball && request.method === 'GET') {
    const name = packageName(tarball[1]!)
    if (!name) return json({ error: 'bad package name' }, 400)

    // Resolve the file through the packument rather than parsing the version out of the
    // filename: the manifest already says which tarball belongs to which version.
    const packument = await readPackument(name)
    const version = Object.entries(packument?.versions ?? {}).find(([, manifest]) =>
      String((manifest as { dist?: { tarball?: string } }).dist?.tarball ?? '').endsWith(
        `/${tarball[2]}`,
      ),
    )?.[0]
    if (!version) return json({ error: 'not found' }, 404)

    try {
      const bytes = await Deno.readFile(join(dirFor(name), `${version}.tgz`))
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    } catch {
      return json({ error: 'not found' }, 404)
    }
  }

  const name = packageName(path.slice(1))
  if (!name) return json({ error: 'bad package name' }, 400)

  if (request.method === 'PUT') return publish(request, name)
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const packument = await readPackument(name)
  if (!packument) return json({ error: 'not found' }, 404)
  return json(packument)
}

await Deno.mkdir(STORE, { recursive: true })
console.log(`registry: http://127.0.0.1:${PORT}/  store: ${STORE}`)
if (TOKEN) console.log('publish requires the NPM_TOKEN bearer token')
Deno.serve({ port: PORT, hostname: '127.0.0.1' }, handler)
