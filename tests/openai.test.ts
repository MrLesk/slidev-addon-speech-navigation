import { describe, expect, it, vi } from 'vitest'
import { analyzeSlideWindow, requestNavigationDecision } from '../src/server/openai'
import type { PreparedSlide } from '../src/shared/contracts'

const prepared: PreparedSlide[] = [{
  number: 1,
  title: 'One',
  notes: 'Say hello.',
  revision: 'r1',
  imageDataUrl: 'data:image/png;base64,AAAA',
}]

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OpenAI response handling', () => {
  it('validates slide analysis tool output', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      output: [{
        type: 'function_call',
        name: 'save_slide_window',
        call_id: 'analysis-1',
        arguments: JSON.stringify({
          slides: [{
            number: 1,
            visual_description: 'A title slide.',
            speaking_goal: 'Welcome the audience.',
            transition_cues: ['welcome is complete'],
            dwell: false,
          }],
        }),
      }],
    })) as unknown as typeof fetch

    await expect(analyzeSlideWindow('test-key', prepared, 'test-model', fetcher)).resolves.toEqual({
      start: 1,
      end: 1,
      slides: [{
        number: 1,
        visualDescription: 'A title slide.',
        speakingGoal: 'Welcome the audience.',
        transitionCues: ['welcome is complete'],
        dwell: false,
      }],
    })
  })

  it('returns exactly one navigation tool', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      output: [{
        type: 'function_call',
        name: 'next_slide',
        call_id: 'move-1',
        arguments: '{}',
      }],
    })) as unknown as typeof fetch

    await expect(requestNavigationDecision(
      'test-key',
      { currentSlide: 1, totalSlides: 2 },
      'Welcome everyone.',
      prepared,
      {
        start: 1,
        end: 1,
        slides: [{
          number: 1,
          visualDescription: 'A title slide.',
          speakingGoal: 'Welcome the audience.',
          transitionCues: [],
          dwell: false,
        }],
      },
      { behavior: 'balanced' },
      'test-model',
      fetcher,
    )).resolves.toEqual({ tool: 'next_slide' })
  })

  it('does not accept slides in the wrong order', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      output: [{
        type: 'function_call',
        name: 'save_slide_window',
        arguments: JSON.stringify({
          slides: [{
            number: 2,
            visual_description: 'Wrong slide.',
            speaking_goal: 'Wrong goal.',
            transition_cues: [],
            dwell: false,
          }],
        }),
      }],
    })) as unknown as typeof fetch

    await expect(analyzeSlideWindow('test-key', prepared, 'test-model', fetcher))
      .rejects.toThrow('wrong slides')
  })
})
