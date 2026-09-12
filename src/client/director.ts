import {
  DECISION_PATH,
  LIVE_SESSION_PATH,
  PREFETCH_PATH,
  type NavigationDecision,
  type NavigationState,
  type NavigationStatus,
  type NavigationTool,
} from '../shared/contracts'

interface LiveSessionResponse {
  transport?: { sdp?: string }
}

interface TranscriptEvent {
  type: 'session.input_transcript.delta'
  delta?: string
}

interface ErrorEvent {
  type: 'error'
  error?: { message?: string }
}

export interface SpeechDirectorOptions {
  getState: () => NavigationState
  execute: (tool: NavigationTool) => Promise<void>
  onStatus: (status: NavigationStatus, message: string) => void
  decisionDelayMs?: number
}

const MAX_TRANSCRIPT_LENGTH = 24_000
const DEFAULT_DECISION_DELAY = 450
const DECISION_TIMEOUT_MS = 10_000

function isNavigationTool(value: unknown): value is NavigationTool {
  return value === 'next_slide' || value === 'previous_slide' || value === 'hold_slide'
}

async function readError(response: Response) {
  const raw = await response.text()
  try {
    const value = JSON.parse(raw) as { error?: unknown }
    return typeof value.error === 'string' ? value.error : `Request failed (${response.status})`
  }
  catch {
    return raw || `Request failed (${response.status})`
  }
}

async function waitForIce(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete')
    return

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (peer.iceGatheringState === 'complete')
        finish()
    }
    const timeout = setTimeout(finish, 3_000)
    peer.addEventListener('icegatheringstatechange', onChange)
  })
}

export async function prefetchSlideWindow(state: NavigationState, signal?: AbortSignal) {
  const response = await fetch(PREFETCH_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
    signal,
  })
  if (!response.ok)
    throw new Error(await readError(response))
}

export class SpeechDirector {
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private media: MediaStream | null = null
  private transcript = ''
  private transcriptRevision = 0
  private requestedRevision = 0
  private stateRevision = 0
  private lifecycleRevision = 0
  private decisionPending = false
  private decisionTimer: ReturnType<typeof setTimeout> | null = null
  private connectAbort: AbortController | null = null
  private decisionAbort: AbortController | null = null

  constructor(private readonly options: SpeechDirectorOptions) {}

  async connect() {
    this.disconnect(false)
    const lifecycleRevision = this.lifecycleRevision
    const abort = new AbortController()
    this.connectAbort = abort
    this.options.onStatus('connecting', 'Requesting microphone access…')

    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('This browser does not support microphone input')

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (abort.signal.aborted || lifecycleRevision !== this.lifecycleRevision) {
        media.getTracks().forEach(track => track.stop())
        return
      }

      this.media = media
      const track = media.getAudioTracks()[0]
      if (!track)
        throw new Error('No microphone is available')

      const peer = new RTCPeerConnection()
      const channel = peer.createDataChannel('oai-events')
      this.peer = peer
      this.channel = channel
      peer.addTrack(track, media)

      channel.addEventListener('open', () => {
        if (this.channel === channel)
          this.options.onStatus('listening', 'Listening')
      })
      channel.addEventListener('message', event => this.handleEvent(event.data))
      channel.addEventListener('close', () => {
        if (this.channel === channel)
          this.fail('The live audio connection closed')
      })
      peer.addEventListener('connectionstatechange', () => {
        if (this.peer === peer && peer.connectionState === 'failed')
          this.fail('The live audio connection failed')
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await waitForIce(peer)
      if (abort.signal.aborted || lifecycleRevision !== this.lifecycleRevision)
        return

      const response = await fetch(LIVE_SESSION_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: peer.localDescription?.sdp ?? offer.sdp,
          state: this.options.getState(),
        }),
        signal: abort.signal,
      })
      if (abort.signal.aborted || lifecycleRevision !== this.lifecycleRevision)
        return
      if (!response.ok)
        throw new Error(await readError(response))

