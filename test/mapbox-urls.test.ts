import { describe, expect, it } from 'vitest'

import {
  MAPBOX_ATTRIBUTION,
  MAPBOX_TERMS_URL,
  createTransformRequest,
  isMapboxServiceUrl,
  isMapboxUrl,
  mapboxAccessToken,
  mapboxStyleUri,
  normalizeMapboxUrl,
  normalizeTileURL,
  parseMapboxStyleUrl,
} from '../src/mapbox-urls.js'

const TOKEN = 'pk.test'

describe('parseMapboxStyleUrl', () => {
  it('parses a mapbox:// style URI', () => {
    expect(parseMapboxStyleUrl('mapbox://styles/acme/ckabc123')).toEqual({
      owner: 'acme',
      styleId: 'ckabc123',
      draft: false,
      accessToken: undefined,
    })
  })

  it('parses the draft suffix', () => {
    expect(parseMapboxStyleUrl('mapbox://styles/acme/ckabc123/draft')).toEqual({
      owner: 'acme',
      styleId: 'ckabc123',
      draft: true,
      accessToken: undefined,
    })
  })

  it('parses an api.mapbox.com style URL and its token', () => {
    expect(
      parseMapboxStyleUrl(
        '  https://api.mapbox.com/styles/v1/acme/ckabc123?access_token=pk.url  ',
      ),
    ).toEqual({
      owner: 'acme',
      styleId: 'ckabc123',
      draft: false,
      accessToken: 'pk.url',
    })
  })

  it('parses the forms Studio shows for sharing a style', () => {
    const forms: [string, boolean][] = [
      ['https://api.mapbox.com/styles/v1/acme/s1', false],
      ['https://api.mapbox.com/styles/v1/acme/s1/', false],
      ['https://api.mapbox.com/styles/v1/acme/s1.html', false],
      ['https://api.mapbox.com/styles/v1/acme/s1/wmts', false],
      ['https://api.mapbox.com/styles/v1/acme/s1/draft', true],
      ['https://api.mapbox.com/styles/v1/acme/s1/draft.html', true],
      ['https://api.mapbox.com/styles/v1/acme/s1/draft/wmts', true],
      ['https://studio.mapbox.com/styles/acme/s1', false],
      ['https://studio.mapbox.com/styles/acme/s1/edit/1.5/0/0', false],
    ]
    for (const [url, draft] of forms) {
      expect(parseMapboxStyleUrl(url), url).toMatchObject({
        owner: 'acme',
        styleId: 's1',
        draft,
      })
    }
  })

  it('treats http as https', () => {
    expect(
      parseMapboxStyleUrl('http://api.mapbox.com/styles/v1/acme/s1.html'),
    ).toMatchObject({ owner: 'acme', styleId: 's1' })
  })

  it('ignores a blank access_token', () => {
    expect(
      parseMapboxStyleUrl('mapbox://styles/acme/s1?access_token='),
    ).toMatchObject({ accessToken: undefined })
  })

  it('returns null for a raster tile template under a style', () => {
    expect(
      parseMapboxStyleUrl(
        'https://api.mapbox.com/styles/v1/acme/s1/tiles/{z}/{x}/{y}?access_token=pk.url',
      ),
    ).toBeNull()
    expect(
      parseMapboxStyleUrl('https://ecn.example.com/a{quadkey}.jpeg'),
    ).toBeNull()
  })

  it('returns null for anything that is not a style URL', () => {
    for (const bad of [
      '',
      'not a url',
      'mapbox://styles/acme',
      'mapbox://fonts/acme/Arial',
      'mapbox://mapbox.mapbox-streets-v8',
      'https://example.com/styles/v1/acme/s1',
      'https://api.mapbox.com/v4/mapbox.satellite.json',
      'https://api.mapbox.com/styles/acme/s1',
    ]) {
      expect(parseMapboxStyleUrl(bad), bad).toBeNull()
    }
  })
})

describe('mapboxStyleUri', () => {
  it('builds the mapbox:// form, with and without draft', () => {
    expect(mapboxStyleUri({ owner: 'acme', styleId: 's1', draft: false })).toBe(
      'mapbox://styles/acme/s1',
    )
    expect(mapboxStyleUri({ owner: 'acme', styleId: 's1', draft: true })).toBe(
      'mapbox://styles/acme/s1/draft',
    )
  })

  it('round-trips every style URL form to the same URI', () => {
    for (const url of [
      'https://api.mapbox.com/styles/v1/acme/s1.html?access_token=pk.url',
      'https://api.mapbox.com/styles/v1/acme/s1/wmts',
      'http://studio.mapbox.com/styles/acme/s1/edit/1/0/0',
    ]) {
      const ref = parseMapboxStyleUrl(url)
      expect(ref, url).not.toBeNull()
      expect(ref && mapboxStyleUri(ref), url).toBe('mapbox://styles/acme/s1')
    }
  })
})

