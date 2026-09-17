# maplibrify

Load Mapbox GL styles in MapLibre GL. The two style specifications have
diverged since the fork: a style saved from Mapbox Studio today carries
properties, expressions and layer types MapLibre does not know, and MapLibre
rejects the whole style on the first one it meets, leaving a blank map.

`maplibrify` makes a best-effort conversion. Everything MapLibre can render is
kept; a few Mapbox-only expressions are rewritten to equivalents; whatever
cannot be expressed is removed and reported, so an app can tell its user what
was lost. It is not pixel-perfect and does not try to be: the goal is that a
Mapbox style renders instead of failing.

It also rewrites `mapbox://` URLs to the Mapbox API, which MapLibre no longer
does, so a Mapbox style needs both halves of this package to load.

## Usage

### A MapLibre map in the browser

```ts
import { Map } from 'maplibre-gl'
import { createTransformStyle } from 'maplibrify'
import { createTransformRequest } from 'maplibrify/mapbox-urls'

const map = new Map({
  container: 'map',
  transformRequest: createTransformRequest({ accessToken: MAPBOX_TOKEN }),
})
map.setStyle('mapbox://styles/mapbox/satellite-streets-v12', {
  transformStyle: createTransformStyle({
    onChanges: (changes) => console.info('maplibrify:', changes),
  }),
})
```

MapLibre only accepts `transformStyle` on `setStyle`, not in the constructor,
so the map is created without a style and the style set afterwards.

### Anywhere else

```ts
import { convertStyle, loadStyle } from 'maplibrify'

// A style object you already have:
const { style, changes } = convertStyle(mapboxStyle)

// Or fetch and convert in one go (Node or browser):
const { style, changes } = await loadStyle(
  'mapbox://styles/mapbox/streets-v12',
  { accessToken: MAPBOX_TOKEN },
)
```

### Command line

```sh
npx maplibrify style.json > maplibre-style.json
```

The converted style goes to stdout and the list of changes to stderr.

## API

### `convertStyle(style, options?): ConvertResult`

Pure function; the input is not modified. `style` is any JSON value, so a
style straight from `fetch().json()` can be passed without a type assertion.
Throws if it is not a v8 style object at all.

`options.projection` is `'keep'` (default) or `'mercator'`. Studio styles now
default to `globe`, which MapLibre supports but which is wrong for anything
that renders tiles, such as a print exporter.

```ts
interface ConvertResult {
  style: StyleSpecification // valid for the installed MapLibre style spec
  changes: Change[]
}
```

### `Change`

Every edit made, as data rather than prose, so apps can act on the ones that
matter to them:

| `kind`                 | Meaning                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `imports-removed`      | The style was built on an imported basemap (Mapbox Standard). Only the style's own layers remain, over nothing. Apps should tell the user.       |
| `root-removed`         | A Mapbox-only top-level key (`fog`, `lights`, `schema`, …) was dropped.                                                                          |
| `projection-rewritten` | `projection.name` became `projection.type`, or was forced to `mercator`.                                                                         |
| `expression-rewritten` | A Mapbox-only expression was replaced by an equivalent (`path` is the JSON pointer-ish location, `operator` the expression that was replaced).   |
| `property-removed`     | A paint or layout property MapLibre rejected was dropped from a layer; the layer renders with the default.                                       |
| `filter-removed`       | A layer's filter used something MapLibre rejected; the layer now shows all features.                                                             |
| `layer-removed`        | A layer MapLibre cannot render at all (`model`, `slot`, `clip`, `sky`, `raster-particle`, `building`) or whose definition could not be repaired. |
| `source-removed`       | A Mapbox-only source type (`raster-array`, `model`) and every layer using it.                                                                    |

### `createTransformStyle(options?): TransformStyleFunction`

Wraps `convertStyle` for `map.setStyle(url, { transformStyle })`. Takes the
same `projection` option plus `onChanges`, called with the change list after
each conversion.

### `loadStyle(url, options?): Promise<ConvertResult>`

Fetches and converts a style. `url` may be an `http(s)` URL, a
`mapbox://styles/{owner}/{id}` URI, or any of the share/preview URLs Mapbox
Studio shows for a style. Mapbox URLs need `options.accessToken` (a token in
the URL's `access_token` query parameter is also honoured). Relative `sprite`,
`glyphs` and source `url`s are resolved against the style URL before
conversion, because MapLibre does not do that itself for a style object.
`options.fetch` injects a fetch implementation, mainly for tests.

### `maplibrify/mapbox-urls`

The URL half, on its own subpath so it can be used without pulling in the
converter and its dependency on `@maplibre/maplibre-gl-style-spec`. No
dependencies.

- `isMapboxUrl(url)` — `true` for `mapbox://…`.
- `normalizeMapboxUrl(url, accessToken)` — the `https://api.mapbox.com` URL
  for a `mapbox://` style, source, sprite, glyph or tile URL, with the token
  appended; other URLs are returned unchanged. Throws for a `mapbox://` URL
  without a token.
- `parseMapboxStyleUrl(text)` — `{ owner, styleId, draft, accessToken? }` for
  a `mapbox://styles/…` URI or an `api.mapbox.com` / `studio.mapbox.com`
  style URL in any of the forms Studio shows a user, `null` for anything else.
- `mapboxStyleUri(ref)` — the `mapbox://styles/{owner}/{id}[/draft]` form.
- `createTransformRequest({ accessToken })` — a MapLibre
  `transformRequest` that rewrites `mapbox://` URLs and passes everything
  else through untouched, so no other provider's key is ever sent to Mapbox.

## What is converted

Rewritten to a MapLibre equivalent:

- `projection: { name }` → `projection: { type }`.
- `["hsl", h, s, l]` and `["hsla", …]` → `["to-color", ["concat", …]]`,
  which also works when the arguments are expressions.
- `["pitch"]` and `["distance-from-center"]` → `0`; `["measure-light", …]` →
  `1`. Styles use these to fade things at high pitch or by light level, and
  a flat, daylit map is the sensible fallback.

Removed, with a `Change` for each: the Mapbox-only top-level keys (`fog`,
`imports`, `schema`, `lights`, `snow`, `rain`, `camera`, `color-theme`,
`featuresets`, `iconsets`, `models`, `indoor`, `fragment`); `slot` and
`appearances` on layers; layer and source types MapLibre lacks; and then
whatever else the MapLibre style validator still rejects, property by
property. That last step is what keeps the conversion honest against the
MapLibre version actually installed, rather than a hand-written list of
differences that goes stale.

Not attempted, for now: mapping Mapbox `sky` layers or `fog` onto MapLibre's
`sky`; mapping `lights` to `light`; substituting `["config", …]` expressions
with the defaults in `schema`; and pulling in the layers of an imported
Standard basemap, which lean on `config`, 3D lighting and `model` layers
throughout and would render poorly even if they loaded.

## Requirements

`@maplibre/maplibre-gl-style-spec` is a peer dependency of the main entry
point (the `mapbox-urls` subpath has none). It is the validator MapLibre
itself uses, about 32 kB gzipped, and MapLibre bundles it without exporting
it, so a browser app pays for it twice. That is the price of tracking the
installed spec instead of a stale list.

## Licence

MIT. `test/fixtures/mapbox/streets-v12.json` is Mapbox Streets v12 from
[mapbox-gl-styles](https://github.com/mapbox/mapbox-gl-styles), BSD licensed;
see the `LICENSE.md` beside it.
