import {
  type StyleSpecification,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec'

import type { Change } from './types.js'

export interface MutableStyle {
  version: 8
  layers: unknown[]
  [key: string]: unknown
}

const MAX_PASSES = 50
const PROTECTED_ROOT_KEYS = new Set(['version', 'layers', 'sources'])

type Target =
  | { kind: 'property'; index: number; group: 'paint' | 'layout'; name: string }
  | { kind: 'filter'; index: number }
  | { kind: 'layer'; index: number; isType: boolean }
  | { kind: 'source'; id: string }
  | { kind: 'root'; key: string }

/** Messages of the validation errors MapLibre would refuse the style for. */
export function validationErrors(style: unknown): string[] {
  return validateStyleMin(style as StyleSpecification)
    .filter((error) => error.severity !== 'warning')
    .map((error) => error.message)
}

/** Remove whatever the installed MapLibre style spec rejects, one validation
 *  pass at a time, until the style validates. */
export function pruneUntilValid(style: MutableStyle, changes: Change[]): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const messages = validationErrors(style)
    if (messages.length === 0) return
    applyPass(style, messages, changes)
  }
  const remaining = validationErrors(style)
  if (remaining.length === 0) return
  throw new Error(
    `convertStyle: style still invalid after ${MAX_PASSES} passes: ${remaining.join('; ')}`,
  )
}

function applyPass(
  style: MutableStyle,
  messages: string[],
  changes: Change[],
): void {
  const roots = new Map<string, string>()
  const sources = new Map<string, string>()
  const layers = new Map<number, string>()
  const filters = new Map<number, string>()
  const properties = new Map<
    number,
    Map<string, { group: 'paint' | 'layout'; name: string; reason: string }>
  >()

  for (const message of messages) {
    const { target, reason } = classify(message, style)
    switch (target.kind) {
      case 'root':
        if (!roots.has(target.key)) roots.set(target.key, reason)
        break
      case 'source':
        if (!sources.has(target.id)) sources.set(target.id, reason)
        break
      case 'layer':
        // A bad type is the reason worth reporting when a layer has several.
        if (!layers.has(target.index) || target.isType) {
          layers.set(target.index, reason)
        }
        break
      case 'filter':
        if (!filters.has(target.index)) filters.set(target.index, reason)
        break
      case 'property': {
        const forLayer = properties.get(target.index) ?? new Map()
        properties.set(target.index, forLayer)
        const key = `${target.group}.${target.name}`
        if (!forLayer.has(key)) {
          forLayer.set(key, { group: target.group, name: target.name, reason })
        }
      }
    }
  }

  for (const [key, reason] of roots) {
    delete style[key]
    changes.push({ kind: 'root-removed', key, reason })
  }

  const removed = new Set<number>()
  for (const [sourceId, reason] of sources) {
    const layerIds: string[] = []
    style.layers.forEach((layer, index) => {
      if (!isObject(layer) || layer.source !== sourceId) return
      removed.add(index)
      layerIds.push(layerId(layer))
    })
    delete (style.sources as Record<string, unknown>)[sourceId]
    changes.push({ kind: 'source-removed', sourceId, layerIds, reason })
  }

  for (const [index, reason] of layers) {
    if (removed.has(index)) continue
    removed.add(index)
    const layer = style.layers[index]
    changes.push({
      kind: 'layer-removed',
      layerId: layerId(layer),
      layerType: layerType(layer),
      reason,
    })
  }

  for (const [index, forLayer] of properties) {
    if (removed.has(index)) continue
    const layer = style.layers[index]
    if (!isObject(layer)) continue
    for (const { group, name, reason } of forLayer.values()) {
      const values = layer[group]
      if (isObject(values)) delete values[name]
      changes.push({
        kind: 'property-removed',
        layerId: layerId(layer),
        group,
        property: name,
        reason,
      })
    }
  }

  for (const [index, reason] of filters) {
    if (removed.has(index)) continue
    const layer = style.layers[index]
    if (!isObject(layer)) continue
    delete layer.filter
    changes.push({ kind: 'filter-removed', layerId: layerId(layer), reason })
  }

  if (removed.size > 0) {
    style.layers = style.layers.filter((_, index) => !removed.has(index))
  }
}

function classify(
  message: string,
  style: MutableStyle,
): { target: Target; reason: string } {
  const match = /^(.+?): (.*)$/s.exec(message)
  if (!match) throw new Error(`convertStyle: cannot repair "${message}"`)
  const [, key, reason] = match as unknown as [string, string, string]

  const layer = /^layers\[(\d+)\](.*)$/s.exec(key)
  if (layer) {
    const index = Number(layer[1])
    const rest = layer[2] ?? ''
    const property = /^\.(paint|layout)\.([^.[]+)/.exec(rest)
    if (property) {
      const group = property[1] as 'paint' | 'layout'
      return {
        target: { kind: 'property', index, group, name: property[2]! },
        reason,
      }
    }
    if (/^\.filter(?:$|[.[])/.test(rest)) {
      return { target: { kind: 'filter', index }, reason }
    }
    return {
      target: { kind: 'layer', index, isType: rest === '.type' },
      reason,
    }
  }

  if (key.startsWith('sources.')) {
    const id = matchSourceId(key.slice('sources.'.length), style)
    if (id !== undefined) return { target: { kind: 'source', id }, reason }
  }

  const head = key.split(/[.[]/, 1)[0]!
  if (PROTECTED_ROOT_KEYS.has(head)) {
    throw new Error(`convertStyle: cannot repair "${message}"`)
  }
  if (head in style) return { target: { kind: 'root', key: head }, reason }

  // The spec reports errors inside `projection`, `light`, `sky` and `terrain`
  // by the child key alone, so find the owner by elimination.
  const owner = findRootOwner(message, style)
  if (owner === undefined) {
    throw new Error(`convertStyle: cannot repair "${message}"`)
  }
  return { target: { kind: 'root', key: owner }, reason }
}

/** Source ids may contain dots, so prefer the longest id the key starts with. */
function matchSourceId(rest: string, style: MutableStyle): string | undefined {
  if (!isObject(style.sources)) return undefined
  let best: string | undefined
  for (const id of Object.keys(style.sources)) {
    const matches =
      rest === id || rest.startsWith(`${id}.`) || rest.startsWith(`${id}[`)
    if (matches && (best === undefined || id.length > best.length)) best = id
  }
  return best
}

function findRootOwner(
  message: string,
  style: MutableStyle,
): string | undefined {
  for (const key of Object.keys(style)) {
    if (PROTECTED_ROOT_KEYS.has(key)) continue
    const probe: Record<string, unknown> = { ...style }
    delete probe[key]
    if (!validationErrors(probe).includes(message)) return key
  }
  return undefined
}

function layerId(layer: unknown): string {
  return isObject(layer) && typeof layer.id === 'string' ? layer.id : ''
}

function layerType(layer: unknown): string {
  return isObject(layer) && typeof layer.type === 'string' ? layer.type : ''
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
