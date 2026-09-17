---
'maplibrify': minor
---

`loadStyle`: fetch a style from an `http(s)`, `mapbox://` or Studio share URL and resolve its relative `sprite`, `glyphs`, source `url` and geojson `data` against the fetched URL before converting. `createTransformStyle`: convert a style inside `map.setStyle(url, { transformStyle })`, reporting the changes through `onChanges`.
