import type { ConvertOptions, ConvertResult } from './types.js'

/** Rewrite a Mapbox GL style so MapLibre GL loads it, dropping what cannot
 *  be expressed and reporting every change. */
export function convertStyle(
  style: unknown,
  options: ConvertOptions = {},
): ConvertResult {
  void style
  void options
  throw new Error('not implemented')
}
