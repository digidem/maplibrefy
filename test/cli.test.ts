import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { PassThrough, Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/cli-main.js'
import { convertStyle } from '../src/convert.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version as string

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

function fixtureText(name: string): string {
  return readFileSync(fixturePath(name), 'utf8')
}

async function cli(argv: string[], stdin = '') {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const collected = Promise.all([text(stdout), text(stderr)])
  const code = await run(argv, {
    stdin: Readable.from([stdin]),
    stdout,
    stderr,
  })
  stdout.end()
  stderr.end()
  const [out, err] = await collected
  return { code, out, err }
}

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line !== '')
}

describe('run', () => {
  it('converts a file argument to stdout', async () => {
    const { code, out, err } = await cli([
      fixturePath('mapbox/streets-v12.json'),
    ])
    expect(code).toBe(0)
    const style = JSON.parse(out)
    expect(style.version).toBe(8)
    expect(out).toBe(`${JSON.stringify(style, null, 2)}\n`)
    expect(lines(err).at(-1)).toBe('2 changes')
  })

  it('reads stdin when no file is given', async () => {
    const source = fixtureText('mapbox/streets-v12.json')
    const fromStdin = await cli([], source)
    const fromFile = await cli([fixturePath('mapbox/streets-v12.json')])
    expect(fromStdin.code).toBe(0)
    expect(fromStdin.out).toBe(fromFile.out)
    expect(fromStdin.err).toBe(fromFile.err)
  })

  it('reads stdin for "-"', async () => {
    const { code, out } = await cli(['-'], fixtureText('maplibre-clean.json'))
    expect(code).toBe(0)
    expect(JSON.parse(out).version).toBe(8)
  })

  it('reports no changes for a style MapLibre already accepts', async () => {
    const { code, err } = await cli([fixturePath('maplibre-clean.json')])
    expect(code).toBe(0)
    expect(err).toBe('no changes\n')
  })

  it('--projection mercator forces mercator', async () => {
    const { code, out, err } = await cli([
      '--projection',
      'mercator',
      fixturePath('mapbox/streets-v12.json'),
    ])
    expect(code).toBe(0)
    expect(JSON.parse(out).projection).toEqual({ type: 'mercator' })
    expect(lines(err)).toContain('projection-rewritten: globe → mercator')
  })

  it('rejects an unknown --projection value', async () => {
    const { code, err } = await cli(['--projection', 'globe'])
    expect(code).toBe(1)
    expect(lines(err)).toHaveLength(1)
    expect(err).toMatch(/^maplibrify: --projection must be/)
  })

  it('--quiet keeps only the summary', async () => {
    const { code, err } = await cli([
      '--quiet',
      fixturePath('mapbox/streets-v12.json'),
    ])
    expect(code).toBe(0)
    expect(err).toBe('2 changes\n')
  })

  it('--help prints usage to stdout', async () => {
    const { code, out, err } = await cli(['--help'])
    expect(code).toBe(0)
    expect(out).toMatch(/Usage: maplibrify \[file\] \[options\]/)
    expect(err).toBe('')
  })

  it('--version prints the package version', async () => {
    const { code, out } = await cli(['--version'])
    expect(code).toBe(0)
    expect(out).toBe(`${packageVersion}\n`)
  })

  it('exits 1 on invalid JSON', async () => {
    const { code, out, err } = await cli([], '{ not json')
    expect(code).toBe(1)
    expect(out).toBe('')
    expect(lines(err)).toHaveLength(1)
    expect(err).toMatch(/^maplibrify: invalid JSON: /)
  })

  it('exits 1 on JSON that is not a style', async () => {
    const { code, out, err } = await cli([], '{"hello":"world"}')
    expect(code).toBe(1)
    expect(out).toBe('')
    expect(lines(err)).toHaveLength(1)
    expect(err).toMatch(/^maplibrify: convertStyle: expected a style object/)
  })

  it('exits 1 on an unreadable file', async () => {
    const { code, err } = await cli([fixturePath('does-not-exist.json')])
    expect(code).toBe(1)
    expect(lines(err)).toHaveLength(1)
    expect(err).toMatch(/ENOENT/)
  })

  it('exits 1 on an unknown flag', async () => {
    const { code, err } = await cli(['--nope'])
    expect(code).toBe(1)
    expect(err).toMatch(/^maplibrify: .*--nope/)
  })

  it('exits 1 on more than one file argument', async () => {
    const { code, err } = await cli(['a.json', 'b.json'])
    expect(code).toBe(1)
    expect(err).toMatch(/at most one file/)
  })

  it('describes every change kind the conversion reports', async () => {
    const { changes } = convertStyle(
      JSON.parse(fixtureText('studio-standard.json')),
    )
    const { code, err } = await cli([fixturePath('studio-standard.json')])
    expect(code).toBe(0)

    const reported = lines(err)
    const summary = reported.pop()
    expect(summary).toBe(`${changes.length} changes`)
    expect(reported).toHaveLength(changes.length)

    const kinds = new Set(changes.map((change) => change.kind))
    expect(kinds.size).toBeGreaterThan(1)
    for (const kind of kinds) {
      expect(reported.some((line) => line.startsWith(`${kind}: `))).toBe(true)
    }

    expect(reported).toContain('imports-removed: basemap')
    expect(reported).toContain('root-removed: fog')
    expect(reported).toContain('projection-rewritten: globe → globe')
    expect(reported).toContain(
      'expression-rewritten: layers[1].paint.fill-color hsl',
    )
    expect(reported).toContain(
      'property-removed: water paint.fill-emissive-strength — unknown property "fill-emissive-strength"',
    )
    expect(
      reported.find((line) => line.startsWith('layer-removed: sky')),
    ).toMatch(/^layer-removed: sky \(sky\) — expected one of \[/)
    expect(
      reported.find((line) => line.startsWith('source-removed: weather')),
    ).toMatch(/^source-removed: weather \(layers: wind, weather-raster\) — /)
  })

  it('describes property removals on sources and root objects', async () => {
    const { code, err } = await cli(
      [],
      JSON.stringify({
        version: 8,
        sources: { g: { type: 'geojson', data: 'https://x/a', dynamic: true } },
        layers: [],
        light: { anchor: 'map', foo: 1 },
      }),
    )
    expect(code).toBe(0)
    expect(lines(err)).toEqual([
      'root-property-removed: light.foo — unknown property "foo"',
      'source-property-removed: g dynamic — unknown property "dynamic"',
      '2 changes',
    ])
  })

  it('prints usage instead of waiting on a terminal stdin', async () => {
    const stdin = Object.assign(Readable.from([]), { isTTY: true })
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const collected = Promise.all([text(stdout), text(stderr)])
    const code = await run([], { stdin, stdout, stderr })
    stdout.end()
    stderr.end()
    const [out, err] = await collected
    expect(code).toBe(1)
    expect(out).toBe('')
    expect(err).toMatch(/^maplibrify — /)
    expect(err).toMatch(/Usage: maplibrify \[file\] \[options\]/)
  })

  it('still reads a terminal stdin when "-" is given', async () => {
    const stdin = Object.assign(
      Readable.from([fixtureText('maplibre-clean.json')]),
      { isTTY: true },
    )
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const collected = Promise.all([text(stdout), text(stderr)])
    const code = await run(['-'], { stdin, stdout, stderr })
    stdout.end()
    stderr.end()
    const [out] = await collected
    expect(code).toBe(0)
    expect(JSON.parse(out).version).toBe(8)
  })
})

describe('dist/cli.js', () => {
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

  beforeAll(() => {
    if (existsSync(cliPath)) return
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  }, 120_000)

  it('runs as a node script and keeps its shebang', () => {
    expect(readFileSync(cliPath, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/)

    const result = spawnSync(process.execPath, [cliPath], {
      input:
        '{"version":8,"layers":[],"sources":{},"projection":{"name":"globe"}}',
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).projection).toEqual({ type: 'globe' })
    expect(lines(result.stderr)).toEqual([
      'projection-rewritten: globe → globe',
      '1 change',
    ])
  })
})
