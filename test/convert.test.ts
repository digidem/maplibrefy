import { readFileSync } from 'node:fs'

import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { convertStyle } from '../src/index.js'
import type { Change, ConvertOptions } from '../src/types.js'

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8'))
}

function expectValid(style: unknown): void {
  const errors = validateStyleMin(style as never)
    .filter((error) => error.severity !== 'warning')
    .map((error) => error.message)
  expect(errors).toEqual([])
}

/** convertStyle plus the invariant every test relies on: the output validates. */
function convert(style: unknown, options?: ConvertOptions) {
  const result = convertStyle(style, options)
  expectValid(result.style)
  return result
}

function countKinds(changes: Change[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const change of changes) {
    counts[change.kind] = (counts[change.kind] ?? 0) + 1
  }
  return counts
}

type Layer = Record<string, unknown>

function style(overrides: Record<string, unknown> = {}, layers: Layer[] = []) {
  return {
    version: 8,
    sources: { v: { type: 'vector', url: 'https://example.com/tiles.json' } },
    layers,
    ...overrides,
  }
}

function line(overrides: Layer = {}): Layer {
  return {
    id: 'road',
    type: 'line',
    source: 'v',
    'source-layer': 'road',
    ...overrides,
  }
}

function layerIds(result: { style: { layers: { id: string }[] } }): string[] {
  return result.style.layers.map((layer) => layer.id)
}

describe('input handling', () => {
  it.each([
    null,
    undefined,
    42,
    'style.json',
    [],
    { version: 7, layers: [], sources: {} },
    { version: 8, sources: {} },
    { version: 8, layers: {}, sources: {} },
    { version: '8', layers: [], sources: {} },
  ])('throws TypeError for %j', (input) => {
    expect(() => convertStyle(input)).toThrow(TypeError)
  })

  it('does not mutate the input', () => {
    const input = fixture('studio-standard.json')
    const pristine = structuredClone(input)
    convert(input)
    expect(input).toEqual(pristine)
  })

  it('returns a plain MapLibre style unchanged', () => {
    const input = fixture('maplibre-clean.json')
    const result = convert(input)
    expect(result.changes).toEqual([])
    expect(result.style).toEqual(input)
    expect(result.style).not.toBe(input)
  })

  it('throws when the validator rejects sources, layers or version', () => {
    expect(() => convertStyle(style({ sources: [] }))).toThrow(/cannot repair/)
    expect(() => convertStyle({ version: 8, layers: [] })).toThrow(
      /cannot repair/,
    )
  })
})

