import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import type { ViteDevServer } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createImagePreparation, isDeckVisualFile } from '../src/server/prepare'

const root = resolve('/tmp', 'example-slidev-deck')

function createOptions(overrides: Record<string, unknown> = {}) {
  return {
    userRoot: root,
    entry: resolve(root, 'slides.md'),
    slideCount: () => 3,
    prepareCommand: resolve(root, 'prepare.mjs'),
    onPrepared: vi.fn(),
    retryDelays: [],
    ...overrides,
  }
}

function createServer() {
  const watcher = new EventEmitter()
  const httpServer = Object.assign(new EventEmitter(), { listening: false })
  return {
    server: { watcher, httpServer } as unknown as ViteDevServer,
    watcher,
    httpServer,
  }
}

describe('automatic slide image preparation', () => {
  it('does no work when prepared images are current', async () => {
    const runPrepare = vi.fn(async () => {})
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'ready', message: 'Ready' }),
      runPrepare,
    }))

    await preparation.prepare()

    expect(runPrepare).not.toHaveBeenCalled()
    expect(preparation.getStatus()).toEqual({ state: 'ready', message: 'Ready' })
  })

  it('prepares missing images and verifies the result', async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ state: 'missing', message: 'Missing' })
      .mockResolvedValueOnce({ state: 'ready', message: 'Ready' })
    const runPrepare = vi.fn(async () => {})
    const onPrepared = vi.fn()
    const preparation = createImagePreparation(createOptions({ inspect, runPrepare, onPrepared }))

    await preparation.prepare()

    expect(runPrepare).toHaveBeenCalledOnce()
    expect(onPrepared).toHaveBeenCalledOnce()
    expect(preparation.getStatus().state).toBe('ready')
  })

  it('coalesces changes during an export into one follow-up export', async () => {
    let finishFirstRun: (() => void) | undefined
    const firstRun = new Promise<void>(resolvePromise => finishFirstRun = resolvePromise)
    const runPrepare = vi.fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValueOnce(undefined)
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'ready', message: 'Ready' }),
      runPrepare,
    }))

    const pending = preparation.prepare(true)
    void preparation.prepare(true)
    void preparation.prepare(true)
    finishFirstRun?.()
    await pending

    expect(runPrepare).toHaveBeenCalledTimes(2)
  })

  it('queues an edit that arrives during the startup export', async () => {
    let finishFirstRun: (() => void) | undefined
    const firstRun = new Promise<void>(resolvePromise => finishFirstRun = resolvePromise)
    const runPrepare = vi.fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValueOnce(undefined)
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'ready', message: 'Ready' }),
      runPrepare,
    }))
    const { server, watcher, httpServer } = createServer()

    preparation.attach(server)
    httpServer.listening = true
    httpServer.emit('listening')
    await vi.waitFor(() => expect(runPrepare).toHaveBeenCalledOnce())
    watcher.emit('change', resolve(root, 'slides.md'))
    finishFirstRun?.()

    await vi.waitFor(() => expect(runPrepare).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(preparation.getStatus().state).toBe('ready'))
    httpServer.emit('close')
  })

  it('retries when an edit arrives during a failing export', async () => {
    let rejectFirstRun: ((error: Error) => void) | undefined
    const firstRun = new Promise<void>((_resolve, reject) => rejectFirstRun = reject)
    const runPrepare = vi.fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValueOnce(undefined)
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'ready', message: 'Ready' }),
      runPrepare,
    }))
    const { server, watcher, httpServer } = createServer()

    preparation.attach(server)
    httpServer.listening = true
    httpServer.emit('listening')
    await vi.waitFor(() => expect(runPrepare).toHaveBeenCalledOnce())
    watcher.emit('change', resolve(root, 'slides.md'))
    rejectFirstRun?.(new Error('Broken source'))

    await vi.waitFor(() => expect(runPrepare).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(preparation.getStatus().state).toBe('ready'))
    httpServer.emit('close')
  })

  it('reports an exporter failure without crashing the dev server', async () => {
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'missing', message: 'Missing' }),
      runPrepare: async () => { throw new Error('Chromium is missing') },
    }))

    await preparation.prepare()

    expect(preparation.getStatus()).toEqual({
      state: 'error',
      message: 'Slide images could not be prepared. Retrying automatically. Chromium is missing',
      failedAt: expect.any(Number),
    })
  })

  it('recovers automatically from a transient exporter failure', async () => {
    const runPrepare = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary browser error'))
      .mockResolvedValueOnce(undefined)
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'ready', message: 'Ready' }),
      retryDelays: [0],
      runPrepare,
    }))

    await preparation.prepare(true)

    expect(runPrepare).toHaveBeenCalledTimes(2)
    expect(preparation.getStatus().state).toBe('ready')
  })

  it('retries again after the failure cooldown', async () => {
    let shouldFail = true
    const runPrepare = vi.fn(async () => {
      if (shouldFail)
        throw new Error('Temporary browser error')
    })
    const preparation = createImagePreparation(createOptions({
      inspect: async () => ({ state: 'ready', message: 'Ready' }),
      runPrepare,
    }))

    await preparation.prepare(true)
    const failedAt = preparation.getStatus().failedAt!
    shouldFail = false

    expect(preparation.retryIfDue(failedAt + 14_999)).toBe(false)
    expect(preparation.retryIfDue(failedAt + 15_000)).toBe(true)
    await vi.waitFor(() => expect(preparation.getStatus().state).toBe('ready'))
    expect(runPrepare).toHaveBeenCalledTimes(2)
  })
})

describe('visual source filtering', () => {
  it('watches deck sources and local assets', () => {
    expect(isDeckVisualFile(root, resolve(root, 'slides.md'))).toBe(true)
    expect(isDeckVisualFile(root, resolve(root, 'components', 'Chart.vue'))).toBe(true)
    expect(isDeckVisualFile(root, resolve(root, 'public', 'diagram.png'))).toBe(true)
  })

  it('ignores generated, dependency, and unrelated files', () => {
    expect(isDeckVisualFile(root, resolve(root, '.slidev-speech-navigation', 'slides', '01.png'))).toBe(false)
    expect(isDeckVisualFile(root, resolve(root, 'node_modules', 'theme', 'style.css'))).toBe(false)
    expect(isDeckVisualFile(root, resolve(root, 'notes.txt'))).toBe(false)
    expect(isDeckVisualFile(root, resolve(root, '..', 'outside.vue'))).toBe(false)
  })
})