describe('isMapboxUrl', () => {
  it('is true only for the mapbox:// scheme', () => {
    expect(isMapboxUrl('mapbox://styles/acme/s1')).toBe(true)
    expect(isMapboxUrl('MAPBOX://styles/acme/s1')).toBe(true)
    expect(isMapboxUrl('https://api.mapbox.com/styles/v1/acme/s1')).toBe(false)
    expect(isMapboxUrl('https://example.com/style.json')).toBe(false)
  })
})

describe('isMapboxServiceUrl', () => {
  it('covers mapbox:// and every mapbox.com host', () => {
    for (const url of [
      'mapbox://styles/acme/s1',
      'https://api.mapbox.com/styles/v1/acme/s1',
      'https://studio.mapbox.com/styles/acme/s1',
      'https://MAPBOX.COM/anything',
    ]) {
      expect(isMapboxServiceUrl(url), url).toBe(true)
    }
    for (const url of [
      '',
      'not a url',
      'https://example.com/style.json',
      'https://notmapbox.com/style.json',
      'https://mapbox.com.evil.example/style.json',
    ]) {
      expect(isMapboxServiceUrl(url), url).toBe(false)
    }
  })
})

describe('mapboxAccessToken', () => {
  it('prefers the explicit token over the one in the URL', () => {
    expect(
      mapboxAccessToken({
        url: 'https://api.mapbox.com/styles/v1/acme/s1?access_token=pk.url',
        accessToken: 'pk.form',
      }),
    ).toBe('pk.form')
  })

  it('falls back to the token in the URL', () => {
    expect(
      mapboxAccessToken({
        url: 'https://api.mapbox.com/styles/v1/acme/s1?access_token=pk.url',
      }),
    ).toBe('pk.url')
  })

  it('is undefined for a non-Mapbox style, so its key is never sent to Mapbox', () => {
    expect(
      mapboxAccessToken({
        url: 'https://example.com/style.json?access_token=other.key',
        accessToken: 'other.key',
      }),
    ).toBeUndefined()
  })

  it('is undefined for a Mapbox URL with no token anywhere', () => {
    expect(
      mapboxAccessToken({ url: 'mapbox://styles/acme/s1' }),
    ).toBeUndefined()
  })
})

describe('normalizeMapboxUrl', () => {
  it('normalizes a style URI', () => {
    expect(normalizeMapboxUrl('mapbox://styles/acme/s1', TOKEN)).toBe(
      'https://api.mapbox.com/styles/v1/acme/s1?access_token=pk.test',
    )
    expect(normalizeMapboxUrl('mapbox://styles/acme/s1/draft', TOKEN)).toBe(
      'https://api.mapbox.com/styles/v1/acme/s1/draft?access_token=pk.test',
    )
  })

  it('normalizes a glyph URL', () => {
    expect(
      normalizeMapboxUrl('mapbox://fonts/acme/Arial/0-255.pbf', TOKEN),
    ).toBe(
      'https://api.mapbox.com/fonts/v1/acme/Arial/0-255.pbf?access_token=pk.test',
    )
  })

  it('normalizes a sprite URL with each suffix MapLibre appends', () => {
    const cases: [string, string][] = [
      ['mapbox://sprites/acme/s1', '/sprite'],
      ['mapbox://sprites/acme/s1.json', '/sprite.json'],
      ['mapbox://sprites/acme/s1.png', '/sprite.png'],
      ['mapbox://sprites/acme/s1@2x.json', '/sprite@2x.json'],
      ['mapbox://sprites/acme/s1@2x.png', '/sprite@2x.png'],
    ]
    for (const [url, tail] of cases) {
      expect(normalizeMapboxUrl(url, TOKEN), url).toBe(
        `https://api.mapbox.com/styles/v1/acme/s1${tail}?access_token=pk.test`,
      )
    }
  })

  it('normalizes a sprite URL under a draft style', () => {
    expect(
      normalizeMapboxUrl('mapbox://sprites/acme/s1/draft@2x.png', TOKEN),
    ).toBe(
      'https://api.mapbox.com/styles/v1/acme/s1/draft/sprite@2x.png?access_token=pk.test',
    )
  })

  it('normalizes a tile URL', () => {
    expect(
      normalizeMapboxUrl('mapbox://tiles/mapbox.satellite/3/1/2.png', TOKEN),
    ).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/3/1/2.png?access_token=pk.test',
    )
  })

  it('normalizes a tileset source to secure TileJSON', () => {
    expect(normalizeMapboxUrl('mapbox://mapbox.mapbox-streets-v8', TOKEN)).toBe(
      'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json?secure=&access_token=pk.test',
    )
  })

  it('normalizes a composited multi-tileset source', () => {
    expect(
      normalizeMapboxUrl(
        'mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2',
        TOKEN,
      ),
    ).toBe(
      'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2.json?secure=&access_token=pk.test',
    )
  })

  it('keeps query parameters already on the URI and overrides the token', () => {
    expect(
      normalizeMapboxUrl(
        'mapbox://styles/acme/s1?optimize=true&access_token=pk.stale',
        TOKEN,
      ),
    ).toBe(
      'https://api.mapbox.com/styles/v1/acme/s1?optimize=true&access_token=pk.test',
    )
  })

  it('passes non-Mapbox URLs through untouched, with or without a token', () => {
    for (const url of [
      'https://example.com/style.json',
      'https://api.mapbox.com/styles/v1/acme/s1?access_token=pk.url',
      'not a url',
      '',
    ]) {
      expect(normalizeMapboxUrl(url), url).toBe(url)
      expect(normalizeMapboxUrl(url, TOKEN), url).toBe(url)
    }
  })

  it('throws for a mapbox:// URL with no token', () => {
    expect(() => normalizeMapboxUrl('mapbox://styles/acme/s1')).toThrow(
      /access token is required/i,
    )
    expect(() => normalizeMapboxUrl('mapbox://styles/acme/s1', '')).toThrow(
      /access token is required/i,
    )
  })

  it('rejects a secret token', () => {
    expect(() =>
      normalizeMapboxUrl('mapbox://styles/acme/s1', 'sk.secret'),
    ).toThrow(/public access token \(pk\.\*\)/)
  })
})

