import { describe, expect, it } from 'vitest'
import { parseAddonSettings } from '../src/core/config'

describe('parseAddonSettings', () => {
  it('uses small, safe defaults', () => {
    expect(parseAddonSettings(undefined)).toEqual({ behavior: 'balanced' })
  })

  it('accepts the two public options', () => {
    expect(parseAddonSettings({ language: ' de-AT ', behavior: 'careful' })).toEqual({
      language: 'de-AT',
      behavior: 'careful',
    })
  })

  it('falls back when behavior is unknown', () => {
    expect(parseAddonSettings({ behavior: 'fast' })).toEqual({ behavior: 'balanced' })
  })
})
