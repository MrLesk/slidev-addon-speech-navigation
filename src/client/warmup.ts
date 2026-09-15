import { getSlideWindow } from '../core/window'
import type { NavigationState } from '../shared/contracts'

export type WarmupStatus = 'waiting' | 'learning' | 'ready' | 'error'

/** Prepare the current slide group during setup, without opening the microphone. */
export function createSlideWarmup(
  prepare: (state: NavigationState, signal: AbortSignal) => Promise<void>,
  onStatus: (status: WarmupStatus, message: string) => void,
) {
  let currentKey = ''
  let controller: AbortController | null = null
  let pending: Promise<void> | null = null
  let failed = false
  const ready = new Set<string>()

  function cancel() {
    controller?.abort()
    controller = null
    pending = null
    currentKey = ''
    failed = false
  }

  return {
    ensure(state: NavigationState, version: string, retry = false): Promise<void> {
      const window = getSlideWindow(state.currentSlide, state.totalSlides)
      const key = `${version}:${window.start}-${window.end}`
      if (currentKey === key && pending && !(retry && failed))
        return pending
      cancel()
      currentKey = key
      if (ready.has(key)) {
        onStatus('ready', 'Ready. Start speech navigation when you are ready to speak.')
        return Promise.resolve()
      }
      const session = new AbortController()
      controller = session
      onStatus('learning', `Learning slides ${window.start}–${window.end}… Microphone is off.`)
      pending = prepare({ ...state }, session.signal).then(() => {
        if (controller !== session || session.signal.aborted)
          return
        ready.add(key)
        while (ready.size > 4)
          ready.delete(ready.values().next().value!)
        onStatus('ready', 'Ready. Start speech navigation when you are ready to speak.')
      }).catch((error) => {
        if (controller === session && !session.signal.aborted) {
          failed = true
          onStatus('error', error instanceof Error ? error.message : 'Could not learn the slides. Try again.')
        }
        throw error
      })
      return pending
    },
    reset() {
      cancel()
      onStatus('waiting', 'Waiting for slide images…')
    },
    stop: cancel,
  }
}
