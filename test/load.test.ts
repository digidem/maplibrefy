import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { loadStyle } from '../src/load.js'

const TOKEN = 'pk.test'

const MINIMAL = {
  version: 8,
  sources: {},
  layers: [],
}

interface FakeFetch {
  (input: string | URL | Request): Promise<Response>
  calls: string[]
}

/** A fetch that answers every request with `body`, recording the URLs asked
 *  for. `responseUrl` fakes a redirect; '' fakes a response with no URL. */
function fakeFetch(
  body: unknown,
  { status = 200, responseUrl }: { status?: number; responseUrl?: string } = {},
): FakeFetch {
  const calls: string[] = []
  const fn = (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : String(input)
    calls.push(url)
    const response = new Response(JSON.stringify(body), {
      status,
      statusText: status === 404 ? 'Not Found' : 'OK',
      headers: { 'content-type': 'application/json' },
    })
    Object.defineProperty(response, 'url', {
      value: responseUrl ?? url,
    })
    return Promise.resolve(response)
  }
  return Object.assign(fn, { calls })
}

describe('resolving the style URL', () => {
  it('fetches a mapbox:// style URI with the option token', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle('mapbox://styles/acme/ckabc123', {
      accessToken: TOKEN,
      fetch,
    })
    expect(fetch.calls).toEqual([
      `https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=${TOKEN}`,
    ])
  })

  it('honours a token in the URL', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle(
      'https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=pk.url',
      { fetch },
    )
    expect(fetch.calls).toEqual([
      'https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=pk.url',
    ])
  })

  it('prefers the option token over the one in the URL', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle(
      'https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=pk.url',
      { accessToken: TOKEN, fetch },
    )
    expect(fetch.calls).toEqual([
      `https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=${TOKEN}`,
    ])
  })

  it('throws without a token for a mapbox style', async () => {
    const fetch = fakeFetch(MINIMAL)
    await expect(
      loadStyle('mapbox://styles/acme/ckabc123', { fetch }),
    ).rejects.toThrow(/access token is required/i)
    expect(fetch.calls).toEqual([])
  })

  it('resolves a Studio share URL to the API', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle('https://studio.mapbox.com/styles/acme/ckabc123/edit/', {
      accessToken: TOKEN,
      fetch,
    })
    expect(fetch.calls).toEqual([
      `https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=${TOKEN}`,
    ])
  })

  it('passes a plain https URL through', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle('https://example.com/styles/s.json?v=2', { fetch })
    expect(fetch.calls).toEqual(['https://example.com/styles/s.json?v=2'])
  })

  it('fetches an API style URL as pasted, keeping its query', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle(
      'https://api.mapbox.com/styles/v1/acme/ckabc123?fresh=true&access_token=pk.url',
      { fetch },
    )
    expect(fetch.calls).toEqual([
      'https://api.mapbox.com/styles/v1/acme/ckabc123?fresh=true&access_token=pk.url',
    ])
  })

  it('replaces the token of a pasted API style URL with the option token', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle(
      'https://api.mapbox.com/styles/v1/acme/ckabc123/draft?fresh=true&access_token=pk.url',
      { accessToken: TOKEN, fetch },
    )
    expect(fetch.calls).toEqual([
      `https://api.mapbox.com/styles/v1/acme/ckabc123/draft?fresh=true&access_token=${TOKEN}`,
    ])
  })

  it('adds the option token to a pasted API style URL without one', async () => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle(
      'https://api.mapbox.com/styles/v1/acme/ckabc123?fresh=true',
      {
        accessToken: TOKEN,
        fetch,
      },
    )
    expect(fetch.calls).toEqual([
      `https://api.mapbox.com/styles/v1/acme/ckabc123?fresh=true&access_token=${TOKEN}`,
    ])
  })

  it('throws for a pasted API style URL with no token anywhere', async () => {
    const fetch = fakeFetch(MINIMAL)
    await expect(
      loadStyle('https://api.mapbox.com/styles/v1/acme/ckabc123?fresh=true', {
        fetch,
      }),
    ).rejects.toThrow(/access token is required/i)
    expect(fetch.calls).toEqual([])
  })

  it.each([
    'https://api.mapbox.com/styles/v1/acme/ckabc123.html?fresh=true&access_token=pk.url',
    'https://api.mapbox.com/styles/v1/acme/ckabc123/wmts?fresh=true&access_token=pk.url',
    'https://api.mapbox.com/styles/v1/acme/ckabc123/?fresh=true&access_token=pk.url',
    'http://api.mapbox.com/styles/v1/acme/ckabc123?fresh=true&access_token=pk.url',
  ])('collapses %s to the API style URL', async (url) => {
    const fetch = fakeFetch(MINIMAL)
    await loadStyle(url, { fetch })
    expect(fetch.calls).toEqual([
      'https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=pk.url',
    ])
  })

  it('throws a TypeError for a non-http URL', async () => {
    const fetch = fakeFetch(MINIMAL)
    await expect(
      loadStyle('file:///tmp/style.json', { fetch }),
    ).rejects.toThrow(TypeError)
    await expect(loadStyle('./style.json', { fetch })).rejects.toThrow(
      TypeError,
    )
  })

  it('throws a TypeError for a mapbox:// URL that is not a style', async () => {
    const fetch = fakeFetch(MINIMAL)
    await expect(
      loadStyle('mapbox://mapbox.mapbox-streets-v8', {
        accessToken: TOKEN,
        fetch,
      }),
    ).rejects.toThrow(TypeError)
  })
})

