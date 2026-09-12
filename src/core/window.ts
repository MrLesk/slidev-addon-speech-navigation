export const WINDOW_SIZE = 10
export const WINDOW_OVERLAP = 3
export const PREFETCH_DISTANCE = 4

export interface SlideWindow {
  start: number
  end: number
  numbers: number[]
}

function clampSlide(value: number, totalSlides: number) {
  return Math.min(Math.max(Math.trunc(value), 1), totalSlides)
}

function windowFromStart(start: number, totalSlides: number): SlideWindow {
  const safeStart = clampSlide(start, totalSlides)
  const end = Math.min(safeStart + WINDOW_SIZE - 1, totalSlides)
  return {
    start: safeStart,
    end,
    numbers: Array.from({ length: end - safeStart + 1 }, (_, index) => safeStart + index),
  }
}

export function getSlideWindow(currentSlide: number, totalSlides: number): SlideWindow {
  if (!Number.isInteger(totalSlides) || totalSlides < 1)
    throw new Error('A presentation must contain at least one slide')

  const current = clampSlide(currentSlide, totalSlides)
  const step = WINDOW_SIZE - WINDOW_OVERLAP
  // Keep the immediate previous slide in view at every window boundary.
  const start = Math.floor(Math.max(current - 2, 0) / step) * step + 1
  return windowFromStart(start, totalSlides)
}

export function getNextSlideWindow(window: SlideWindow, totalSlides: number) {
  if (window.end >= totalSlides)
    return null

  return windowFromStart(window.start + WINDOW_SIZE - WINDOW_OVERLAP, totalSlides)
}

export function shouldPrefetch(currentSlide: number, window: SlideWindow, totalSlides: number) {
  return window.end < totalSlides && currentSlide >= window.end - PREFETCH_DISTANCE
}
