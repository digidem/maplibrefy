import { expect, it } from 'vitest'

import { convertStyle } from '../src/index.js'

it('exports convertStyle', () => {
  expect(typeof convertStyle).toBe('function')
})
