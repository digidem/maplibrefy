import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

import { convertStyle } from './convert.js'
import type { Change, ConvertOptions } from './types.js'

/** The shape of maplibre-gl's `TransformStyleFunction`, declared structurally
 *  so consumers of this package's types need not resolve maplibre-gl. */
export type TransformStyleFunction = (
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
) => StyleSpecification

export interface TransformStyleOptions extends ConvertOptions {
  onChanges?: (changes: Change[]) => void
}

/** A `transformStyle` for `map.setStyle(url, { transformStyle })`. */
export function createTransformStyle(
  options: TransformStyleOptions = {},
): TransformStyleFunction {
  return (previous, next) => {
    void previous
    // Errors from convertStyle propagate: MapLibre surfaces them as the
    // style's error rather than loading a half-converted style.
    const { style, changes } = convertStyle(next, options)
    options.onChanges?.(changes)
    return style
  }
}
