import { describe, expect, it } from 'vitest'
import { buildNavigationRequest, buildWindowAnalysisRequest } from '../src/core/prompts'
import type { PreparedSlide, SlideWindowAnalysis } from '../src/shared/contracts'

const prepared: PreparedSlide[] = [
  {
    number: 1,
    title: 'Architecture',
    notes: 'Explain the arrows, then pause.',
    revision: 'one',
    imageDataUrl: 'data:image/png;base64,AAAA',
  },
  {
    number: 2,
    title: 'Safety',
    notes: 'The key stays local.',
    revision: 'two',
    imageDataUrl: 'data:image/png;base64,BBBB',
  },
]

const analysis: SlideWindowAnalysis = {
  start: 1,
  end: 2,
  slides: [
    {
      number: 1,
      visualDescription: 'A three-step arrow diagram.',
      speakingGoal: 'Explain the architecture.',
      transitionCues: ['all three steps are explained'],
      dwell: false,
    },
    {
      number: 2,
      visualDescription: 'A lock beside a server.',
      speakingGoal: 'Explain local key handling.',
      transitionCues: ['the server boundary is clear'],
      dwell: false,
    },
  ],
}

describe('OpenAI prompts', () => {
  it('pairs each note block directly with its image', () => {
    const request = buildWindowAnalysisRequest(prepared)
    const content = request.input[0]!.content
    expect(content[0]).toMatchObject({ type: 'input_text' })
    expect(content[1]).toEqual(expect.objectContaining({
      type: 'input_image',
      image_url: prepared[0]!.imageDataUrl,
    }))
    expect(content[2]).toMatchObject({ type: 'input_text' })
    expect(content[3]).toEqual(expect.objectContaining({
      type: 'input_image',
      image_url: prepared[1]!.imageDataUrl,
    }))
    expect((content[0] as { text: string }).text).toContain(prepared[0]!.notes)
  })

  it('uses learned visuals and original notes for navigation', () => {
    const request = buildNavigationRequest(
      { currentSlide: 1, totalSlides: 2 },
      'The arrows show the three parts.',
      prepared,
      analysis,
      { behavior: 'balanced' },
    )
    expect(request.instructions).toContain('A three-step arrow diagram.')
    expect(request.instructions).toContain('Explain the arrows, then pause.')
    expect(request.tool_choice).toBe('required')
  })
})

it('pairs current and next reveal images and prevents a whole-slide skip', () => {
  const slides = [{ ...prepared[0]!, steps: [
    { click: 0, imageDataUrl: 'initial' }, { click: 1, imageDataUrl: 'next' }, { click: 2, imageDataUrl: 'last' },
  ] }, prepared[1]!]
  const request = buildNavigationRequest({ currentSlide: 1, totalSlides: 2, currentClick: 0, totalClicks: 2 },
    'Here is the first input.', slides, analysis, { behavior: 'balanced', reveals: 'speech' })
  expect(request.tools.map(tool => tool.name)).toEqual(['reveal_next', 'hold_slide'])
  expect(request.input[0]!.content.filter(item => item.type === 'input_image')).toEqual([
    { type: 'input_image', image_url: 'initial', detail: 'high' },
    { type: 'input_image', image_url: 'next', detail: 'high' },
  ])
})

it('supplies whole-slide coverage separately from the current reveal and asks for completion-based advance', () => {
  const request = buildNavigationRequest({ currentSlide: 1, totalSlides: 2, currentClick: 2, totalClicks: 2 },
    'Last point.', prepared, analysis, { behavior: 'balanced', fastMode: true }, undefined, undefined, 'First point. Last point.')
  expect(request.input[0]!.content[0]).toMatchObject({ type: 'input_text', text: expect.stringContaining('First point. Last point.') })
  expect(request.instructions).toContain('reached a clear ending to the explanation')
  expect(request.instructions).toContain('Mentioning the main idea is not enough')
  expect(request.instructions).toContain('If the latest transcript ends mid-sentence or completion is uncertain, hold')
  expect(request.instructions).not.toContain('call next_slide immediately')
  expect(request.instructions).toContain('does not need to say next')
  expect(request.service_tier).toBe('fast')
  expect(request.tools.map(tool => tool.name)).toContain('next_slide')
})

it('uses API Fast mode for Responses analysis and keeps standard processing when unchecked', () => {
  expect(buildWindowAnalysisRequest(prepared, undefined, true).service_tier).toBe('fast')
  expect(buildWindowAnalysisRequest(prepared).service_tier).toBe('fast')
  expect(buildWindowAnalysisRequest(prepared, undefined, false).service_tier).toBe('default')
  const standard = buildNavigationRequest({ currentSlide: 1, totalSlides: 2 }, 'Done.', prepared, analysis, { behavior: 'balanced', fastMode: false })
  const fast = buildNavigationRequest({ currentSlide: 1, totalSlides: 2 }, 'Done.', prepared, analysis, { behavior: 'balanced', fastMode: true })
  expect(standard.service_tier).toBe('default')
  expect(fast.service_tier).toBe('fast')
  expect(fast.instructions).toBe(standard.instructions)
})
