import type { TransformStyleFunction } from 'maplibre-gl'

import type { Change, ConvertOptions } from './types.js'

export interface TransformStyleOptions extends ConvertOptions {
  onChanges?: (changes: Change[]) => void
}

/** A `transformStyle` for `map.setStyle(url, { transformStyle })`. */
export function createTransformStyle(
  options: TransformStyleOptions = {},
): TransformStyleFunction {
  void options
  throw new Error('not implemented')
}
