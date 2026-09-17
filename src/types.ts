import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

/** One edit made to a style to make MapLibre accept it. */
export type Change =
  | { kind: 'root-removed'; key: string; reason: string }
  /** One property of `projection`, `light`, `sky` or `terrain` was dropped;
   *  the rest of the object is kept. */
  | {
      kind: 'root-property-removed'
      key: string
      property: string
      reason: string
    }
  /** The style was built on an imported basemap (Mapbox Standard); only the
   *  style's own layers remain. Apps should tell the user. */
  | { kind: 'imports-removed'; ids: string[] }
  | { kind: 'projection-rewritten'; from: string; to: string }
  | { kind: 'expression-rewritten'; path: string; operator: string }
  | {
      kind: 'property-removed'
      layerId: string
      group: 'paint' | 'layout'
      property: string
      reason: string
    }
  | { kind: 'filter-removed'; layerId: string; reason: string }
  | {
      kind: 'layer-removed'
      layerId: string
      layerType: string
      reason: string
    }
  | {
      kind: 'source-removed'
      sourceId: string
      layerIds: string[]
      reason: string
    }
  /** One property of a source was dropped; the source and its layers stay. */
  | {
      kind: 'source-property-removed'
      sourceId: string
      property: string
      reason: string
    }

export interface ConvertOptions {
  /** Studio styles default to `globe`. `mercator` forces flat rendering, which
   *  tile exporters need. Default `keep`. */
  projection?: 'keep' | 'mercator'
}

export interface ConvertResult {
  style: StyleSpecification
  changes: Change[]
}
