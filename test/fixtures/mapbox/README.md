`streets-v12.json` is Mapbox Streets v12 as published in
https://github.com/mapbox/mapbox-gl-styles (BSD licence in `LICENSE.md` here).
It is a real Studio export and the closest public stand-in for
`mapbox://styles/mapbox/satellite-streets-v12`, which needs a token.

Everything else in `test/fixtures/` is synthetic: Mapbox Standard and its
Studio derivatives are not redistributable, so their features (`imports`,
`schema`, `config`, `slot`, `model` layers, 3D lighting) are exercised through
hand-written styles.
