// Subpath export `maplibrefy/mapbox-urls`: must not import the converter or
// the style spec, so it stays a few hundred bytes.

const API_URL = 'https://api.mapbox.com'
const TOKEN_HELP = 'See https://docs.mapbox.com/api/accounts/tokens/'

/**
 * MapLibre's `RequestTransformFunction`, declared structurally so consumers of
 * this subpath need no maplibre-gl types.
 */
export type RequestTransformFunction = (
  url: string,
  resourceType?: string,
) => { url: string } | undefined

export interface MapboxStyleRef {
  owner: string
  styleId: string
  draft: boolean
  /** Token found in the pasted URL's `access_token` query param, if any. */
  accessToken?: string
}

export interface TransformRequestOptions {
  accessToken?: string
}

interface UrlParts {
  scheme: string
  host: string
  path: string
  /** The query as written, so a URL can be reassembled without re-encoding. */
  query: string
  params: URLSearchParams
}

// A regex rather than `new URL()`: older engines don't parse the host of
// non-special schemes like `mapbox://`.
const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?/i

function splitUrl(url: string): UrlParts | null {
  const m = URL_RE.exec(url.trim())
  const scheme = m?.[1]
  if (!scheme) return null
  return {
    scheme: scheme.toLowerCase(),
    host: m[2] ?? '',
    path: m[3] ?? '/',
    query: m[4] ?? '',
    params: new URLSearchParams(m[4] ?? ''),
  }
}

function formatUrl({ scheme, host, path, query }: UrlParts): string {
  return `${scheme}://${host}${path}${query ? `?${query}` : ''}`
}

const SEGMENT = '([A-Za-z0-9_-]+)'
/** Path shapes that identify a style, keyed by scheme://host:
 *  - mapbox://styles/{owner}/{id}[/draft]
 *  - api.mapbox.com/styles/v1/{owner}/{id}[/draft][.html | /wmts | /]
 *  - studio.mapbox.com/styles/{owner}/{id}[/edit/…] */
const STYLE_PATTERNS: Record<string, RegExp> = {
  'mapbox://styles': new RegExp(`^/${SEGMENT}/${SEGMENT}(/draft)?(?:/|$)`),
  'https://api.mapbox.com': new RegExp(
    `^/styles/v1/${SEGMENT}/${SEGMENT}(/draft)?(?:\\.html|/|$)`,
  ),
  'https://studio.mapbox.com': new RegExp(
    `^/styles/${SEGMENT}/${SEGMENT}()(?:/|$)`,
  ),
}

/** Extract owner + style id from any of the URL forms Mapbox shows a user for
 *  a style (share → web, share → third party/WMTS, the preview page, Studio).
 *  Raster tile templates under a style are left alone — they're tile URLs. */
export function parseMapboxStyleUrl(input: string): MapboxStyleRef | null {
  if (/\{z\}|\{quadkey\}/.test(input)) return null
  const parts = splitUrl(input)
  if (!parts) return null
  const scheme = parts.scheme === 'http' ? 'https' : parts.scheme
  const re = STYLE_PATTERNS[`${scheme}://${parts.host.toLowerCase()}`]
  const m = re?.exec(parts.path)
  const owner = m?.[1]
  const styleId = m?.[2]
  if (!owner || !styleId) return null
  return {
    owner,
    styleId,
    draft: !!m?.[3],
    accessToken: parts.params.get('access_token') || undefined,
  }
}

export function mapboxStyleUri({
  owner,
  styleId,
  draft,
}: MapboxStyleRef): string {
  return `mapbox://styles/${owner}/${styleId}${draft ? '/draft' : ''}`
}

export function isMapboxUrl(url: string): boolean {
  return /^mapbox:\/\//i.test(url)
}

/** Any URL served by Mapbox — `mapbox://` or a *.mapbox.com host. */
export function isMapboxServiceUrl(url: string): boolean {
  const parts = splitUrl(url)
  if (!parts) return false
  const host = parts.host.toLowerCase()
  return (
    parts.scheme === 'mapbox' ||
    host === 'mapbox.com' ||
    host.endsWith('.mapbox.com')
  )
}

