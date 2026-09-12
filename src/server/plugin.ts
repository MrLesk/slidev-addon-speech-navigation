import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SlideInfo } from '@slidev/types'
import type { Plugin } from 'vite'
import { buildLiveSession, DEFAULT_LIVE_MODEL, DEFAULT_NAVIGATION_MODEL } from '../core/prompts'
import {
  getNextSlideWindow,
  getSlideWindow,
  shouldPrefetch,
  type SlideWindow,
} from '../core/window'
import {
  CONFIG_PATH,
  DECISION_PATH,
  LIVE_SESSION_PATH,
  PREFETCH_PATH,
  type AddonSettings,
  type NavigationState,
  type PreparedSlide,
  type SlideWindowAnalysis,
} from '../shared/contracts'
import { analyzeSlideWindow, OpenAIRequestError, requestNavigationDecision } from './openai'
import { getAssetGeneration, getWindowCacheKey, inspectAssets, loadPreparedSlides } from './slides'

interface WindowContext {
  preparedSlides: PreparedSlide[]
  analysis: SlideWindowAnalysis
}

export interface SpeechNavigationPluginOptions {
  apiKey?: string
  userRoot: string
  entry: string
  slides: () => SlideInfo[]
  settings: AddonSettings
  liveModel?: string
  navigationModel?: string
  fetcher?: typeof fetch
}

const MAX_JSON_BODY_BYTES = 64 * 1_024
const MAX_LIVE_BODY_BYTES = 256 * 1_024

function isLoopbackRequest(req: IncomingMessage) {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes)
      throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function readState(value: unknown, actualTotal: number): NavigationState | null {
  if (!value || typeof value !== 'object')
    return null
  const input = value as Record<string, unknown>
  if (!Number.isInteger(input.currentSlide)
    || !Number.isInteger(input.totalSlides)
    || input.totalSlides !== actualTotal
    || (input.currentSlide as number) < 1
    || (input.currentSlide as number) > actualTotal)
    return null
  return {
    currentSlide: input.currentSlide as number,
    totalSlides: actualTotal,
  }
}

