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
