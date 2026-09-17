# maplibrefy

## 0.1.0

### Minor Changes

- [`07f749e`](https://github.com/digidem/maplibrefy/commit/07f749ede4103dfdb0b8383f5f7c2c0c7d3e994e) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add a `maplibrefy` command line that converts a style from a file or stdin to stdout and lists the changes on stderr.

- [`e29c3e1`](https://github.com/digidem/maplibrefy/commit/e29c3e14864a2148c26e60c3a73d8cf88dbe5783) Thanks [@gmaclennan](https://github.com/gmaclennan)! - `convertStyle`: rewrite projection, hsl/hsla, pitch, distance-from-center and measure-light; drop Mapbox-only root keys, layer keys and whatever the MapLibre validator still rejects, reporting each edit as a `Change`.

- [`81779b0`](https://github.com/digidem/maplibrefy/commit/81779b014ea69deecb178c44d674da30fa5bb111) Thanks [@gmaclennan](https://github.com/gmaclennan)! - `loadStyle`: fetch a style from an `http(s)`, `mapbox://` or Studio share URL and resolve its relative `sprite`, `glyphs`, source `url` and geojson `data` against the fetched URL before converting. `createTransformStyle`: convert a style inside `map.setStyle(url, { transformStyle })`, reporting the changes through `onChanges`.

- [`f3161da`](https://github.com/digidem/maplibrefy/commit/f3161da72334b2671702a4bacfd1a25ccc04670e) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add the `maplibrefy/mapbox-urls` subpath export: `isMapboxUrl`,
  `isMapboxServiceUrl`, `normalizeMapboxUrl`, `normalizeTileURL`,
  `parseMapboxStyleUrl`, `mapboxStyleUri`, `mapboxAccessToken`,
  `createTransformRequest` and the Mapbox terms and attribution constants. It has
  no runtime or type dependencies, so it can be used without maplibre-gl or the
  style spec installed.

- [`896dc02`](https://github.com/digidem/maplibrefy/commit/896dc0264b40afaf28b8d6b14906d09f09ed3208) Thanks [@gmaclennan](https://github.com/gmaclennan)! - `convertStyle` now repairs instead of dropping where it can: a source with one
  rejected property keeps the source and its layers (`source-property-removed`),
  an unknown property inside `projection`, `light`, `sky` or `terrain` removes
  just that property (`root-property-removed`) without ever blaming a root key
  of the same name, `terrain` goes with its removed source, and Mapbox-only
  projections (`albers`, `equalEarth`, …) become `mercator`, which is what
  MapLibre would render anyway. `loadStyle` fetches a pasted `api.mapbox.com`
  style URL as given so `fresh=true` survives, and the CLI prints usage instead
  of hanging when run on a terminal without a file.
