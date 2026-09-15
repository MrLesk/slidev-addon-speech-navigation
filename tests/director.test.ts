import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechDirector } from '../src/client/director'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function fakeMedia() {
  const track = { stop: vi.fn() }
  return {
    track,
    stream: {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SpeechDirector lifecycle', () => {
  it('stops a microphone that arrives after cancellation', async () => {
    const media = fakeMedia()
    const permission = deferred<MediaStream>()
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(() => permission.promise) },
    })
    const peerConstructor = vi.fn()
    vi.stubGlobal('RTCPeerConnection', peerConstructor)

    const director = new SpeechDirector({
      getState: () => ({ currentSlide: 1, totalSlides: 2 }),
      execute: vi.fn(),
      onStatus: vi.fn(),
    })

    const connecting = director.connect()
    await Promise.resolve()
    director.disconnect()
    permission.resolve(media.stream)
    await connecting

    expect(media.track.stop).toHaveBeenCalledOnce()
    expect(peerConstructor).not.toHaveBeenCalled()
  })

  it('closes the microphone when the live service reports an error', async () => {
    const media = fakeMedia()
    const listeners = new Map<string, (event: { data: string }) => void>()
    const channel = {
      addEventListener: vi.fn((name: string, listener: (event: { data: string }) => void) => {
        listeners.set(name, listener)
      }),
      close: vi.fn(),
    }
    const peer = {
      iceGatheringState: 'complete',
      connectionState: 'connected',
      localDescription: { sdp: 'offer' },
      createDataChannel: vi.fn(() => channel),
      addTrack: vi.fn(),
      addEventListener: vi.fn(),
      createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer' })),
      setLocalDescription: vi.fn(async () => {}),
      setRemoteDescription: vi.fn(async () => {}),
      close: vi.fn(),
    }
    const onStatus = vi.fn()

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => media.stream) },
    })
    function FakePeerConnection() {
      return peer
    }
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      transport: { sdp: 'answer' },
    }), { status: 201 })))

    const director = new SpeechDirector({
      getState: () => ({ currentSlide: 1, totalSlides: 2 }),
      execute: vi.fn(),
      onStatus,
    })
    await director.connect()

    listeners.get('message')?.({
      data: JSON.stringify({ type: 'error', error: { message: 'session failed' } }),
    })

    expect(media.track.stop).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(onStatus).toHaveBeenLastCalledWith('error', 'session failed')
  })
})

async function connectedDirector(mode: 'auto' | 'rehearsal' = 'auto', started = true, decisionDelayMs: number | null = 5) {
  const media = fakeMedia()
  const track = media.track as typeof media.track & { enabled: boolean }
  track.enabled = true
  let listener: (event: { data: string }) => void = () => {}
  let opened: () => void = () => {}
  const channel = { close: vi.fn(), addEventListener: vi.fn((name, fn) => {
    if (name === 'message') listener = fn
    if (name === 'open') opened = fn
  }) }
  const peer = {
    iceGatheringState: 'complete', localDescription: { sdp: 'offer' },
    createDataChannel: () => channel, addTrack: vi.fn(), addEventListener: vi.fn(),
    createOffer: async () => ({ sdp: 'offer' }), setLocalDescription: async () => {},
    setRemoteDescription: async () => {}, close: vi.fn(),
  }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => media.stream } })
  vi.stubGlobal('RTCPeerConnection', function () { return peer })
  const requests: { resolve: (value: Response) => void, signal: AbortSignal, body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/live-session'))
      return new Response(JSON.stringify({ transport: { sdp: 'answer' } }))
    const pending = deferred<Response>()
    requests.push({ resolve: pending.resolve, signal: init.signal, body: JSON.parse(init.body) })
    return pending.promise
  }))
  let state = { currentSlide: 1, totalSlides: 3, currentClick: 0, totalClicks: 2 }
  let hold = false
  const execute = vi.fn(async () => {})
  const onStatus = vi.fn()
  const onDecision = vi.fn()
  const onTranscript = vi.fn()
  const director = new SpeechDirector({ getState: () => state, execute, onStatus, onDecision, onTranscript,
    getRules: () => ({ hold, reveals: 'speech' }), mode, ...(decisionDelayMs === null ? {} : { decisionDelayMs }) })
  await director.connect()
  if (started) listener({ data: JSON.stringify({ type: 'session.started' }) })
  return {
    director, requests, execute, onStatus, onDecision, onTranscript, track, peer,
    open: () => opened(),
    event: (type: string) => listener({ data: JSON.stringify({ type }) }),
    say: (delta: string) => listener({ data: JSON.stringify({ type: 'session.input_transcript.delta', delta }) }),
    slide: (currentSlide: number) => { const previous = state; state = { ...state, currentSlide, currentClick: 0 }; director.updateSlideState(previous, state) },
    step: (currentClick: number) => { const previous = state; state = { ...state, currentClick }; director.updateSlideState(previous, state) },
    hold: () => { hold = true; director.updateRules() },
    answer: (index: number, tool = 'reveal_next') => requests[index]!.resolve(new Response(JSON.stringify({ tool, reason: 'The next item is the topic.' }))),
  }
}

