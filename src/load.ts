import { convertStyle } from './convert.js'
import {
  mapboxStyleUri,
  normalizeMapboxUrl,
  parseMapboxStyleUrl,
} from './mapbox-urls.js'
import { isObject } from './prune.js'
import type { ConvertOptions, ConvertResult } from './types.js'

export interface LoadStyleOptions extends ConvertOptions {
  accessToken?: string
  fetch?: typeof fetch
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const HTTP_RE = /^https?:\/\//i

/** Fetch a style by URL (including `mapbox://` and Studio share links),
 *  resolve its relative URLs against the style URL, and convert it. */
export async function loadStyle(
  url: string,
  options: LoadStyleOptions = {},
): Promise<ConvertResult> {
  const requestUrl = styleRequestUrl(url, options.accessToken)
  const doFetch = options.fetch ?? globalThis.fetch
  const response = await doFetch(requestUrl)
  if (!response.ok) {
    throw new Error(
      `loadStyle: ${response.status} ${response.statusText} fetching ${requestUrl}`,
    )
  }
  const style: unknown = await response.json()
  // Redirects mean the style may have come from elsewhere than we asked.
  if (isObject(style)) resolveStyleUrls(style, response.url || requestUrl)
  return convertStyle(style, { projection: options.projection })
}

function styleRequestUrl(url: string, accessToken?: string): string {
  const ref = parseMapboxStyleUrl(url)
  if (ref) {
    return normalizeMapboxUrl(
      mapboxStyleUri(ref),
      accessToken ?? ref.accessToken,
    )
  }
  if (!HTTP_RE.test(url.trim())) {
    throw new TypeError(
      `loadStyle: expected an http(s) URL or a mapbox:// style URL, got ${url}`,
    )
  }
  return url
}

function resolveStyleUrls(style: Record<string, unknown>, base: string): void {
  const sprite = style.sprite
  if (typeof sprite === 'string') {
    style.sprite = resolveUrl(sprite, base)
  } else if (Array.isArray(sprite)) {
    for (const entry of sprite) {
      if (isObject(entry) && typeof entry.url === 'string') {
        entry.url = resolveUrl(entry.url, base)
      }
    }
  }
  if (typeof style.glyphs === 'string') {
    style.glyphs = resolveUrl(style.glyphs, base)
  }
  if (!isObject(style.sources)) return
  for (const source of Object.values(style.sources)) {
    if (!isObject(source)) continue
    if (typeof source.url === 'string') {
      source.url = resolveUrl(source.url, base)
    }
    if (source.type === 'geojson' && typeof source.data === 'string') {
      source.data = resolveUrl(source.data, base)
    }
  }
}

function resolveUrl(value: string, base: string): string {
  if (SCHEME_RE.test(value)) return value
  const placeholder = value.indexOf('{')
  if (placeholder === -1) return new URL(value, base).href
  // `new URL` percent-encodes braces, so resolve only the path up to the
  // first placeholder and keep the rest verbatim.
  const cut = value.lastIndexOf('/', placeholder) + 1
  const prefix = value.slice(0, cut) || './'
  return new URL(prefix, base).href + value.slice(cut)
}
