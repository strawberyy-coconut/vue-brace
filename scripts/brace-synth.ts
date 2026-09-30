/**
 * Print where the compiler's *synthesised* text maps back to.
 *
 * Copied text maps to itself, but anything the compiler invents — `.length` in an `@empty`
 * condition, `!`, the `<template v-if="…">` wrappers — has no counterpart in the author's file,
 * so the mapper has to invent a position. Volar then maps generated tokens *linearly* through
 * that answer, so a synthesised run of N characters paints N characters of the author's file
 * starting at whatever the mapper said. If that lands on markup instead of whitespace, it is
 * visible as a stray semantic token.
 *
 * Usage: deno run -A scripts/brace-synth.ts <file.vue> [needle]
 */
import { compileBraceWithMap } from '@cockernutx/brace-template/compile'
import { createOffsetMapper } from '@cockernutx/brace-template/mapper'

const file = Deno.args.find((arg) => !arg.startsWith('--'))
const needle = Deno.args.find((arg) => arg.startsWith('--text='))?.slice('--text='.length) ?? '.length'
if (!file) {
  console.error('usage: deno run -A scripts/brace-synth.ts <file.vue> [--text=.length]')
  Deno.exit(2)
}

const sfc = await Deno.readTextFile(file)
const opening = /<template lang="brace">\n/.exec(sfc)
const block = /<template lang="brace">\n([\s\S]*?)\n<\/template>/.exec(sfc)
if (!block || !opening) throw new Error('no <template lang="brace"> block found')
const template = block[1]!
const fileOffset = (blockOffset: number) => opening.index + opening[0].length + blockOffset

const { code, lines } = compileBraceWithMap(template)
const toSource = createOffsetMapper(template, code, lines)

console.log(`compiled: ${code.split('\n').length} lines (source ${template.split('\n').length})`)
console.log('')
console.log(`every ${JSON.stringify(needle)} in the compiled template:`)
for (const match of code.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))) {
  const generated = match.index
  const start = toSource(generated)
  const end = toSource(generated + match[0].length)
  console.log(
    `\n  generated ${generated} ${JSON.stringify(match[0])}\n` +
      `    maps to template ${start}..${end} = ${JSON.stringify(
        template.slice(start, end),
      )}   (file ${fileOffset(start)}..${fileOffset(end)})`,
  )
  const line = code.slice(0, generated).split('\n').length - 1
  const entry = lines[line]
  console.log(
    `    line ${line + 1} of the compiled output: ${JSON.stringify(code.split('\n')[line])}\n` +
      `    its segments: ${JSON.stringify(entry?.segments ?? [])}\n` +
      `    its source line: ${entry?.source}`,
  )
}
