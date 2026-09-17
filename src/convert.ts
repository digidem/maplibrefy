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

function rewriteProjection(
  style: MutableStyle,
  mode: 'keep' | 'mercator',
  changes: Change[],
): void {
  const projection = style.projection
  if (projection === undefined) return
  const current = isObject(projection)
    ? (projection.type ?? projection.name)
    : projection
  const from = typeof current === 'string' ? current : JSON.stringify(current)
  const to = mode === 'mercator' ? 'mercator' : from
  const unchanged =
    isObject(projection) && !('name' in projection) && to === from
  if (unchanged) return
  style.projection = { type: mode === 'mercator' ? 'mercator' : current }
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
