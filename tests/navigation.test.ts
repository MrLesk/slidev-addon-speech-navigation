import { describe, expect, it } from 'vitest'
import { allowedTools, constrainDecision, sameNavigationState } from '../src/core/navigation'
import { parseSlideRules } from '../src/core/config'
import { readState } from '../src/server/plugin'

const state = { currentSlide: 2, totalSlides: 3, currentClick: 1, totalClicks: 3 }
const speech = { hold: false, reveals: 'speech' as const }

describe('navigation boundaries', () => {
  it('offers one reveal instead of leaving unfinished content', () => {
    expect(allowedTools(state, speech)).toEqual(['hold_slide', 'previous_slide', 'reveal_next'])
    expect(constrainDecision({ tool: 'next_slide' }, state, speech).tool).toBe('hold_slide')
  })
  it('waits for manual reveals and permits next only after the final step', () => {
    expect(allowedTools(state, { ...speech, reveals: 'manual' })).not.toContain('reveal_next')
    expect(allowedTools({ ...state, currentClick: 3 }, speech)).toContain('next_slide')
    expect(allowedTools({ ...state, currentClick: 3 }, speech)).not.toContain('reveal_next')
  })
  it('never leaves a held slide or goes past deck boundaries', () => {
    expect(allowedTools(state, { ...speech, hold: true })).toEqual(['hold_slide'])
    expect(allowedTools({ currentSlide: 1, totalSlides: 1 }, speech)).toEqual(['hold_slide'])
  })
  it('treats clicks and changed click totals as state changes', () => {
    expect(sameNavigationState(state, { ...state, currentClick: 2 })).toBe(false)
    expect(sameNavigationState(state, { ...state, totalClicks: 4 })).toBe(false)
  })
  it('uses explicit per-slide overrides with a safe default', () => {
    expect(parseSlideRules(undefined, { behavior: 'balanced' })).toEqual({ hold: false, reveals: 'manual' })
    expect(parseSlideRules({ hold: true, reveals: 'manual' }, { behavior: 'balanced', reveals: 'speech' }))
      .toEqual({ hold: true, reveals: 'manual' })
    expect(parseSlideRules({ hold: 'false', reveals: 'anything' }, { behavior: 'balanced', reveals: 'speech' }))
      .toEqual({ hold: false, reveals: 'speech' })
  })
  it('rejects impossible or nonnumeric click state from the client', () => {
    expect(readState(state, 3)).toEqual(state)
    for (const values of [{ currentClick: -1 }, { currentClick: 4 }, { totalClicks: '3' }, { currentClick: 1.2 }])
      expect(readState({ ...state, ...values }, 3)).toBeNull()
  })
})
