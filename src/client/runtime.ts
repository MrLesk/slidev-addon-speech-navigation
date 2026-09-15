import type { RuntimeConfig } from '../shared/contracts'

/** Keep preparation status current, including after edits and server restarts. */
export function createRuntimePoller(refresh: (signal: AbortSignal) => Promise<RuntimeConfig>) {
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  async function poll(session: AbortController) {
    let delay = 1_000
    try {
      const runtime = await refresh(session.signal)
      if (runtime.assets === 'ready')
        delay = 2_000
    }
    catch {
      // The caller displays the error. Retry while the presenter is mounted.
    }
    finally {
      if (controller === session && !session.signal.aborted)
        timer = setTimeout(() => { void poll(session) }, delay)
    }
  }

  function stop() {
    controller?.abort()
    controller = null
    if (timer)
      clearTimeout(timer)
    timer = null
  }

  return {
    start() {
      stop()
      controller = new AbortController()
      void poll(controller)
    },
    stop,
  }
}