describe('projection', () => {
  it('renames projection.name to projection.type', () => {
    const result = convert(style({ projection: { name: 'globe' } }))
    expect(result.style.projection).toEqual({ type: 'globe' })
    expect(result.changes).toEqual([
      { kind: 'projection-rewritten', from: 'globe', to: 'globe' },
    ])
  })

  it('forces mercator over a Mapbox globe projection', () => {
    const result = convert(style({ projection: { name: 'globe' } }), {
      projection: 'mercator',
    })
    expect(result.style.projection).toEqual({ type: 'mercator' })
    expect(result.changes).toEqual([
      { kind: 'projection-rewritten', from: 'globe', to: 'mercator' },
    ])
  })

  it('forces mercator over a MapLibre globe projection', () => {
    const result = convert(style({ projection: { type: 'globe' } }), {
      projection: 'mercator',
    })
    expect(result.style.projection).toEqual({ type: 'mercator' })
    expect(result.changes).toEqual([
      { kind: 'projection-rewritten', from: 'globe', to: 'mercator' },
    ])
  })

  it('leaves an existing mercator projection alone', () => {
    const result = convert(style({ projection: { type: 'mercator' } }), {
      projection: 'mercator',
    })
    expect(result.style.projection).toEqual({ type: 'mercator' })
    expect(result.changes).toEqual([])
  })

  it('does not add a projection when the style has none', () => {
    for (const projection of ['keep', 'mercator'] as const) {
      const result = convert(style(), { projection })
      expect(result.style).not.toHaveProperty('projection')
      expect(result.changes).toEqual([])
    }
  })

  it.each([
    'albers',
    'equalEarth',
    'naturalEarth',
    'winkelTripel',
    'lambertConformalConic',
    'equirectangular',
    'made-up',
  ])('rewrites the Mapbox-only %s projection to mercator', (name) => {
    for (const mode of ['keep', 'mercator'] as const) {
      const result = convert(
        style({ projection: { name, center: [0, 30], parallels: [30, 45] } }),
        { projection: mode },
      )
      expect(result.style.projection).toEqual({ type: 'mercator' })
      expect(result.changes).toEqual([
        { kind: 'projection-rewritten', from: name, to: 'mercator' },
      ])
    }
  })

  it('keeps a MapLibre vertical-perspective projection', () => {
    const result = convert(
      style({ projection: { type: 'vertical-perspective' } }),
    )
    expect(result.style.projection).toEqual({ type: 'vertical-perspective' })
    expect(result.changes).toEqual([])
  })

  it('drops center and parallels along with a rewritten type', () => {
    const result = convert(
      style({
        projection: { type: 'albers', center: [0, 0], parallels: [1, 2] },
      }),
    )
    expect(result.style.projection).toEqual({ type: 'mercator' })
    expect(result.changes).toEqual([
      { kind: 'projection-rewritten', from: 'albers', to: 'mercator' },
    ])
  })

  it('leaves a null projection to the validator', () => {
    const result = convert(style({ projection: null }), {
      projection: 'mercator',
    })
    expect(result.style).not.toHaveProperty('projection')
    expect(result.changes).toEqual([
      {
        kind: 'root-removed',
        key: 'projection',
        reason: 'object expected, null found',
      },
    ])
  })

  it('leaves an empty projection object alone', () => {
    for (const projection of ['keep', 'mercator'] as const) {
      const result = convert(style({ projection: {} }), { projection })
      expect(result.style.projection).toEqual({})
      expect(result.changes).toEqual([])
    }
  })

  it('leaves a projection with a non-string name to the validator', () => {
    const result = convert(style({ projection: { name: 5 } }), {
      projection: 'mercator',
    })
    expect(result.style.projection).toEqual({})
    expect(result.changes).toEqual([
      {
        kind: 'root-property-removed',
        key: 'projection',
        property: 'name',
        reason: 'unknown property "name"',
      },
    ])
  })
})

describe('Mapbox-only root keys', () => {
  it('removes imports and reports their ids', () => {
    const result = convert(
      style({
        imports: [
          { id: 'basemap', url: 'mapbox://styles/mapbox/standard' },
          { id: 'overlay', url: 'mapbox://styles/me/x' },
        ],
      }),
    )
    expect(result.style).not.toHaveProperty('imports')
    expect(result.changes).toEqual([
      { kind: 'imports-removed', ids: ['basemap', 'overlay'] },
    ])
  })

  it.each([
    'fog',
    'schema',
    'lights',
    'snow',
    'rain',
    'camera',
    'color-theme',
    'featuresets',
    'iconsets',
    'models',
    'indoor',
    'fragment',
  ])('removes %s with a root-removed change', (key) => {
    const result = convert(style({ [key]: { anything: true } }))
    expect(result.style).not.toHaveProperty(key)
    expect(result.changes).toEqual([
      { kind: 'root-removed', key, reason: expect.any(String) },
    ])
  })

  it('keeps Studio metadata keys', () => {
    const metadata = {
      id: 'abc',
      owner: 'me',
      created: '2025-01-01T00:00:00Z',
      modified: '2025-01-02T00:00:00Z',
      draft: true,
      visibility: 'private',
    }
    const result = convert(style(metadata))
    expect(result.style).toMatchObject(metadata)
    expect(result.changes).toEqual([])
  })
})

describe('Mapbox-only layer keys', () => {
  it('drops slot and appearances silently', () => {
    const result = convert(
      style({}, [
        line({
          slot: 'middle',
          appearances: [{ name: 'night', paint: { 'line-color': '#000' } }],
        }),
      ]),
    )
    expect(result.style.layers[0]).toEqual(line())
    expect(result.changes).toEqual([])
  })
})

