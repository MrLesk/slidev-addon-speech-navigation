import { describe, expect, it } from 'vitest'
import { parseAddonSettings, resolveModel } from '../src/core/config'

describe('parseAddonSettings', () => {
  it('uses small, safe defaults', () => {
    expect(parseAddonSettings(undefined)).toEqual({ behavior: 'balanced', fastMode: true })
  })

  it('accepts language and behavior', () => {
    expect(parseAddonSettings({ language: ' de-AT ', behavior: 'careful' })).toEqual({
      language: 'de-AT',
      behavior: 'careful', fastMode: true,
    })
  })

  it('falls back when behavior is unknown', () => {
    expect(parseAddonSettings({ behavior: 'unknown' })).toEqual({ behavior: 'balanced', fastMode: true })
  })
})

it('accepts rehearsal mode and speech reveals only when explicitly selected', () => {
  expect(parseAddonSettings({ mode: 'rehearsal', reveals: 'speech' }))
    .toEqual({ behavior: 'balanced', fastMode: true, mode: 'rehearsal', reveals: 'speech' })
  expect(parseAddonSettings({ mode: 'anything', reveals: true })).toEqual({ behavior: 'balanced', fastMode: true })
})


describe('model settings', () => {
  it('accepts and trims both model names from slide settings', () => {
    expect(parseAddonSettings({ liveModel: ' custom-live ', model: ' custom-navigation ' }))
      .toEqual({ behavior: 'balanced', fastMode: true, liveModel: 'custom-live', model: 'custom-navigation' })
  })

  it.each(['', '   ', null, 42, {}, false])('ignores invalid or blank model names: %j', value => {
    expect(parseAddonSettings({ liveModel: value, model: value })).toEqual({ behavior: 'balanced', fastMode: true })
  })

  it('uses environment overrides before deck settings', () => {
    expect(resolveModel(' env-model ', 'deck-model', 'default-model')).toBe('env-model')
  })

  it('uses deck settings when the environment override is missing or blank', () => {
    expect(resolveModel(undefined, ' deck-model ', 'default-model')).toBe('deck-model')
    expect(resolveModel(' ', 'deck-model', 'default-model')).toBe('deck-model')
  })

  it('uses the default when neither source has a model name', () => {
    expect(resolveModel(undefined, undefined, 'default-model')).toBe('default-model')
    expect(resolveModel(' ', '', 'default-model')).toBe('default-model')
  })
})

it('defaults API Fast mode on and accepts an explicit opt-out', () => {
  expect(parseAddonSettings({ fastMode: true })).toEqual({ behavior: 'balanced', fastMode: true })
  expect(parseAddonSettings({ fastMode: false })).toEqual({ behavior: 'balanced', fastMode: false })
  expect(parseAddonSettings({ fastMode: 'invalid', behavior: 'fast' })).toEqual({ behavior: 'balanced', fastMode: true })
})
