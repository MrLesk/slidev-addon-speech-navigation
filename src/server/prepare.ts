import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, sep } from 'node:path'
import type { ViteDevServer } from 'vite'
import { inspectAssets, type AssetStatus } from './slides'

export type PreparationState = 'checking' | 'preparing' | 'ready' | 'error'

export interface PreparationStatus {
  state: PreparationState
  message: string
  failedAt?: number
}

export type RuntimeAssetStatus = AssetStatus | {
  state: 'preparing' | 'error'
  message: string
}

export function resolveRuntimeAssetStatus(
  preparation: PreparationStatus,
  assets: AssetStatus,
): RuntimeAssetStatus {
  if (preparation.state === 'checking' || preparation.state === 'preparing') {
    return {
      state: 'preparing',
      message: preparation.message,
    }
  }
  if (preparation.state === 'error') {
    return {
      state: 'error',
      message: preparation.message,
    }
  }
  return assets
}

interface ImagePreparationOptions {
  userRoot: string
  entry: string
  slideCount: () => number
  prepareCommand: string
  onPrepared: () => void
  inspect?: () => Promise<AssetStatus>
  runPrepare?: () => Promise<void>
  debounceMs?: number
  retryDelays?: number[]
}

const VISUAL_EXTENSIONS = new Set([
  '.avif', '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json',
  '.jsx', '.less', '.md', '.mdc', '.otf', '.png', '.sass', '.scss', '.styl',
  '.stylus', '.svg', '.ts', '.tsx', '.ttf', '.vue', '.webp', '.woff', '.woff2',
  '.yaml', '.yml',
])

const IGNORED_DIRECTORIES = new Set([
  '.git', '.output', '.slidev-speech-navigation', '.vite', 'dist', 'node_modules',
])

const FAILURE_RETRY_COOLDOWN_MS = 15_000

export function isDeckVisualFile(userRoot: string, file: string) {
  const path = relative(userRoot, file)
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    return false
  if (path.split(/[\\/]/).some(part => IGNORED_DIRECTORIES.has(part)))
    return false
  return VISUAL_EXTENSIONS.has(extname(path).toLowerCase())
}

function runPrepareCommand(options: ImagePreparationOptions, setChild: (child: ChildProcess | null) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [options.prepareCommand, options.entry], {
      cwd: options.userRoot,
      env: {
        ...process.env,
        SLIDEV_SPEECH_NAVIGATION_AUTO: '1',
      },
      stdio: 'inherit',
    })
    setChild(child)
    child.once('error', (error) => {
      setChild(null)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      setChild(null)
      if (code === 0)
        resolve()
      else
        reject(new Error(signal
          ? `Slide image preparation stopped with ${signal}`
          : `Slide image preparation failed with exit code ${code}`))
    })
  })
}

export function createImagePreparation(options: ImagePreparationOptions) {
  const inspect = options.inspect
    ?? (() => inspectAssets(options.userRoot, options.entry, options.slideCount()))
  let status: PreparationStatus = {
    state: 'checking',
    message: 'Checking the prepared slide images…',
  }
  let running: Promise<void> | null = null
  let rerun = false
  let stopped = false
  let serverStarted = false
  let debounce: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let finishRetry: (() => void) | null = null
  let child: ChildProcess | null = null
  const attachedAt = Date.now()
  const retryDelays = options.retryDelays ?? [750, 2_500]

  const runPrepare = options.runPrepare
    ?? (() => runPrepareCommand(options, value => child = value))

  function waitBeforeRetry(milliseconds: number) {
    return new Promise<void>((resolve) => {
      const finish = () => {
        if (retryTimer)
          clearTimeout(retryTimer)
        retryTimer = null
        finishRetry = null
        resolve()
      }
      finishRetry = finish
      retryTimer = setTimeout(finish, milliseconds)
    })
  }

  async function prepareOnce(force: boolean) {
    if (!force) {
      const assets = await inspect()
      if (assets.state === 'ready') {
        status = { state: 'ready', message: assets.message }
        return
      }
    }

    status = {
      state: 'preparing',
      message: 'Preparing slide images in the background…',
    }
    await runPrepare()
    if (stopped)
      return

    const assets = await inspect()
    if (assets.state !== 'ready')
      throw new Error(assets.message)
    status = { state: 'ready', message: assets.message }
    options.onPrepared()
  }

  function prepare(force = false) {
    if (stopped)
      return Promise.resolve()
    if (running) {
      rerun ||= force
      return running
    }

    running = (async () => {
      let forceNextRun = force
      let retriesUsed = 0
      while (!stopped) {
        rerun = false
        try {
          await prepareOnce(forceNextRun)
          if (!rerun)
            break
          forceNextRun = true
          retriesUsed = 0
        }
        catch (error) {
          if (rerun && !stopped) {
            forceNextRun = true
            retriesUsed = 0
            continue
          }
          const retryDelay = retryDelays[retriesUsed]
          if (retryDelay !== undefined && !stopped) {
            retriesUsed += 1
            forceNextRun = true
            status = {
              state: 'preparing',
              message: 'Slide image preparation was interrupted. Retrying automatically…',
            }
            await waitBeforeRetry(retryDelay)
            continue
          }
          const detail = error instanceof Error ? error.message : 'Unknown error'
          status = {
            state: 'error',
            message: `Slide images could not be prepared. Retrying automatically. ${detail}`,
            failedAt: Date.now(),
          }
          break
        }
      }
    })()
      .finally(() => running = null)
    return running
  }

  function scheduleRefresh(file: string) {
    if (!serverStarted || !isDeckVisualFile(options.userRoot, file))
      return

    status = {
      state: 'preparing',
      message: 'Slides changed. Updating their images…',
    }
    if (running) {
      rerun = true
      return
    }
    if (debounce)
      clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void prepare(true)
    }, options.debounceMs ?? 1_000)
  }

  function retryIfDue(now = Date.now()) {
    const failedAt = status.failedAt
    if (running
      || status.state !== 'error'
      || !failedAt
      || now - failedAt < FAILURE_RETRY_COOLDOWN_MS)
      return false
    void prepare(true)
    return true
  }

  function attach(server: ViteDevServer) {
    const onListening = () => {
      serverStarted = true
      // A fresh export on each start also catches changes inside themes and addons.
      void prepare(true)
    }
    const onFileChange = (file: string) => scheduleRefresh(file)
    const onFileAdd = async (file: string) => {
      if (!isDeckVisualFile(options.userRoot, file)) return
      const info = await stat(file).catch(() => null)
      // Vite discovers existing files after listening; those are in the startup export.
      if (!stopped && info && info.ctimeMs > attachedAt) scheduleRefresh(file)
    }
    const stop = () => {
      stopped = true
      if (debounce)
        clearTimeout(debounce)
      finishRetry?.()
      const runningChild = child
      runningChild?.kill('SIGTERM')
      if (runningChild) {
        const forceStop = setTimeout(() => {
          if (child === runningChild)
            runningChild.kill('SIGKILL')
        }, 5_000)
        forceStop.unref()
      }
      server.watcher.off('add', onFileAdd)
      server.watcher.off('change', onFileChange)
      server.watcher.off('unlink', onFileChange)
    }

    server.watcher.on('add', onFileAdd)
    server.watcher.on('change', onFileChange)
    server.watcher.on('unlink', onFileChange)
    server.httpServer?.once('close', stop)

    if (server.httpServer?.listening)
      onListening()
    else
      server.httpServer?.once('listening', onListening)
  }

  return {
    attach,
    getStatus: () => status,
    prepare,
    retryIfDue,
  }
}