describe('expression rewrites', () => {
  it('rewrites pitch to 0 with the path of the expression', () => {
    const result = convert(
      style({}, [
        line({
          paint: {
            'line-opacity': ['interpolate', ['linear'], ['pitch'], 0, 1, 60, 0],
          },
        }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({
      paint: { 'line-opacity': ['interpolate', ['linear'], 0, 0, 1, 60, 0] },
    })
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].paint.line-opacity[2]',
        operator: 'pitch',
      },
    ])
  })

  it('rewrites distance-from-center in layout', () => {
    const result = convert(
      style({}, [
        line({ layout: { 'line-sort-key': ['distance-from-center'] } }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({
      layout: { 'line-sort-key': 0 },
    })
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].layout.line-sort-key',
        operator: 'distance-from-center',
      },
    ])
  })

  it('rewrites measure-light to 1', () => {
    const result = convert(
      style({}, [
        line({
          paint: { 'line-width': ['*', 3, ['measure-light', 'brightness']] },
        }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({
      paint: { 'line-width': ['*', 3, 1] },
    })
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].paint.line-width[2]',
        operator: 'measure-light',
      },
    ])
  })

  it('rewrites hsl to a to-color string', () => {
    const result = convert(
      style({}, [line({ paint: { 'line-color': ['hsl', 200, 60, 50] } })]),
    )
    expect(result.style.layers[0]).toMatchObject({
      paint: {
        'line-color': [
          'to-color',
          ['concat', 'hsl(', 200, ', ', 60, '%, ', 50, '%)'],
        ],
      },
    })
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].paint.line-color',
        operator: 'hsl',
      },
    ])
  })

  it('rewrites hsla with expression arguments', () => {
    const result = convert(
      style({}, [
        line({
          paint: {
            'line-color': ['hsla', ['get', 'hue'], 50, ['+', 40, 10], 0.8],
          },
        }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({
      paint: {
        'line-color': [
          'to-color',
          [
            'concat',
            'hsla(',
            ['get', 'hue'],
            ', ',
            50,
            '%, ',
            ['+', 40, 10],
            '%, ',
            0.8,
            ')',
          ],
        ],
      },
    })
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].paint.line-color',
        operator: 'hsla',
      },
    ])
  })

  it('rewrites inside filters', () => {
    const result = convert(
      style({}, [
        line({
          filter: ['all', ['has', 'name'], ['>=', ['zoom'], ['pitch']]],
        }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({
      filter: ['all', ['has', 'name'], ['>=', ['zoom'], 0]],
    })
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].filter[2][2]',
        operator: 'pitch',
      },
    ])
  })

  it('reports nested rewrites innermost first', () => {
    const result = convert(
      style({}, [
        line({ paint: { 'line-color': ['hsl', ['pitch'], 50, 50] } }),
      ]),
    )
    expect(result.changes).toEqual([
      {
        kind: 'expression-rewritten',
        path: 'layers[0].paint.line-color[1]',
        operator: 'pitch',
      },
      {
        kind: 'expression-rewritten',
        path: 'layers[0].paint.line-color',
        operator: 'hsl',
      },
    ])
  })

  it('leaves literal arrays, match labels and legacy functions alone', () => {
    const layer = line({
      layout: {
        'text-font': ['literal', ['pitch']],
        'text-offset': [0, 1],
        'text-field': ['match', ['get', 'k'], ['pitch', 'hsl'], 'a', 'b'],
        'text-size': {
          stops: [
            [0, 1],
            [10, 2],
          ],
        },
      },
    })
    layer.type = 'symbol'
    const result = convert(style({}, [layer]))
    expect(result.style.layers[0]).toEqual(layer)
    expect(result.changes).toEqual([])
  })

  it('does not rewrite inside legacy functions; the validator drops them', () => {
    const result = convert(
      style({}, [
        line({
          paint: {
            'line-width': {
              stops: [
                [0, 1],
                [10, ['pitch']],
              ],
            },
          },
        }),
      ]),
    )
    expect(result.style.layers[0]).not.toHaveProperty('paint.line-width')
    expect(result.changes).toEqual([
      {
        kind: 'property-removed',
        layerId: 'road',
        group: 'paint',
        property: 'line-width',
        reason: expect.any(String),
      },
    ])
  })

  it('leaves an hsl with the wrong arity to the validator', () => {
    const result = convert(
      style({}, [line({ paint: { 'line-color': ['hsl', 1, 2] } })]),
    )
    expect(countKinds(result.changes)).toEqual({ 'property-removed': 1 })
  })
})

