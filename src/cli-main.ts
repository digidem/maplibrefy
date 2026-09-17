import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

import { convertStyle } from './convert.js'
import type { Change } from './types.js'

export interface CliIo {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
}

const USAGE = `maplibrify — convert a Mapbox GL style so MapLibre GL loads it

Usage: maplibrify [file] [options]

  file                  style JSON to read; stdin when omitted or "-"

Options:
  --projection <mode>   "keep" (default) or "mercator"
  --quiet               do not list the changes on stderr
  -h, --help            print this help
  --version             print the version

The converted style goes to stdout and the list of changes to stderr.
`

export async function run(argv: string[], io: CliIo): Promise<number> {
  let args
  try {
    args = parseArgs({
      args: argv,
      options: {
        projection: { type: 'string' },
        quiet: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
      allowPositionals: true,
    })
  } catch (error) {
    return fail(io, messageOf(error))
  }

  if (args.values.help) {
    io.stdout.write(USAGE)
    return 0
  }
  if (args.values.version) {
    io.stdout.write(`${version()}\n`)
    return 0
  }

  if (args.positionals.length > 1) {
    return fail(io, 'expected at most one file argument')
  }
  const projection = args.values.projection ?? 'keep'
  if (projection !== 'keep' && projection !== 'mercator') {
    return fail(
      io,
      `--projection must be "mercator" or "keep", got "${projection}"`,
    )
  }

  const file = args.positionals[0]
  let source: string
  try {
    source =
      file === undefined || file === '-'
        ? await readAll(io.stdin)
        : await readFile(file, 'utf8')
  } catch (error) {
    return fail(io, messageOf(error))
  }

  let input: unknown
  try {
    input = JSON.parse(source)
  } catch (error) {
    return fail(io, `invalid JSON: ${messageOf(error)}`)
  }

  let result
  try {
    result = convertStyle(input, { projection })
  } catch (error) {
    return fail(io, messageOf(error))
  }

  io.stdout.write(`${JSON.stringify(result.style, null, 2)}\n`)
  if (!args.values.quiet) {
    for (const change of result.changes) {
      io.stderr.write(`${describe(change)}\n`)
    }
  }
  io.stderr.write(`${summarize(result.changes.length)}\n`)
  return 0
}

/** One line per change, `kind: subject [— reason]`, so `grep` on the kind works. */
function describe(change: Change): string {
  switch (change.kind) {
    case 'imports-removed':
      return `imports-removed: ${change.ids.join(', ')}`
    case 'root-removed':
      return `root-removed: ${change.key}`
    case 'projection-rewritten':
      return `projection-rewritten: ${change.from} → ${change.to}`
    case 'expression-rewritten':
      return `expression-rewritten: ${change.path} ${change.operator}`
    case 'property-removed':
      return `property-removed: ${change.layerId} ${change.group}.${change.property} — ${change.reason}`
    case 'filter-removed':
      return `filter-removed: ${change.layerId} — ${change.reason}`
    case 'layer-removed':
      return `layer-removed: ${change.layerId} (${change.layerType}) — ${change.reason}`
    case 'source-removed':
      return `source-removed: ${change.sourceId} (layers: ${change.layerIds.join(', ')}) — ${change.reason}`
  }
}

function summarize(count: number): string {
  if (count === 0) return 'no changes'
  return count === 1 ? '1 change' : `${count} changes`
}

function fail(io: CliIo, message: string): number {
  io.stderr.write(`maplibrify: ${message}\n`)
  return 1
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function version(): string {
  const pkg: unknown = createRequire(import.meta.url)('../package.json')
  if (
    typeof pkg === 'object' &&
    pkg !== null &&
    'version' in pkg &&
    typeof pkg.version === 'string'
  ) {
    return pkg.version
  }
  throw new Error('no version in package.json')
}
