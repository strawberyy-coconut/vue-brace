/**
 * Check that a release tag matches what every manifest says.
 *
 * Run by the release workflow before it publishes, and useful by hand for the same reason:
 *
 * ```sh
 * deno run -A scripts/check-tag.ts v0.1.0
 * ```
 *
 * A publish that succeeds under the wrong version is the expensive kind of mistake — registries
 * refuse to replace a version, so the only fix is another release — and the tag is the one place
 * where a version is written by hand instead of read from a manifest. This also checks the
 * cross-package range, which is the other hand-maintained version ("keep the plugin's
 * `@vue-brace/brace-template` range in step" in docs/releasing.md).
 */
const tag = Deno.args[0]?.trim().replace(/^v/, '')
if (!tag) {
  console.error('usage: deno run -A scripts/check-tag.ts v0.1.0')
  Deno.exit(2)
}

const packages = [
  'packages/brace-template',
  'packages/language-plugin-brace',
  'packages/vscode-vue-brace',
]

let problems = 0

for (const dir of packages) {
  const url = new URL(`../${dir}/package.json`, import.meta.url)
  const manifest = JSON.parse(await Deno.readTextFile(url))

  if (manifest.version !== tag) {
    console.error(`${dir}: version is ${manifest.version}, tag says ${tag}`)
    problems += 1
    continue
  }
  console.log(`${manifest.name}@${manifest.version}`)

  const range = manifest.dependencies?.['@vue-brace/brace-template']
  if (range && range !== `^${tag}`) {
    console.error(`${dir}: depends on @vue-brace/brace-template ${range}, expected ^${tag}`)
    problems += 1
  }
}

// `vscode-vue-brace` is not published by `deno task release`, but it shares the tag so that one
// release marks one version of everything.
if (problems) {
  console.error(`\n${problems} version mismatch(es) — fix the manifests, or retag.`)
  Deno.exit(1)
}
console.log(`\nall packages are ${tag}`)