      const session = await response.json() as LiveSessionResponse
      if (!session.transport?.sdp)
        throw new Error('OpenAI did not return a WebRTC answer')
      await peer.setRemoteDescription({ type: 'answer', sdp: session.transport.sdp })
    }
    catch (error) {
      if (abort.signal.aborted || lifecycleRevision !== this.lifecycleRevision)
        return
      this.disconnect(false)
      const message = error instanceof Error ? error.message : 'Could not start speech navigation'
      this.options.onStatus('error', message)
      throw error
    }
    finally {
      if (this.connectAbort === abort)
        this.connectAbort = null
    }
  }

  disconnect(showStatus = true) {
    this.lifecycleRevision += 1
    this.clearTimer()
    this.connectAbort?.abort()
    this.decisionAbort?.abort()
    this.connectAbort = null
    this.decisionAbort = null
    const channel = this.channel
    const peer = this.peer
    const media = this.media
    this.channel = null
    this.peer = null
    this.media = null
    channel?.close()
    peer?.close()
    media?.getTracks().forEach(track => track.stop())
    this.decisionPending = false
    this.resetTranscript()
    if (showStatus)
      this.options.onStatus('off', 'Speech navigation is off')
  }

  updateSlideState(previous: NavigationState, current: NavigationState) {
    if (previous.currentSlide === current.currentSlide && previous.totalSlides === current.totalSlides)
      return
    this.stateRevision += 1
    this.clearTimer()
    this.resetTranscript()
  }

  private handleEvent(raw: unknown) {
    if (typeof raw !== 'string')
      return

    let event: TranscriptEvent | ErrorEvent | { type?: string }
    try {
      event = JSON.parse(raw) as typeof event
    }
    catch {
      return
    }

    if (event.type === 'error') {
      const message = (event as ErrorEvent).error?.message || 'OpenAI live audio returned an error'
      this.fail(message)
      return
    }
    if (event.type !== 'session.input_transcript.delta')
      return

    const delta = (event as TranscriptEvent).delta
    if (!delta)
      return
    this.transcript = `${this.transcript}${delta}`.slice(-MAX_TRANSCRIPT_LENGTH)
    this.transcriptRevision += 1
    this.scheduleDecision()
  }

  private scheduleDecision(delay = this.options.decisionDelayMs ?? DEFAULT_DECISION_DELAY) {
    if (this.decisionPending || this.transcriptRevision <= this.requestedRevision || this.decisionTimer)
      return

    this.decisionTimer = setTimeout(() => {
      this.decisionTimer = null
      void this.decide()
    }, delay)
  }

  private async decide() {
    const transcript = this.transcript.trim()
    if (!transcript || this.decisionPending || this.transcriptRevision <= this.requestedRevision)
      return

    const state = this.options.getState()
    const stateRevision = this.stateRevision
    const lifecycleRevision = this.lifecycleRevision
    const abort = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, DECISION_TIMEOUT_MS)
    this.decisionAbort = abort
    this.requestedRevision = this.transcriptRevision
    this.decisionPending = true

    try {
      const response = await fetch(DECISION_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state, transcript }),
        signal: abort.signal,
      })
      if (!response.ok)
        throw new Error(await readError(response))

      const decision = await response.json() as Partial<NavigationDecision>
      if (!isNavigationTool(decision.tool))
        throw new Error('OpenAI did not return a valid navigation action')

      const latest = this.options.getState()
      if (lifecycleRevision !== this.lifecycleRevision
        || stateRevision !== this.stateRevision
        || state.currentSlide !== latest.currentSlide
        || state.totalSlides !== latest.totalSlides)
        return

      if (decision.tool !== 'hold_slide')
        this.options.onStatus('acting', decision.tool === 'next_slide' ? 'Moving forward…' : 'Moving back…')
      await this.options.execute(decision.tool)
      this.options.onStatus('listening', 'Listening')
    }
    catch (error) {
      if (lifecycleRevision !== this.lifecycleRevision)
        return
      const message = timedOut
        ? 'The navigation decision timed out'
        : error instanceof Error ? error.message : 'Navigation decision failed'
      this.fail(message)
    }
    finally {
      clearTimeout(timeout)
      if (this.decisionAbort === abort)
        this.decisionAbort = null
      this.decisionPending = false
      if (this.transcriptRevision > this.requestedRevision)
        this.scheduleDecision(0)
    }
  }

  private resetTranscript() {
    this.transcript = ''
    this.transcriptRevision = 0
    this.requestedRevision = 0
  }

  private clearTimer() {
    if (this.decisionTimer)
      clearTimeout(this.decisionTimer)
    this.decisionTimer = null
  }

  private fail(message: string) {
    this.disconnect(false)
    this.options.onStatus('error', message)
  }
}