describe('validator-driven pruning', () => {
  it('removes an unknown paint property', () => {
    const result = convert(
      style({}, [
        line({ paint: { 'line-emissive-strength': 1, 'line-width': 2 } }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({ paint: { 'line-width': 2 } })
    expect(result.style.layers[0]).not.toHaveProperty(
      'paint.line-emissive-strength',
    )
    expect(result.changes).toEqual([
      {
        kind: 'property-removed',
        layerId: 'road',
        group: 'paint',
        property: 'line-emissive-strength',
        reason: 'unknown property "line-emissive-strength"',
      },
    ])
  })

  it('removes an unknown layout property', () => {
    const result = convert(
      style({}, [
        line({
          id: 'poi',
          type: 'symbol',
          layout: { 'symbol-z-elevate': true, 'text-field': ['get', 'name'] },
        }),
      ]),
    )
    expect(result.changes).toEqual([
      {
        kind: 'property-removed',
        layerId: 'poi',
        group: 'layout',
        property: 'symbol-z-elevate',
        reason: 'unknown property "symbol-z-elevate"',
      },
    ])
  })

  it('removes a property with an unknown enum value', () => {
    const result = convert(
      style({}, [
        line({ layout: { 'line-join': 'foo', 'line-cap': 'round' } }),
      ]),
    )
    expect(result.style.layers[0]).toMatchObject({
      layout: { 'line-cap': 'round' },
    })
    expect(result.changes).toEqual([
      {
        kind: 'property-removed',
        layerId: 'road',
        group: 'layout',
        property: 'line-join',
        reason: 'expected one of [bevel, round, miter], "foo" found',
      },
    ])
  })

  it('removes a property using a config expression', () => {
    const result = convert(
      style({}, [line({ paint: { 'line-color': ['config', 'accent'] } })]),
    )
    expect(result.changes).toEqual([
      {
        kind: 'property-removed',
        layerId: 'road',
        group: 'paint',
        property: 'line-color',
        reason: 'color expected, array found',
      },
    ])
  })

  it('removes a property whose nested expression is unknown', () => {
    const result = convert(
      style({}, [
        line({
          paint: {
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              ['config', 'w'],
            ],
          },
        }),
      ]),
    )
    expect(result.changes).toEqual([
      {
        kind: 'property-removed',
        layerId: 'road',
        group: 'paint',
        property: 'line-width',
        reason: expect.stringContaining('Unknown expression "config"'),
      },
    ])
  })

  it('removes a filter MapLibre rejects', () => {
    const result = convert(
      style({}, [line({ filter: ['==', ['config', 'x'], 1] })]),
    )
    expect(result.style.layers[0]).not.toHaveProperty('filter')
    expect(result.changes).toEqual([
      {
        kind: 'filter-removed',
        layerId: 'road',
        reason: expect.stringContaining('Unknown expression "config"'),
      },
    ])
  })

  it.each([
    ['model', { source: 'v', 'source-layer': 'x' }],
    ['raster-particle', { source: 'v' }],
    ['sky', {}],
    ['slot', {}],
    ['clip', { source: 'v', 'source-layer': 'x' }],
    ['building', { source: 'v', 'source-layer': 'x' }],
  ])('removes a %s layer with one change', (type, extra) => {
    const result = convert(
      style({}, [{ id: `the-${type}`, type, ...extra }, line()]),
    )
    expect(layerIds(result)).toEqual(['road'])
    expect(result.changes).toEqual([
      {
        kind: 'layer-removed',
        layerId: `the-${type}`,
        layerType: type,
        reason: expect.stringContaining(`"${type}" found`),
      },
    ])
  })

  it('removes a layer whose definition cannot be repaired', () => {
    const result = convert(
      style({}, [
        line({ id: 'no-source-layer', 'source-layer': undefined }),
        line({ id: 'missing-source', source: 'nope' }),
        line(),
      ]),
    )
    expect(layerIds(result)).toEqual(['road'])
    expect(result.changes).toEqual([
      {
        kind: 'layer-removed',
        layerId: 'no-source-layer',
        layerType: 'line',
        reason: expect.stringContaining('source-layer'),
      },
      {
        kind: 'layer-removed',
        layerId: 'missing-source',
        layerType: 'line',
        reason: 'source "nope" not found',
      },
    ])
  })

  it('removes a Mapbox-only source and every layer using it', () => {
    const result = convert(
      style(
        {
          sources: {
            v: { type: 'vector', url: 'https://example.com/tiles.json' },
            weather: { type: 'raster-array', url: 'mapbox://x.weather' },
          },
        },
        [
          { id: 'wind', type: 'raster-particle', source: 'weather' },
          line(),
          { id: 'clouds', type: 'raster', source: 'weather' },
        ],
      ),
    )
    expect(result.style.sources).not.toHaveProperty('weather')
    expect(layerIds(result)).toEqual(['road'])
    expect(result.changes).toEqual([
      {
        kind: 'source-removed',
        sourceId: 'weather',
        layerIds: ['wind', 'clouds'],
        reason: expect.stringContaining('"raster-array" found'),
      },
    ])
  })

  it('matches source ids containing dots', () => {
    const result = convert(
      style(
        {
          sources: {
            'a.b': { type: 'vector', url: 'https://example.com/a.json' },
            'a.b.c': { type: 'model', url: 'mapbox://x' },
          },
        },
        [line({ source: 'a.b' }), { id: 'm', type: 'model', source: 'a.b.c' }],
      ),
    )
    expect(Object.keys(result.style.sources)).toEqual(['a.b'])
    expect(result.changes).toEqual([
      {
        kind: 'source-removed',
        sourceId: 'a.b.c',
        layerIds: ['m'],
        reason: expect.any(String),
      },
    ])
  })

  it.each([
    ['sprite', 5, 'string expected, number found'],
    ['glyphs', 7, 'string expected, number found'],
    ['light', { anchor: 'bogus' }, expect.stringContaining('"bogus" found')],
    ['center', 'here', 'array expected, string found'],
  ])(
    'removes root key %s when the validator rejects it',
    (key, value, reason) => {
      const result = convert(style({ [key]: value }))
      expect(result.style).not.toHaveProperty(key)
      expect(result.changes).toEqual([{ kind: 'root-removed', key, reason }])
    },
  )

  it.each([
    ['sky', 'sky-type', { 'sky-color': '#123' }],
    ['light', 'foo', { anchor: 'map' }],
    ['terrain', 'foo', { source: 'dem' }],
    ['projection', 'foo', { type: 'globe' }],
  ])(
    'removes only an unknown property from root key %s',
    (key, property, rest) => {
      const value = { ...rest, [property]: 'anything' }
      const result = convert(
        style({
          sources: { dem: { type: 'raster-dem', url: 'https://x/dem.json' } },
          [key]: value,
        }),
      )
      expect(result.style).toHaveProperty(key, rest)
      expect(result.changes).toEqual([
        {
          kind: 'root-property-removed',
          key,
          property,
          reason: `unknown property "${property}"`,
        },
      ])
    },
  )

  it('blames projection, not the root center, for projection.center', () => {
    const result = convert(
      style({
        center: [10, 20],
        projection: { type: 'mercator', center: [0, 0] },
      }),
    )
    expect(result.style).toMatchObject({
      center: [10, 20],
      projection: { type: 'mercator' },
    })
    expect(result.changes).toEqual([
      {
        kind: 'root-property-removed',
        key: 'projection',
        property: 'center',
        reason: 'unknown property "center"',
      },
    ])
  })

  it('resolves the same unknown property reported by two owners', () => {
    const result = convert(
      style({
        projection: { type: 'globe', foo: 1 },
        light: { anchor: 'map', foo: 2 },
      }),
    )
    expect(result.style).toMatchObject({
      projection: { type: 'globe' },
      light: { anchor: 'map' },
    })
    expect(result.changes).toEqual([
      expect.objectContaining({
        kind: 'root-property-removed',
        key: 'projection',
        property: 'foo',
      }),
      expect.objectContaining({
        kind: 'root-property-removed',
        key: 'light',
        property: 'foo',
      }),
    ])
  })

  it('removes an unknown source property and keeps the source', () => {
    const result = convert(
      style(
        {
          sources: {
            g: { type: 'geojson', data: 'https://x/a.json', dynamic: true },
          },
        },
        [{ id: 'dots', type: 'circle', source: 'g' }],
      ),
    )
    expect(result.style.sources.g).toEqual({
      type: 'geojson',
      data: 'https://x/a.json',
    })
    expect(layerIds(result)).toEqual(['dots'])
    expect(result.changes).toEqual([
      {
        kind: 'source-property-removed',
        sourceId: 'g',
        property: 'dynamic',
        reason: 'unknown property "dynamic"',
      },
    ])
  })

  it('removes a source property with a bad value', () => {
    const result = convert(
      style({
        sources: {
          v: { type: 'vector', url: 'https://x/t.json', minzoom: 'low' },
        },
      }),
    )
    expect(result.style.sources.v).toEqual({
      type: 'vector',
      url: 'https://x/t.json',
    })
    expect(result.changes).toEqual([
      {
        kind: 'source-property-removed',
        sourceId: 'v',
        property: 'minzoom',
        reason: 'number expected, string found',
      },
    ])
  })

  it('removes a source the validator rejects as a whole', () => {
    const result = convert(
      style({ sources: { g: { type: 'geojson', dynamic: true } } }, [
        { id: 'dots', type: 'circle', source: 'g' },
      ]),
    )
    expect(result.style.sources).toEqual({})
    expect(layerIds(result)).toEqual([])
    expect(result.changes).toEqual([
      {
        kind: 'source-removed',
        sourceId: 'g',
        layerIds: ['dots'],
        reason: 'missing required property "data"',
      },
    ])
  })

  it('matches a source id containing ": "', () => {
    const result = convert(
      style(
        {
          sources: {
            'my: src': { type: 'raster-array', url: 'mapbox://x' },
            'my: other': {
              type: 'geojson',
              data: 'https://x/a.json',
              dynamic: true,
            },
          },
        },
        [{ id: 'w', type: 'raster', source: 'my: src' }],
      ),
    )
    expect(Object.keys(result.style.sources)).toEqual(['my: other'])
    expect(result.changes).toEqual([
      {
        kind: 'source-removed',
        sourceId: 'my: src',
        layerIds: ['w'],
        reason: expect.stringContaining('"raster-array" found'),
      },
      {
        kind: 'source-property-removed',
        sourceId: 'my: other',
        property: 'dynamic',
        reason: 'unknown property "dynamic"',
      },
    ])
  })

  it('removes terrain along with its source', () => {
    const result = convert(
      style(
        {
          sources: {
            v: { type: 'vector', url: 'https://x/t.json' },
            dem: { type: 'raster-array', url: 'mapbox://x.dem' },
          },
          terrain: { source: 'dem', exaggeration: 1.5 },
        },
        [{ id: 'hills', type: 'hillshade', source: 'dem' }, line()],
      ),
    )
    expect(result.style).not.toHaveProperty('terrain')
    expect(layerIds(result)).toEqual(['road'])
    expect(result.changes).toEqual([
      {
        kind: 'source-removed',
        sourceId: 'dem',
        layerIds: ['hills'],
        reason: expect.stringContaining('"raster-array" found'),
      },
      {
        kind: 'root-removed',
        key: 'terrain',
        reason: 'its source "dem" was removed',
      },
    ])
  })

  it('reports real layer ids when several layers go in one pass', () => {
    const result = convert(
      style({}, [
        { id: 'sky', type: 'sky' },
        line({ id: 'a', paint: { 'line-z-offset': 1 } }),
        { id: 'models', type: 'model', source: 'v', 'source-layer': 'x' },
        line({ id: 'b', filter: ['==', ['config', 'x'], 1] }),
        { id: 'clip', type: 'clip', source: 'v', 'source-layer': 'x' },
      ]),
    )
    expect(layerIds(result)).toEqual(['a', 'b'])
    expect(result.changes).toEqual([
      expect.objectContaining({ kind: 'layer-removed', layerId: 'sky' }),
      expect.objectContaining({ kind: 'layer-removed', layerId: 'models' }),
      expect.objectContaining({ kind: 'layer-removed', layerId: 'clip' }),
      expect.objectContaining({
        kind: 'property-removed',
        layerId: 'a',
        property: 'line-z-offset',
      }),
      expect.objectContaining({ kind: 'filter-removed', layerId: 'b' }),
    ])
  })

  it('does not report property changes for a layer that is removed anyway', () => {
    const result = convert(
      style({}, [
        { id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere' } },
      ]),
    )
    expect(countKinds(result.changes)).toEqual({ 'layer-removed': 1 })
  })
})

describe('fixtures', () => {
  it('converts Mapbox Streets v12 losing no layers', () => {
    const input = fixture('mapbox/streets-v12.json') as { layers: unknown[] }
    expect(input.layers).toHaveLength(134)
    const result = convert(input)
    expect(result.style.layers).toHaveLength(134)
    expect(result.style.projection).toEqual({ type: 'globe' })
    expect(result.changes).toEqual([
      { kind: 'projection-rewritten', from: 'globe', to: 'globe' },
      { kind: 'root-removed', key: 'fog', reason: expect.any(String) },
    ])
  })

  it('forces Mapbox Streets v12 to mercator', () => {
    const result = convert(fixture('mapbox/streets-v12.json'), {
      projection: 'mercator',
    })
    expect(result.style.projection).toEqual({ type: 'mercator' })
    expect(result.changes).toContainEqual({
      kind: 'projection-rewritten',
      from: 'globe',
      to: 'mercator',
    })
  })

  it('converts a Standard-based Studio style', () => {
    const result = convert(fixture('studio-standard.json'))
    const { style: output, changes } = result

    expect(layerIds(result)).toEqual(['water', 'roads', 'poi', 'bg'])
    expect(Object.keys(output.sources)).toEqual(['composite'])
    for (const key of ['imports', 'schema', 'fog', 'lights']) {
      expect(output).not.toHaveProperty(key)
    }
    expect(output).toMatchObject({
      projection: { type: 'globe' },
      id: 'abc123',
      owner: 'someone',
    })
    expect(output.layers[1]).not.toHaveProperty('slot')
    expect(output.layers[1]).not.toHaveProperty('appearances')

    expect(countKinds(changes)).toEqual({
      'projection-rewritten': 1,
      'imports-removed': 1,
      'root-removed': 3,
      'expression-rewritten': 7,
      'source-removed': 2,
      'layer-removed': 1,
      'property-removed': 5,
    })
    expect(changes).toContainEqual({
      kind: 'imports-removed',
      ids: ['basemap'],
    })
    expect(changes).toContainEqual({
      kind: 'source-removed',
      sourceId: 'weather',
      layerIds: ['wind', 'weather-raster'],
      reason: expect.any(String),
    })
    expect(changes).toContainEqual({
      kind: 'source-removed',
      sourceId: 'buildings',
      layerIds: ['models'],
      reason: expect.any(String),
    })
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: 'layer-removed', layerId: 'sky' }),
    )
    const paths = changes
      .filter((change) => change.kind === 'expression-rewritten')
      .map((change) => `${change.path} ${change.operator}`)
    expect(paths).toEqual([
      'layers[1].paint.fill-color hsl',
      'layers[2].paint.line-width[6][2] measure-light',
      'layers[2].paint.line-opacity[2] pitch',
      'layers[2].layout.line-sort-key distance-from-center',
      'layers[2].filter[2][2] pitch',
      'layers[3].paint.text-color hsla',
      'layers[3].layout.text-size[1] distance-from-center',
    ])
    const removed = changes
      .filter((change) => change.kind === 'property-removed')
      .map((change) => `${change.layerId} ${change.group}.${change.property}`)
    expect(removed.sort()).toEqual([
      'poi layout.symbol-z-elevate',
      'roads layout.line-join',
      'roads paint.line-color',
      'roads paint.line-z-offset',
      'water paint.fill-emissive-strength',
    ])
  })
})
