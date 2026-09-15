import { constrainDecision } from '../core/navigation'
import {
  ANALYSIS_TOOL,
  buildNavigationRequest,
  buildWindowAnalysisRequest,
} from '../core/prompts'
import type {
  AddonSettings,
  NavigationDecision,
  NavigationState,
  NavigationTool,
  PreparedSlide,
  SlideUnderstanding,
  SlideWindowAnalysis,
  SlideRules,
} from '../shared/contracts'

interface FunctionCall {
  name: string
  arguments: string
}

export class OpenAIRequestError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
    this.name = 'OpenAIRequestError'
  }
}

function readFunctionCall(value: unknown, acceptedNames: readonly string[]): FunctionCall | null {
  if (!value || typeof value !== 'object')
    return null

  const response = value as { output?: unknown[] }
  for (const item of response.output ?? []) {
    if (!item || typeof item !== 'object')
      continue

    const call = item as Record<string, unknown>
    if (call.type === 'function_call'
      && typeof call.name === 'string'
      && acceptedNames.includes(call.name)) {
      return {
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : '{}',
      }
    }
  }
  return null
}

async function requestOpenAI(
  apiKey: string,
  body: unknown,
  fetcher: typeof fetch,
  timeoutMs: number,
) {
  let response: Response
  let raw: string
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), timeoutMs)
  try {
    response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    })
    raw = await response.text()
  }
  catch (error) {
    if (abort.signal.aborted)
      throw new OpenAIRequestError('OpenAI request timed out', 504)
    const message = error instanceof Error ? error.message : 'Could not reach OpenAI'
    throw new OpenAIRequestError(message)
  }
  finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: unknown } }
      if (typeof parsed.error?.message === 'string')
        detail = `: ${parsed.error.message}`
    }
    catch {
      // Avoid returning a large or unexpected upstream body.
    }
    throw new OpenAIRequestError(`OpenAI request failed (${response.status})${detail}`, response.status)
  }

  try {
    return JSON.parse(raw) as unknown
  }
  catch {
    throw new OpenAIRequestError('OpenAI returned invalid JSON')
  }
}

function parseUnderstanding(value: unknown): SlideUnderstanding | null {
  if (!value || typeof value !== 'object')
    return null

  const slide = value as Record<string, unknown>
  if (!Number.isInteger(slide.number)
    || typeof slide.visual_description !== 'string'
    || typeof slide.speaking_goal !== 'string'
    || !Array.isArray(slide.transition_cues)
    || !slide.transition_cues.every(cue => typeof cue === 'string')
    || typeof slide.dwell !== 'boolean')
    return null

  return {
    number: slide.number as number,
    visualDescription: slide.visual_description,
    speakingGoal: slide.speaking_goal,
    transitionCues: slide.transition_cues as string[],
    dwell: slide.dwell,
  }
}

export async function analyzeSlideWindow(
  apiKey: string,
  preparedSlides: PreparedSlide[],
  model: string,
  fetcher: typeof fetch = fetch,
  fastMode = true,
): Promise<SlideWindowAnalysis> {
  const response = await requestOpenAI(
    apiKey,
    buildWindowAnalysisRequest(preparedSlides, model, fastMode),
    fetcher,
    45_000,
  )
  const call = readFunctionCall(response, [ANALYSIS_TOOL])
  if (!call)
    throw new OpenAIRequestError('OpenAI did not return a slide-window analysis')

  let values: unknown
  try {
    values = (JSON.parse(call.arguments) as { slides?: unknown }).slides
  }
  catch {
    throw new OpenAIRequestError('OpenAI returned an invalid slide-window analysis')
  }

  if (!Array.isArray(values))
    throw new OpenAIRequestError('OpenAI returned an invalid slide-window analysis')

  const understood = values.map(parseUnderstanding)
  const expectedNumbers = preparedSlides.map(slide => slide.number)
  if (understood.some(slide => !slide)
    || understood.length !== preparedSlides.length
    || understood.some((slide, index) => slide?.number !== expectedNumbers[index])) {
    throw new OpenAIRequestError('OpenAI returned the wrong slides in its window analysis')
  }

  return {
    start: expectedNumbers[0]!,
    end: expectedNumbers.at(-1)!,
    slides: understood as SlideUnderstanding[],
  }
}

const navigationToolNames: readonly NavigationTool[] = ['next_slide', 'previous_slide', 'hold_slide', 'reveal_next']

export async function requestNavigationDecision(
  apiKey: string,
  state: NavigationState,
  transcript: string,
  preparedSlides: PreparedSlide[],
  analysis: SlideWindowAnalysis,
  settings: AddonSettings,
  model: string,
  fetcher: typeof fetch = fetch,
  rules: SlideRules = { hold: false, reveals: settings.reveals ?? 'manual' },
  slideTranscript = transcript,
): Promise<NavigationDecision> {
  const response = await requestOpenAI(
    apiKey,
    buildNavigationRequest(state, transcript, preparedSlides, analysis, settings, model, rules, slideTranscript),
    fetcher,
    8_000,
  )
  const call = readFunctionCall(response, navigationToolNames)
  if (!call)
    throw new OpenAIRequestError('OpenAI did not choose a navigation action')

  let args: { reason?: unknown }
  try { args = JSON.parse(call.arguments) }
  catch { throw new OpenAIRequestError('OpenAI returned invalid navigation details') }
  const reason = typeof args?.reason === 'string' ? args.reason.trim().slice(0, 180) : undefined
  return constrainDecision({ tool: call.name as NavigationTool, ...(reason ? { reason } : {}) }, state, rules)
}
