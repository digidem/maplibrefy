import { expect, it, vi } from 'vitest'

import { convertStyle } from '../src/convert.js'

// A validator that never stops complaining about a property the converter
// already removed: the loop must give up rather than spin.
vi.mock('@maplibre/maplibre-gl-style-spec', () => ({
  validateStyleMin: vi.fn(() => [
    {
      severity: 'error',
      message: 'layers[0].paint.line-width: forced failure',
    },
  ]),
}))

it('throws after the pass limit instead of looping forever', () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      { id: 'a', type: 'line', source: 'v', paint: { 'line-width': 1 } },
    ],
  }
  expect(() => convertStyle(style)).toThrow(
    /after 50 passes: layers\[0\]\.paint\.line-width: forced failure/,
  )
})
