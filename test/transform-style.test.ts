import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { TransformStyleFunction as MaplibreTransformStyleFunction } from 'maplibre-gl'
import { expect, it, vi } from 'vitest'

import { createTransformStyle } from '../src/transform-style.js'
import type { Change } from '../src/types.js'

const STYLE = {
  version: 8,
  name: 'test',
  projection: { name: 'globe' },
  sources: {},
  layers: [
    {
      id: 'bg',
      type: 'background',
      paint: { 'background-color': ['hsl', 200, 50, 50] },
    },
  ],
} as unknown as StyleSpecification

it('returns the converted style', () => {
  const style = createTransformStyle()(undefined, STYLE)
  expect(style.projection).toEqual({ type: 'globe' })
  expect(style).not.toBe(STYLE)
  expect(STYLE.projection).toEqual({ name: 'globe' })
})

it('calls onChanges with the change list', () => {
  const onChanges = vi.fn<(changes: Change[]) => void>()
  createTransformStyle({ onChanges })(undefined, STYLE)
  expect(onChanges).toHaveBeenCalledTimes(1)
  const changes = onChanges.mock.calls[0]?.[0] ?? []
  expect(changes).toContainEqual({
    kind: 'projection-rewritten',
    from: 'globe',
    to: 'globe',
  })
  expect(changes.map((change) => change.kind)).toContain('expression-rewritten')
})

it('passes projection through', () => {
  const style = createTransformStyle({ projection: 'mercator' })(
    undefined,
    STYLE,
  )
  expect(style.projection).toEqual({ type: 'mercator' })
})

it('propagates a TypeError for non-style input', () => {
  const transform = createTransformStyle()
  expect(() =>
    transform(undefined, { hello: 'world' } as unknown as StyleSpecification),
  ).toThrow(TypeError)
})

it('is assignable to maplibre-gl TransformStyleFunction', () => {
  const check: MaplibreTransformStyleFunction = createTransformStyle()
  expect(typeof check).toBe('function')
})
