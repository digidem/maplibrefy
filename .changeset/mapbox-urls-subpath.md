---
'maplibrefy': minor
---

Add the `maplibrefy/mapbox-urls` subpath export: `isMapboxUrl`,
`isMapboxServiceUrl`, `normalizeMapboxUrl`, `normalizeTileURL`,
`parseMapboxStyleUrl`, `mapboxStyleUri`, `mapboxAccessToken`,
`createTransformRequest` and the Mapbox terms and attribution constants. It has
no runtime or type dependencies, so it can be used without maplibre-gl or the
style spec installed.
