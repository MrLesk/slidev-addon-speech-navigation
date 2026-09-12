import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getWindowCacheKey, inspectAssets } from '../src/server/slides'
import { getSlideWindow } from '../src/core/window'
import type { SlideInfo } from '@slidev/types'

const temporaryRoots: string[] = []

async function createPreparedDeck(slideCount = 3) {
  const root = await mkdtemp(resolve(tmpdir(), 'slidev-speech-navigation-'))
  temporaryRoots.push(root)
  const entry = resolve(root, 'slides.md')
  const generated = resolve(root, '.slidev-speech-navigation')
  const images = resolve(generated, 'slides')
  await mkdir(images, { recursive: true })
  await writeFile(entry, '# Test deck\n')
  for (let number = 1; number <= slideCount; number += 1)
    await writeFile(resolve(images, `${String(number).padStart(2, '0')}.png`), 'png')
  const source = await stat(entry)
  await writeFile(resolve(generated, 'manifest.json'), JSON.stringify({
    entry,
    sourceMtimeMs: source.mtimeMs,
    slideCount,
    generatedAt: '2026-09-12T12:00:00.000Z',
  }))
  return { root, entry, images }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('prepared slide assets', () => {
  it('accepts a complete matching export', async () => {
    const deck = await createPreparedDeck()
    await expect(inspectAssets(deck.root, deck.entry, 3)).resolves.toMatchObject({ state: 'ready' })
  })

  it('reports a missing image in the middle', async () => {
    const deck = await createPreparedDeck()
    await rm(resolve(deck.images, '02.png'))
    await expect(inspectAssets(deck.root, deck.entry, 3)).resolves.toMatchObject({
      state: 'missing',
      message: expect.stringContaining('slide 2'),
    })
  })

  it('rejects images prepared for a different deck', async () => {
    const deck = await createPreparedDeck()
    await expect(inspectAssets(deck.root, resolve(deck.root, 'other.md'), 3)).resolves.toMatchObject({
      state: 'stale',
    })
  })

  it('includes the image generation in the learned-window cache key', () => {
    const slides = [{ revision: 'same' }] as SlideInfo[]
    const window = getSlideWindow(1, 1)
    expect(getWindowCacheKey(slides, window, 'first'))
      .not.toBe(getWindowCacheKey(slides, window, 'second'))
  })
})
