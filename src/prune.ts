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
/** Root objects whose child errors the spec reports by the child key alone. */
const CHILD_KEYED_ROOTS = ['projection', 'light', 'sky', 'terrain']
const UNKNOWN_PROPERTY_RE = /^unknown property "(.+)"$/s

type Target =
  | { kind: 'property'; index: number; group: 'paint' | 'layout'; name: string }
  | { kind: 'filter'; index: number }
  | { kind: 'layer'; index: number; isType: boolean }
  | { kind: 'source'; id: string }
  | { kind: 'source-property'; id: string; property: string }
  | { kind: 'root'; key: string }
  | { kind: 'root-property'; key: string; property: string }

interface Classified {
  target: Target
  reason: string
}

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
  const rootProperties = new Map<string, Map<string, string>>()
  const sources = new Map<string, string>()
  const sourceProperties = new Map<string, Map<string, string>>()
  const layers = new Map<number, string>()
  const filters = new Map<number, string>()
  const properties = new Map<
    number,
    Map<string, { group: 'paint' | 'layout'; name: string; reason: string }>
  >()

  for (const message of messages) {
    const { target, reason } = classify(message, messages, style)
    switch (target.kind) {
      case 'root':
        if (!roots.has(target.key)) roots.set(target.key, reason)
        break
      case 'root-property':
        addNested(rootProperties, target.key, target.property, reason)
        break
      case 'source':
        if (!sources.has(target.id)) sources.set(target.id, reason)
        break
      case 'source-property':
        addNested(sourceProperties, target.id, target.property, reason)
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

  for (const [key, forKey] of rootProperties) {
    if (roots.has(key)) continue
    const owner = style[key]
    if (!isObject(owner)) continue
    for (const [property, reason] of forKey) {
      delete owner[property]
      changes.push({ kind: 'root-property-removed', key, property, reason })
    }
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
    // The validator does not check that terrain's source exists; MapLibre does.
    if (isObject(style.terrain) && style.terrain.source === sourceId) {
      delete style.terrain
      changes.push({
        kind: 'root-removed',
        key: 'terrain',
        reason: `its source "${sourceId}" was removed`,
      })
    }
  }

  for (const [sourceId, forSource] of sourceProperties) {
    if (sources.has(sourceId)) continue
    const source = (style.sources as Record<string, unknown>)[sourceId]
    if (!isObject(source)) continue
    for (const [property, reason] of forSource) {
      delete source[property]
      changes.push({
        kind: 'source-property-removed',
        sourceId,
        property,
        reason,
      })
    }
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

function addNested(
  map: Map<string, Map<string, string>>,
  outer: string,
  inner: string,
  reason: string,
): void {
  const forOuter = map.get(outer) ?? new Map<string, string>()
  map.set(outer, forOuter)
  if (!forOuter.has(inner)) forOuter.set(inner, reason)
}

function classify(
  message: string,
  messages: string[],
  style: MutableStyle,
): Classified {
  const source = classifySource(message, style)
  if (source) return source

  const match = /^(.+?): (.*)$/s.exec(message)
  if (!match) throw cannotRepair(message)
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

  const head = key.split(/[.[]/, 1)[0]!
  if (PROTECTED_ROOT_KEYS.has(head)) throw cannotRepair(message)
  if (head !== key) {
    if (head in style) return { target: { kind: 'root', key: head }, reason }
    throw cannotRepair(message)
  }

  // A bare key is a root key or a child of projection, light, sky or terrain,
  // which the spec reports by the child key alone. A root key of the same
  // name (`center`) must not take the blame, so never guess by name.
  const owner = findRootOwner(
    message,
    messages,
    [key, ...CHILD_KEYED_ROOTS],
    style,
  )
  if (owner === undefined) throw cannotRepair(message)
  const child = UNKNOWN_PROPERTY_RE.exec(reason)?.[1]
  const value = style[owner]
  if (
    child !== undefined &&
    CHILD_KEYED_ROOTS.includes(owner) &&
    isObject(value) &&
    child in value
  ) {
    return {
      target: { kind: 'root-property', key: owner, property: child },
      reason,
    }
  }
  return { target: { kind: 'root', key: owner }, reason }
}

/** `sources.<id>[.<property>…]: <reason>`, where the id may itself contain
 *  dots or `: `, so the style's real source ids decide where it ends. */
function classifySource(
  message: string,
  style: MutableStyle,
): Classified | undefined {
  if (!message.startsWith('sources.')) return undefined
  const rest = message.slice('sources.'.length)
  const id = matchSourceId(rest, style)
  if (id === undefined) return undefined
  const tail = /^(.*?): (.*)$/s.exec(rest.slice(id.length))
  if (!tail) return undefined
  const [, path, reason] = tail as unknown as [string, string, string]
  const property =
    /^\.([^.[]+)/.exec(path)?.[1] ??
    (path === '' ? UNKNOWN_PROPERTY_RE.exec(reason)?.[1] : undefined)
  if (property === undefined || property === 'type') {
    return { target: { kind: 'source', id }, reason }
  }
  return { target: { kind: 'source-property', id, property }, reason }
}

/** Source ids may contain dots, so prefer the longest id the key starts with. */
function matchSourceId(rest: string, style: MutableStyle): string | undefined {
  if (!isObject(style.sources)) return undefined
  let best: string | undefined
  for (const id of Object.keys(style.sources)) {
    const matches =
      rest.startsWith(`${id}.`) ||
      rest.startsWith(`${id}[`) ||
      rest.startsWith(`${id}: `)
    if (matches && (best === undefined || id.length > best.length)) best = id
  }
  return best
}

/** The first candidate whose removal makes `message` go away. Occurrences are
 *  counted rather than tested for, as two owners can report the same text. */
function findRootOwner(
  message: string,
  messages: string[],
  candidates: string[],
  style: MutableStyle,
): string | undefined {
  const before = count(messages, message)
  const tried = new Set<string>()
  for (const key of candidates) {
    if (tried.has(key) || PROTECTED_ROOT_KEYS.has(key) || !(key in style)) {
      continue
    }
    tried.add(key)
    const probe: Record<string, unknown> = { ...style }
    delete probe[key]
    if (count(validationErrors(probe), message) < before) return key
  }
  return undefined
}

function count(messages: string[], message: string): number {
  return messages.filter((candidate) => candidate === message).length
}

function cannotRepair(message: string): Error {
  return new Error(`convertStyle: cannot repair "${message}"`)
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
