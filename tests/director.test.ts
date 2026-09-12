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