afterEach(() => vi.useRealTimers())

describe('speech navigation controls', () => {
  it('keeps earlier reveal speech for completion and clears it on another slide', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('First point. ')
    h.step(1)
    h.say('Second point.')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests[0]!.body).toMatchObject({ transcript: 'Second point.', slideTranscript: 'First point. Second point.' })
    h.slide(2)
    h.say('A different topic.')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests[1]!.body).toMatchObject({ currentSlide: 2, transcript: 'A different topic.', slideTranscript: 'A different topic.' })
    h.director.disconnect()
  })

  it('checks completion after the final reveal without requiring more speech', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('First point. ')
    h.step(1)
    h.say('The final point completes this idea.')
    h.step(2)
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests[0]!.body).toMatchObject({ transcript: '', slideTranscript: 'First point. The final point completes this idea.', currentClick: 2 })
    h.answer(0, 'next_slide')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).toHaveBeenCalledWith('next_slide')
    h.director.disconnect()
  })

  it('sends API Fast mode without changing the navigation timing', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector('auto', true, null)
    h.director.setFastMode(true)
    h.say('The main point is complete.')
    await vi.advanceTimersByTimeAsync(449)
    expect(h.requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.requests[0]!.body.fastMode).toBe(true)
    h.director.disconnect()
  })

  it('uses standard processing after Fast mode is unchecked', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.director.setFastMode(false)
    h.say('The idea is complete.')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests[0]!.body.fastMode).toBe(false)
    h.director.disconnect()
  })

  it('keeps the default 450 ms scheduling delay for Balanced', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector('auto', true, null)
    h.say('The main point is complete.')
    await vi.advanceTimersByTimeAsync(449)
    expect(h.requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.requests[0]!.body.fastMode).toBe(true)
    h.director.disconnect()
  })

  it('does not cancel a decision or erase speech when status polling returns identical rules', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('Let us look at the next item.')
    await vi.advanceTimersByTimeAsync(5)
    // Each poll supplies a new rules object with the same values.
    for (let i = 0; i < 3; i++) {
      h.director.updateRules()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(h.requests[0]!.signal.aborted).toBe(false)
      expect(h.onTranscript).toHaveBeenLastCalledWith('Let us look at the next item.')
    }
    h.answer(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).toHaveBeenCalledWith('reveal_next')
    h.director.disconnect()
  })

  it('preserves Heard history across steps, pauses, mode changes, and disconnection', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('First idea. ')
    h.step(1)
    h.director.pause()
    h.say('This paused speech is ignored. ')
    h.director.resume()
    h.director.setMode('rehearsal')
    expect(h.onTranscript).toHaveBeenLastCalledWith('First idea. ')
    h.say('Second idea.')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests[0]!.body.transcript).toBe('Second idea.')
    expect(h.onTranscript).toHaveBeenLastCalledWith('First idea. Second idea.')
    h.director.disconnect()
    expect(h.onTranscript).toHaveBeenLastCalledWith('First idea. Second idea.')
  })

  it('waits for session.started rather than the data channel opening', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector('auto', false)
    h.open()
    expect(h.onStatus).toHaveBeenLastCalledWith('connecting', expect.any(String))
    h.say('Too early')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests).toHaveLength(0)
    h.event('session.started')
    expect(h.onStatus).toHaveBeenLastCalledWith('listening', 'Listening')
    h.say('Now ready')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests).toHaveLength(1)
    h.director.disconnect()
  })

  it('shows an error when the live session never confirms startup', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector('auto', false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.onStatus).toHaveBeenLastCalledWith('error', expect.stringContaining('did not confirm'))
    expect(h.track.stop).toHaveBeenCalledOnce()
  })

  it('handles session.closed and preserves the last heard speech', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('Last phrase.')
    h.event('session.closed')
    expect(h.onStatus).toHaveBeenLastCalledWith('error', expect.stringContaining('session ended'))
    expect(h.onTranscript).toHaveBeenLastCalledWith('Last phrase.')
    expect(h.track.stop).toHaveBeenCalledOnce()
  })

  it('mutes on pause without disconnecting and resumes with fresh speech', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('old speech')
    await vi.advanceTimersByTimeAsync(5)
    h.director.pause()
    expect(h.track.enabled).toBe(false)
    expect(h.track.stop).not.toHaveBeenCalled()
    expect(h.peer.close).not.toHaveBeenCalled()
    expect(h.requests[0]!.signal.aborted).toBe(true)
    h.say('audience question')
    h.answer(0)
    await vi.advanceTimersByTimeAsync(10)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.onStatus).toHaveBeenLastCalledWith('paused', expect.any(String))
    h.director.resume()
    expect(h.track.enabled).toBe(true)
    h.say('new topic')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests[1]!.body.transcript).toBe('new topic')
    h.answer(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).toHaveBeenCalledWith('reveal_next')
    h.director.disconnect()
  })

  it('shows rehearsal suggestions without applying any action', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector('rehearsal')
    h.say('next item')
    await vi.advanceTimersByTimeAsync(5)
    h.answer(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ applied: false, decision: expect.objectContaining({ tool: 'reveal_next' }) }))
    expect(h.onStatus).toHaveBeenLastCalledWith('rehearsing', expect.any(String))
    h.director.disconnect()
  })

  it('invalidates an in-flight response when changing mode', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('next item')
    await vi.advanceTimersByTimeAsync(5)
    h.director.setMode('rehearsal')
    h.answer(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.onDecision).toHaveBeenLastCalledWith(null)
    h.director.disconnect()
  })

  it('a stale response cannot act after a manual click or clear the newer request', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('first item')
    await vi.advanceTimersByTimeAsync(5)
    h.step(1)
    h.say('second item')
    await vi.advanceTimersByTimeAsync(5)
    h.answer(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).not.toHaveBeenCalled()
    h.say(' more detail')
    await vi.advanceTimersByTimeAsync(20)
    expect(h.requests).toHaveLength(2)
    h.answer(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).toHaveBeenCalledOnce()
    h.director.disconnect()
  })

  it('holds locally without a model request and cancels previous suggestions', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.hold()
    h.say('next slide topic')
    await vi.advanceTimersByTimeAsync(5)
    expect(h.requests).toHaveLength(0)
    expect(h.onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ decision: { tool: 'hold_slide', reason: 'This slide uses manual control.' } }))
    h.director.disconnect()
  })

  it('keeps the last applied action visible after Slidev finishes a reveal', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('first item')
    await vi.advanceTimersByTimeAsync(5)
    h.answer(0)
    await vi.advanceTimersByTimeAsync(0)
    h.step(1)
    expect(h.onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ applied: true }))
    h.director.pause()
    expect(h.onDecision).toHaveBeenLastCalledWith(null)
    h.director.disconnect()
  })

  it('blocks a model response that skips remaining steps', async () => {
    vi.useFakeTimers()
    const h = await connectedDirector()
    h.say('next slide topic')
    await vi.advanceTimersByTimeAsync(5)
    h.answer(0, 'next_slide')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ decision: expect.objectContaining({ tool: 'hold_slide' }) }))
    h.director.disconnect()
  })
})
