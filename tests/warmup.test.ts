import { describe, expect, it, vi } from 'vitest'
import { createSlideWarmup } from '../src/client/warmup'

const state = { currentSlide: 1, totalSlides: 8 }
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('presenter slide warmup', () => {
  it('shares analysis while learning and reuses it when the microphone starts', async () => {
    const analysis = deferred()
    const prepare = vi.fn(() => analysis.promise)
    const onStatus = vi.fn()
    const warmup = createSlideWarmup(prepare, onStatus)
    const first = warmup.ensure(state, 'server-a:images-1')
    expect(onStatus).toHaveBeenLastCalledWith('learning', expect.stringContaining('Microphone is off'))
    expect(warmup.ensure({ ...state, currentSlide: 3 }, 'server-a:images-1')).toBe(first)
    analysis.resolve()
    await first
    await warmup.ensure(state, 'server-a:images-1', true)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenLastCalledWith('ready', expect.any(String))
  })

  it('prepares again when images change or the development server restarts', async () => {
    const prepare = vi.fn(async () => {})
    const warmup = createSlideWarmup(prepare, vi.fn())
    await warmup.ensure(state, 'server-a:images-1')
    await warmup.ensure(state, 'server-a:images-2')
    await warmup.ensure(state, 'server-b:images-2')
    expect(prepare).toHaveBeenCalledTimes(3)
  })

  it('ignores an old analysis result after switching slide groups', async () => {
    const old = deferred()
    const current = deferred()
    const prepare = vi.fn((_state, _signal: AbortSignal) => old.promise).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    const onStatus = vi.fn()
    const warmup = createSlideWarmup(prepare, onStatus)
    const first = warmup.ensure({ currentSlide: 1, totalSlides: 20 }, 'v1')
    const second = warmup.ensure({ currentSlide: 15, totalSlides: 20 }, 'v1')
    expect(prepare.mock.calls[0]![1].aborted).toBe(true)
    old.resolve()
    await first
    expect(onStatus).toHaveBeenLastCalledWith('learning', expect.stringContaining('8–17'))
    current.resolve()
    await second
    expect(onStatus).toHaveBeenLastCalledWith('ready', expect.any(String))
  })

  it('keeps a failure visible until an explicit retry instead of repeating paid requests', async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error('Analysis failed')).mockResolvedValue(undefined)
    const onStatus = vi.fn()
    const warmup = createSlideWarmup(prepare, onStatus)
    await expect(warmup.ensure(state, 'v1')).rejects.toThrow('Analysis failed')
    await expect(warmup.ensure(state, 'v1')).rejects.toThrow('Analysis failed')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenLastCalledWith('error', 'Analysis failed')
    await warmup.ensure(state, 'v1', true)
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenLastCalledWith('ready', expect.any(String))
  })

  it('does not publish readiness after the presenter closes', async () => {
    const analysis = deferred()
    const onStatus = vi.fn()
    const warmup = createSlideWarmup(() => analysis.promise, onStatus)
    const first = warmup.ensure(state, 'v1')
    warmup.stop()
    analysis.resolve()
    await first
    expect(onStatus).toHaveBeenCalledTimes(1)
  })
})