it('throws with the status and URL on a failed response', async () => {
  const fetch = fakeFetch({}, { status: 404 })
  await expect(
    loadStyle('https://example.com/nope.json', { fetch }),
  ).rejects.toThrow(/404.*https:\/\/example\.com\/nope\.json/)
})

describe('resolving relative URLs in the style', () => {
  const relative = {
    version: 8,
    sprite: './sprite',
    glyphs: './fonts/{fontstack}/{range}.pbf',
    sources: {
      vector: { type: 'vector', url: 'tiles/index.json' },
      points: { type: 'geojson', data: '../data/points.geojson' },
    },
    layers: [],
  }

  it('resolves against the response URL', async () => {
    const { style } = await loadStyle('https://example.com/asked.json', {
      fetch: fakeFetch(relative, {
        responseUrl: 'https://cdn.example.com/styles/s.json',
      }),
    })
    expect(style.sprite).toBe('https://cdn.example.com/styles/sprite')
    expect(style.glyphs).toBe(
      'https://cdn.example.com/styles/fonts/{fontstack}/{range}.pbf',
    )
    expect(style.sources.vector).toMatchObject({
      url: 'https://cdn.example.com/styles/tiles/index.json',
    })
    expect(style.sources.points).toMatchObject({
      data: 'https://cdn.example.com/data/points.geojson',
    })
  })

  it('falls back to the request URL when the response has none', async () => {
    const { style } = await loadStyle('https://example.com/styles/s.json', {
      fetch: fakeFetch(relative, { responseUrl: '' }),
    })
    expect(style.sprite).toBe('https://example.com/styles/sprite')
    expect(style.glyphs).toBe(
      'https://example.com/styles/fonts/{fontstack}/{range}.pbf',
    )
  })

  it('leaves absolute and mapbox:// values untouched', async () => {
    const { style } = await loadStyle('https://example.com/styles/s.json', {
      fetch: fakeFetch({
        version: 8,
        sprite: 'mapbox://sprites/mapbox/streets-v12',
        glyphs: 'https://fonts.example.com/{fontstack}/{range}.pbf',
        sources: {
          vector: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
          points: {
            type: 'geojson',
            data: 'https://example.org/points.geojson',
          },
        },
        layers: [],
      }),
    })
    expect(style.sprite).toBe('mapbox://sprites/mapbox/streets-v12')
    expect(style.glyphs).toBe(
      'https://fonts.example.com/{fontstack}/{range}.pbf',
    )
    expect(style.sources.vector).toMatchObject({
      url: 'mapbox://mapbox.mapbox-streets-v8',
    })
    expect(style.sources.points).toMatchObject({
      data: 'https://example.org/points.geojson',
    })
  })

  it('leaves data: and blob: values untouched', async () => {
    const data = 'data:application/geo+json,{"type":"FeatureCollection"}'
    const blob = 'blob:https://example.com/0b6a1b2c'
    const { style } = await loadStyle('https://example.com/styles/s.json', {
      fetch: fakeFetch({
        version: 8,
        sprite: blob,
        sources: { points: { type: 'geojson', data } },
        layers: [],
      }),
    })
    expect(style.sprite).toBe(blob)
    expect(style.sources.points).toMatchObject({ data })
  })

  it('resolves each entry of a sprite array', async () => {
    const { style } = await loadStyle('https://example.com/styles/s.json', {
      fetch: fakeFetch({
        version: 8,
        sprite: [
          { id: 'default', url: './sprite' },
          { id: 'extra', url: 'https://example.org/extra' },
        ],
        sources: {},
        layers: [],
      }),
    })
    expect(style.sprite).toEqual([
      { id: 'default', url: 'https://example.com/styles/sprite' },
      { id: 'extra', url: 'https://example.org/extra' },
    ])
  })

  it('leaves a source tiles template untouched', async () => {
    const { style } = await loadStyle('https://example.com/styles/s.json', {
      fetch: fakeFetch({
        version: 8,
        sources: {
          raster: {
            type: 'raster',
            tiles: ['tiles/{z}/{x}/{y}.png'],
            tileSize: 256,
          },
        },
        layers: [],
      }),
    })
    expect(style.sources.raster).toMatchObject({
      tiles: ['tiles/{z}/{x}/{y}.png'],
    })
  })

  it('leaves a geojson object data value untouched', async () => {
    const data = { type: 'FeatureCollection', features: [] }
    const { style } = await loadStyle('https://example.com/styles/s.json', {
      fetch: fakeFetch({
        version: 8,
        sources: { points: { type: 'geojson', data } },
        layers: [],
      }),
    })
    expect(style.sources.points).toMatchObject({ data })
  })
})

it('converts the fetched style', async () => {
  const streets: unknown = JSON.parse(
    await readFile(
      new URL('./fixtures/mapbox/streets-v12.json', import.meta.url),
      'utf8',
    ),
  )
  const { style, changes } = await loadStyle(
    'mapbox://styles/mapbox/streets-v12',
    {
      accessToken: TOKEN,
      fetch: fakeFetch(streets),
    },
  )
  expect(changes.map((change) => change.kind)).toContain('projection-rewritten')
  expect(style.layers.length).toBeGreaterThan(0)
})

it('passes projection: mercator through to the conversion', async () => {
  const { style, changes } = await loadStyle(
    'https://example.com/styles/s.json',
    {
      projection: 'mercator',
      fetch: fakeFetch({ ...MINIMAL, projection: { name: 'globe' } }),
    },
  )
  expect(style.projection).toEqual({ type: 'mercator' })
  expect(changes).toContainEqual({
    kind: 'projection-rewritten',
    from: 'globe',
    to: 'mercator',
  })
})
