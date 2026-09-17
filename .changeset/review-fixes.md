---
'maplibrify': minor
---

`convertStyle` now repairs instead of dropping where it can: a source with one
rejected property keeps the source and its layers (`source-property-removed`),
an unknown property inside `projection`, `light`, `sky` or `terrain` removes
just that property (`root-property-removed`) without ever blaming a root key
of the same name, `terrain` goes with its removed source, and Mapbox-only
projections (`albers`, `equalEarth`, …) become `mercator`, which is what
MapLibre would render anyway. `loadStyle` fetches a pasted `api.mapbox.com`
style URL as given so `fresh=true` survives, and the CLI prints usage instead
of hanging when run on a terminal without a file.
