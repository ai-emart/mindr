import { describe, it, expect } from 'vitest'
import * as mod from '../src/index.js'

describe('smoke', () => {
  it('exports an object', () => {
    expect(typeof mod).toBe('object')
  })

  it('exports VERSION', () => {
    expect(mod.VERSION).toBe('0.0.1')
  })
})
