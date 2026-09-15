import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimePoller } from '../src/client/runtime'
import type { RuntimeConfig } from '../src/shared/contracts'

function runtime(assets: RuntimeConfig['assets']): RuntimeConfig {
  return { ready: assets === 'ready', hasApiKey: true, assets, message: assets, settings: { behavior: 'balanced' } }
}

afterEach(() => vi.useRealTimers())

describe('presenter preparation status polling', () => {
  it('keeps checking after readiness so later slide edits are detected', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
      .mockResolvedValueOnce(runtime('preparing'))
      .mockResolvedValueOnce(runtime('ready'))
      .mockResolvedValueOnce(runtime('preparing'))
      .mockResolvedValue(runtime('ready'))
    const poller = createRuntimePoller(refresh)
    poller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(refresh).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).toHaveBeenCalledTimes(4)
    poller.stop()
  })

  it('retries a failed request after the development server restarts', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn().mockRejectedValueOnce(new Error('Connection refused')).mockResolvedValue(runtime('ready'))
    const poller = createRuntimePoller(refresh)
    poller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('does not overlap slow requests and aborts when the presenter unmounts', async () => {
    vi.useFakeTimers()
    let resolve!: (config: RuntimeConfig) => void
    const refresh = vi.fn((_signal: AbortSignal) => new Promise<RuntimeConfig>(r => resolve = r))
    const poller = createRuntimePoller(refresh)
    poller.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    const signal = refresh.mock.calls[0]![0] as AbortSignal
    poller.stop()
    expect(signal.aborted).toBe(true)
    resolve(runtime('ready'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not let a stopped poll schedule more requests after a new start', async () => {
    vi.useFakeTimers()
    let resolve!: (config: RuntimeConfig) => void
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<RuntimeConfig>(r => resolve = r)).mockResolvedValue(runtime('ready'))
    const poller = createRuntimePoller(refresh)
    poller.start()
    poller.start()
    resolve(runtime('ready'))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(refresh).toHaveBeenCalledTimes(3)
    poller.stop()
  })
})