/** The Mapbox token to use for a style's `mapbox://` resources. Undefined for
 *  non-Mapbox styles, so another provider's key is never sent to Mapbox. */
export function mapboxAccessToken(style: {
  url: string
  accessToken?: string
}): string | undefined {
  if (!isMapboxServiceUrl(style.url)) return undefined
  return (
    style.accessToken ||
    splitUrl(style.url)?.params.get('access_token') ||
    undefined
  )
}

const SPRITE_SUFFIX_RE = /^(.*?)((?:@\dx)?\.(?:json|png))?$/

/** Resolve a `mapbox://` style, source, sprite, glyph or tile URL to its
 *  HTTPS API endpoint, mirroring mapbox-gl-js. Other URLs pass through. */
export function normalizeMapboxUrl(url: string, accessToken?: string): string {
  const parts = isMapboxUrl(url) ? splitUrl(url) : null
  if (!parts) return url
  if (!accessToken) {
    throw new Error(
      `An access token is required to use a Mapbox URL. ${TOKEN_HELP}`,
    )
  }
  if (accessToken.startsWith('sk.')) {
    throw new Error(
      `Use a public access token (pk.*) not a secret access token (sk.*). ${TOKEN_HELP}`,
    )
  }
  const { host, path } = parts
  const kind = host.toLowerCase()
  let out: URL
  if (kind === 'styles') {
    out = new URL(`${API_URL}/styles/v1${path}`)
  } else if (kind === 'fonts') {
    out = new URL(`${API_URL}/fonts/v1${path}`)
  } else if (kind === 'sprites') {
    // MapLibre appends `@2x.json` etc. to the sprite path; Mapbox serves it
    // as `…/sprite@2x.json` under the style.
    const m = SPRITE_SUFFIX_RE.exec(path)
    out = new URL(`${API_URL}/styles/v1${m?.[1] ?? path}/sprite${m?.[2] ?? ''}`)
  } else if (kind === 'tiles') {
    out = new URL(`${API_URL}/v4${path}`)
  } else {
    // Tileset source, e.g. mapbox://mapbox.mapbox-streets-v8 → TileJSON.
    out = new URL(`${API_URL}/v4/${host}.json`)
    out.searchParams.set('secure', '')
  }
  parts.params.forEach((v, k) => out.searchParams.set(k, v))
  out.searchParams.set('access_token', accessToken)
  return out.toString()
}

const IMAGE_EXTENSION_RE = /(\.(?:png|jpg)\d*)(?=$)/

/** Add the `@2x` / `.webp` suffixes Mapbox raster tiles need: the v4 tile API
 *  serves 512px tiles only as `@2x`. Tiles of a non-`mapbox://` source pass
 *  through untouched. */
export function normalizeTileURL(
  tileUrl: string,
  sourceUrl: string,
  tileSize?: 256 | 512,
  {
    devicePixelRatio = 1,
    supportsWebp = false,
  }: { devicePixelRatio?: number; supportsWebp?: boolean } = {},
): string {
  if (!sourceUrl || !isMapboxUrl(sourceUrl)) return tileUrl
  const parts = splitUrl(tileUrl)
  if (!parts) return tileUrl
  const suffix = devicePixelRatio >= 2 || tileSize === 512 ? '@2x' : ''
  const extension = supportsWebp ? '.webp' : '$1'
  return formatUrl({
    ...parts,
    path: parts.path.replace(IMAGE_EXTENSION_RE, `${suffix}${extension}`),
  })
}

/** A MapLibre `transformRequest` that rewrites `mapbox://` URLs and passes
 *  everything else through, so no other provider's key reaches Mapbox. */
export function createTransformRequest({
  accessToken,
}: TransformRequestOptions = {}): RequestTransformFunction {
  return (url) =>
    isMapboxUrl(url) ? { url: normalizeMapboxUrl(url, accessToken) } : { url }
}

export const MAPBOX_TERMS_URL = 'https://www.mapbox.com/legal/tos'
export const MAPBOX_ATTRIBUTION =
  '<a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">© Mapbox</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>'