describe('normalizeTileURL', () => {
  const tile = 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png'
  const source = 'mapbox://mapbox.satellite'

  it('leaves tiles of a non-Mapbox source alone', () => {
    expect(
      normalizeTileURL(tile, 'https://example.com/r.json', 512, {
        devicePixelRatio: 2,
      }),
    ).toBe(tile)
    expect(normalizeTileURL(tile, '', 512)).toBe(tile)
  })

  it('leaves a 256px tile on a 1x device alone', () => {
    expect(normalizeTileURL(tile, source, 256)).toBe(tile)
  })

  it('forces @2x for a 512px raster source even on a 1x device', () => {
    expect(normalizeTileURL(tile, source, 512)).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png',
    )
  })

  it('adds @2x on a hidpi device', () => {
    expect(normalizeTileURL(tile, source, 256, { devicePixelRatio: 2 })).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png',
    )
  })

  it('swaps the extension for webp where supported', () => {
    expect(normalizeTileURL(tile, source, 256, { supportsWebp: true })).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.webp',
    )
    expect(
      normalizeTileURL(tile, source, 512, {
        devicePixelRatio: 2,
        supportsWebp: true,
      }),
    ).toBe('https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.webp')
  })

  it('keeps the query string and only rewrites the path extension', () => {
    expect(normalizeTileURL(`${tile}?access_token=pk.test`, source, 512)).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png?access_token=pk.test',
    )
  })

  it('leaves a vector tile URL alone', () => {
    const pbf =
      'https://api.mapbox.com/v4/mapbox.streets/{z}/{x}/{y}.vector.pbf'
    expect(normalizeTileURL(pbf, source, 512)).toBe(pbf)
  })
})

describe('createTransformRequest', () => {
  it('rewrites mapbox:// URLs and passes everything else through', () => {
    const transform = createTransformRequest({ accessToken: TOKEN })
    expect(transform('mapbox://sprites/acme/s1@2x.png')).toEqual({
      url: 'https://api.mapbox.com/styles/v1/acme/s1/sprite@2x.png?access_token=pk.test',
    })
    expect(transform('mapbox://fonts/acme/Arial/0-255.pbf', 'Glyphs')).toEqual({
      url: 'https://api.mapbox.com/fonts/v1/acme/Arial/0-255.pbf?access_token=pk.test',
    })
    expect(transform('https://example.com/tiles/1/2/3.png')).toEqual({
      url: 'https://example.com/tiles/1/2/3.png',
    })
  })

  it('needs no token until a mapbox:// URL arrives', () => {
    const transform = createTransformRequest()
    expect(transform('https://example.com/style.json')).toEqual({
      url: 'https://example.com/style.json',
    })
    expect(() => transform('mapbox://styles/acme/s1')).toThrow(
      /access token is required/i,
    )
  })

  it('rejects a secret token when a mapbox:// URL arrives', () => {
    const transform = createTransformRequest({ accessToken: 'sk.secret' })
    expect(() => transform('mapbox://styles/acme/s1')).toThrow(
      /public access token \(pk\.\*\)/,
    )
  })
})

describe('constants', () => {
  it('points at the Mapbox terms and credits both Mapbox and OSM', () => {
    expect(MAPBOX_TERMS_URL).toBe('https://www.mapbox.com/legal/tos')
    expect(MAPBOX_ATTRIBUTION).toContain('© Mapbox')
    expect(MAPBOX_ATTRIBUTION).toContain('© OpenStreetMap')
  })
})
