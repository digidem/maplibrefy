import type { ConvertOptions, ConvertResult } from './types.js'

export interface LoadStyleOptions extends ConvertOptions {
  accessToken?: string
  fetch?: typeof fetch
}

/** Fetch a style by URL (including `mapbox://` and Studio share links),
 *  resolve its relative URLs against the style URL, and convert it. */
export async function loadStyle(
  url: string,
  options: LoadStyleOptions = {},
): Promise<ConvertResult> {
  void url
  void options
  throw new Error('not implemented')
}
