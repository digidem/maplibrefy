import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

import { rewriteExpression } from './expressions.js'
import { type MutableStyle, isObject, pruneUntilValid } from './prune.js'
import type { Change, ConvertOptions, ConvertResult } from './types.js'

const MAPBOX_ROOT_KEYS = [
  'fog',
  'schema',
  'lights',
  'snow',
  'rain',
  'camera',
  'color-theme',
  'featuresets',
  'iconsets',
  'models',
  'indoor',
  'fragment',
]

const MAPBOX_LAYER_KEYS = ['slot', 'appearances']

/** Rewrite a Mapbox GL style so MapLibre GL loads it, dropping what cannot
 *  be expressed and reporting every change. */
export function convertStyle(
  style: unknown,
  options: ConvertOptions = {},
): ConvertResult {
  if (!isStyle(style)) {
    throw new TypeError(
      'convertStyle: expected a style object with version 8 and a layers array',
    )
  }
  const output = structuredClone(style)
  const changes: Change[] = []

  rewriteProjection(output, options.projection ?? 'keep', changes)
  removeMapboxRootKeys(output, changes)
  output.layers.forEach((layer, index) => {
    if (!isObject(layer)) return
    for (const key of MAPBOX_LAYER_KEYS) delete layer[key]
    rewriteLayerExpressions(layer, `layers[${index}]`, changes)
  })
  pruneUntilValid(output, changes)

  return { style: output as unknown as StyleSpecification, changes }
}

function isStyle(value: unknown): value is MutableStyle {
  return isObject(value) && value.version === 8 && Array.isArray(value.layers)
}

// The names maplibre-gl's src/geo/projection/projection_factory.ts can build.
// The validator accepts any string; the runtime logs "Unknown projection
// name" for the rest and renders mercator anyway.
const MAPLIBRE_PROJECTIONS = new Set([
  'mercator',
  'globe',
  'vertical-perspective',
])

function rewriteProjection(
  style: MutableStyle,
  mode: 'keep' | 'mercator',
  changes: Change[],
): void {
  const projection = style.projection
  // Anything without a usable name is left to the validator.
  if (!isObject(projection)) return
  const from = projection.type ?? projection.name
  if (typeof from !== 'string') return
  const to =
    mode === 'mercator' || !MAPLIBRE_PROJECTIONS.has(from) ? 'mercator' : from
  if (to === from && !('name' in projection)) return
  // Replacing the object also drops Mapbox's `center`/`parallels` siblings.
  style.projection = { type: to }
  changes.push({ kind: 'projection-rewritten', from, to })
}

function removeMapboxRootKeys(style: MutableStyle, changes: Change[]): void {
  if ('imports' in style) {
    const imports = style.imports
    const ids = Array.isArray(imports)
      ? imports.map((entry) => (isObject(entry) ? String(entry.id) : ''))
      : []
    delete style.imports
    changes.push({ kind: 'imports-removed', ids })
  }
  for (const key of MAPBOX_ROOT_KEYS) {
    if (!(key in style)) continue
    delete style[key]
    changes.push({ kind: 'root-removed', key, reason: 'Mapbox-only property' })
  }
}

function rewriteLayerExpressions(
  layer: Record<string, unknown>,
  path: string,
  changes: Change[],
): void {
  for (const group of ['paint', 'layout'] as const) {
    const values = layer[group]
    if (!isObject(values)) continue
    for (const name of Object.keys(values)) {
      values[name] = rewriteExpression(
        values[name],
        `${path}.${group}.${name}`,
        changes,
      )
    }
  }
  if ('filter' in layer) {
    layer.filter = rewriteExpression(layer.filter, `${path}.filter`, changes)
  }
}