export function createSpeechNavigationPlugin(options: SpeechNavigationPluginOptions): Plugin {
  const apiKey = options.apiKey?.trim() ?? ''
  const liveModel = options.liveModel?.trim() || DEFAULT_LIVE_MODEL
  const navigationModel = options.navigationModel?.trim() || DEFAULT_NAVIGATION_MODEL
  const fetcher = options.fetcher ?? fetch
  const cache = new Map<string, Promise<WindowContext>>()

  async function learnWindow(window: SlideWindow) {
    const slides = options.slides()
    const assetGeneration = await getAssetGeneration(options.userRoot)
    const cacheKey = getWindowCacheKey(slides, window, assetGeneration)
    const existing = cache.get(cacheKey)
    if (existing)
      return existing

    const pending = (async () => {
      const preparedSlides = await loadPreparedSlides(options.userRoot, slides, window)
      const analysis = await analyzeSlideWindow(apiKey, preparedSlides, navigationModel, fetcher)
      return { preparedSlides, analysis }
    })()
    cache.set(cacheKey, pending)

    try {
      const value = await pending
      while (cache.size > 4)
        cache.delete(cache.keys().next().value as string)
      return value
    }
    catch (error) {
      cache.delete(cacheKey)
      throw error
    }
  }

  async function learnForSlide(currentSlide: number, includeNext: boolean) {
    const totalSlides = options.slides().length
    const window = getSlideWindow(currentSlide, totalSlides)
    const current = await learnWindow(window)

    if (includeNext && shouldPrefetch(currentSlide, window, totalSlides)) {
      const next = getNextSlideWindow(window, totalSlides)
      if (next)
        await learnWindow(next)
    }

    return current
  }

  async function requireReady(res: ServerResponse) {
    if (!apiKey) {
      sendJson(res, 503, {
        error: 'OPENAI_API_KEY is missing. Add it to .env and restart Slidev.',
      })
      return false
    }

    const assets = await inspectAssets(options.userRoot, options.entry, options.slides().length)
    if (assets.state !== 'ready') {
      sendJson(res, 409, { error: assets.message, assets: assets.state })
      return false
    }
    return true
  }

  return {
    name: 'slidev-addon-speech-navigation',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname
        const isAddonPath = path === CONFIG_PATH
          || path === LIVE_SESSION_PATH
          || path === PREFETCH_PATH
          || path === DECISION_PATH

        if (!isAddonPath) {
          next()
          return
        }

        if (!isLoopbackRequest(req)) {
          sendJson(res, 403, { error: 'Speech navigation accepts requests from this computer only' })
          return
        }

        try {
          if (path === CONFIG_PATH) {
            if (req.method !== 'GET') {
              res.setHeader('Allow', 'GET')
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            const assets = await inspectAssets(options.userRoot, options.entry, options.slides().length)
            const ready = Boolean(apiKey) && assets.state === 'ready'
            sendJson(res, 200, {
              ready,
              hasApiKey: Boolean(apiKey),
              assets: assets.state,
              message: apiKey ? assets.message : 'OPENAI_API_KEY is missing. Add it to .env and restart Slidev.',
              settings: options.settings,
            })
            return
          }

          if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST')
            sendJson(res, 405, { error: 'Method not allowed' })
            return
          }
          if (!await requireReady(res))
            return

          if (path === LIVE_SESSION_PATH) {
            const body = await readJson(req, MAX_LIVE_BODY_BYTES) as { sdp?: unknown, state?: unknown }
            if (typeof body.sdp !== 'string' || !body.sdp.trim()) {
              sendJson(res, 400, { error: 'A WebRTC offer is required' })
              return
            }
            const state = readState(body.state, options.slides().length)
            if (!state) {
              sendJson(res, 400, { error: 'The slide state is invalid' })
              return
            }

            const abort = new AbortController()
            const timeout = setTimeout(() => abort.abort(), 15_000)
            let response: Response
            let responseBody: string
            try {
              response = await fetcher('https://api.openai.com/v1/live/sessions', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  session: buildLiveSession(state, options.settings, liveModel),
                  transport: { type: 'webrtc', sdp: body.sdp },
                }),
                signal: abort.signal,
              })
              responseBody = await response.text()
            }
            catch (error) {
              if (abort.signal.aborted) {
                sendJson(res, 504, { error: 'OpenAI live session timed out' })
                return
              }
              throw error
            }
            finally {
              clearTimeout(timeout)
            }
            if (!response.ok) {
              sendJson(res, response.status, {
                error: `OpenAI live session failed (${response.status})`,
              })
              return
            }
            try {
              sendJson(res, 201, JSON.parse(responseBody) as unknown)
            }
            catch {
              sendJson(res, 502, { error: 'OpenAI live session returned invalid JSON' })
            }
            return
          }

          const body = await readJson(req, MAX_JSON_BODY_BYTES) as Record<string, unknown>
          const state = readState(body, options.slides().length)
          if (!state) {
            sendJson(res, 400, { error: 'currentSlide and totalSlides must match the open deck' })
            return
          }

          if (path === PREFETCH_PATH) {
            const context = await learnForSlide(state.currentSlide, true)
            sendJson(res, 200, {
              ready: true,
              window: { start: context.analysis.start, end: context.analysis.end },
            })
            return
          }

          if (typeof body.transcript !== 'string' || !body.transcript.trim()) {
            sendJson(res, 400, { error: 'A non-empty transcript is required' })
            return
          }
          const context = await learnForSlide(state.currentSlide, false)
          const decision = await requestNavigationDecision(
            apiKey,
            state,
            body.transcript,
            context.preparedSlides,
            context.analysis,
            options.settings,
            navigationModel,
            fetcher,
          )
          sendJson(res, 200, decision)
        }
        catch (error) {
          if (error instanceof SyntaxError) {
            sendJson(res, 400, { error: 'Request body must be valid JSON' })
            return
          }
          if (error instanceof OpenAIRequestError) {
            sendJson(res, error.status, { error: error.message })
            return
          }
          const message = error instanceof Error ? error.message : 'Speech navigation failed'
          sendJson(res, 500, { error: message })
        }
      })

      server.httpServer?.once('close', () => cache.clear())
    },
  }
}
