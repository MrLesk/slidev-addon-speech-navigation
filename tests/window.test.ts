import { describe, expect, it } from 'vitest'
import { getNextSlideWindow, getSlideWindow, shouldPrefetch } from '../src/core/window'

describe('slide windows', () => {
  it('starts with ten slides', () => {
    expect(getSlideWindow(1, 25)).toEqual({
      start: 1,
      end: 10,
      numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    })
  })

  it('moves by seven slides to keep a three-slide overlap', () => {
    const first = getSlideWindow(1, 25)
    expect(getNextSlideWindow(first, 25)).toEqual({
      start: 8,
      end: 17,
      numbers: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    })
    expect(getSlideWindow(8, 25).start).toBe(1)
    expect(getSlideWindow(9, 25).start).toBe(8)
  })

  it('starts prefetching before the window boundary', () => {
    const first = getSlideWindow(1, 25)
    expect(shouldPrefetch(5, first, 25)).toBe(false)
    expect(shouldPrefetch(6, first, 25)).toBe(true)
  })

  it('always includes the immediate previous slide', () => {
    expect(getSlideWindow(9, 25).numbers).toContain(8)
    expect(getSlideWindow(16, 25).numbers).toContain(15)
  })

  it('stops at the last slide', () => {
    const last = getSlideWindow(24, 25)
    expect(last).toEqual({ start: 22, end: 25, numbers: [22, 23, 24, 25] })
    expect(getNextSlideWindow(last, 25)).toBeNull()
  })
})
