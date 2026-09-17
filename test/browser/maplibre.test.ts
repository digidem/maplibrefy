import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { Map as MaplibreMap } from 'maplibre-gl'
import { afterEach, describe, expect, it } from 'vitest'

import { convertStyle, createTransformStyle } from '../../src/index.js'
import type { Change } from '../../src/index.js'
import streetsV12 from '../fixtures/mapbox/streets-v12.json' with { type: 'json' }
import maplibreClean from '../fixtures/maplibre-clean.json' with { type: 'json' }
import studioStandard from '../fixtures/studio-standard.json' with { type: 'json' }

/** Long enough for a style to parse; nothing here waits on the network. */
const LOAD_TIMEOUT = 5000
/** How long a style MapLibre rejects gets to prove it does not load. */
const REJECT_TIMEOUT = 1500

interface StyleLoadResult {
  loaded: boolean
  /** Errors fired before `style.load` that no source owns — the ones that
   *  mean MapLibre rejected the style itself. Sprite, glyph and tile fetch
   *  failures either carry a `sourceId` or arrive after `style.load`. */
  styleErrors: string[]
}

let active: { map: MaplibreMap; container: HTMLElement } | undefined

afterEach(() => {
  active?.map.remove()
  active?.container.remove()
  active = undefined
})

function createMap(style?: StyleSpecification): MaplibreMap {
  const container = document.createElement('div')
  container.style.width = '256px'
  container.style.height = '256px'
  document.body.append(container)
  const map = new MaplibreMap({
    container,
    ...(style ? { style } : {}),
    interactive: false,
    attributionControl: false,
  })
  active = { map, container }
  return map
}

/** Point every URL in a style at this origin, where it 404s immediately, so
 *  the only difference between the raw and converted runs is the conversion. */
function localize<T>(style: T): StyleSpecification {
  const clone = structuredClone(style) as Record<string, unknown> & {
    sources?: Record<string, Record<string, unknown>>
  }
  clone.sprite = `${location.origin}/nonexistent/sprite`
  clone.glyphs = `${location.origin}/nonexistent/{fontstack}/{range}.pbf`
  for (const source of Object.values(clone.sources ?? {})) {
    if (typeof source.url !== 'string') continue
    delete source.url
    source.tiles = [`${location.origin}/nonexistent/{z}/{x}/{y}.pbf`]
  }
  return clone as unknown as StyleSpecification
}

function watchStyleLoad(
  map: MaplibreMap,
  timeoutMs: number,
): Promise<StyleLoadResult> {
  const styleErrors: string[] = []
  return new Promise((resolve) => {
    let settled = false
    const finish = (loaded: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ loaded, styleErrors })
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    map.on('error', (event) => {
      if (settled) return
      if ((event as { sourceId?: string }).sourceId !== undefined) return
      styleErrors.push(event.error.message)
    })
    map.once('style.load', () => finish(true))
  })
}

describe.each([
  ['mapbox/streets-v12', streetsV12],
  ['studio-standard', studioStandard],
  ['maplibre-clean', maplibreClean],
])('converted %s', (_name, fixture) => {
  it('reaches style.load with no style-level error', async () => {
    const map = createMap(localize(convertStyle(fixture).style))
    const { loaded, styleErrors } = await watchStyleLoad(map, LOAD_TIMEOUT)

    expect(styleErrors).toEqual([])
    expect(loaded).toBe(true)
  })
})

describe('raw Mapbox styles', () => {
  it('streets-v12 is rejected over projection.name', async () => {
    const map = createMap(localize(streetsV12))
    const { loaded, styleErrors } = await watchStyleLoad(map, REJECT_TIMEOUT)

    expect(loaded).toBe(false)
    // MapLibre names the key relative to the projection object it was
    // validating, so the message is `name: …`, not `projection.name: …`.
    expect(styleErrors.join('\n')).toMatch(/unknown property "name"/)
  })

  it('studio-standard is rejected over its Mapbox-only types', async () => {
    const map = createMap(localize(studioStandard))
    const { loaded, styleErrors } = await watchStyleLoad(map, REJECT_TIMEOUT)

    expect(loaded).toBe(false)
    const messages = styleErrors.join('\n')
    expect(messages).toMatch(/unknown property "name"/)
    expect(messages).toMatch(/"sky" found/)
    expect(messages).toMatch(/"model" found/)
    expect(messages).toMatch(/Unknown expression "pitch"/)
  })
})

it('maplibre-clean loads raw and is left alone by the converter', async () => {
  expect(convertStyle(maplibreClean).changes).toEqual([])

  const map = createMap(localize(maplibreClean))
  const { loaded, styleErrors } = await watchStyleLoad(map, LOAD_TIMEOUT)

  expect(styleErrors).toEqual([])
  expect(loaded).toBe(true)
})

it('setStyle with createTransformStyle loads a raw Mapbox style', async () => {
  const map = createMap()
  const seen: Change[][] = []
  map.setStyle(localize(streetsV12), {
    transformStyle: createTransformStyle({
      onChanges: (changes) => seen.push(changes),
    }),
  })
  const { loaded, styleErrors } = await watchStyleLoad(map, LOAD_TIMEOUT)

  expect(styleErrors).toEqual([])
  expect(loaded).toBe(true)
  expect(seen).toHaveLength(1)
  expect(seen[0]?.length).toBeGreaterThan(0)
})
