import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SlideInfo } from '@slidev/types'
import type { PreparedSlide } from '../shared/contracts'
import type { SlideWindow } from '../core/window'

const ASSET_DIRECTORY = '.slidev-speech-navigation'

interface AssetManifest {
  entry: string
  sourceMtimeMs: number
  slideCount: number
  generatedAt: string
}

export interface AssetStatus {
  state: 'ready' | 'missing' | 'stale'
  message: string
}

function getAssetRoot(userRoot: string) {
  return resolve(userRoot, ASSET_DIRECTORY)
}

function getImageCandidates(userRoot: string, slideNumber: number) {
  const imageRoot = resolve(getAssetRoot(userRoot), 'slides')
  return [
    resolve(imageRoot, `${String(slideNumber).padStart(2, '0')}.png`),
    resolve(imageRoot, `${slideNumber}.png`),
  ]
}

async function readManifest(userRoot: string) {
  try {
    const raw = await readFile(resolve(getAssetRoot(userRoot), 'manifest.json'), 'utf8')
    const value = JSON.parse(raw) as Partial<AssetManifest>
    if (typeof value.entry !== 'string'
      || typeof value.sourceMtimeMs !== 'number'
      || typeof value.slideCount !== 'number'
      || typeof value.generatedAt !== 'string')
      return null
    return value as AssetManifest
  }
  catch {
    return null
  }
}

async function findImagePath(userRoot: string, slideNumber: number) {
  for (const candidate of getImageCandidates(userRoot, slideNumber)) {
    try {
      await stat(candidate)
      return candidate
    }
    catch {
      // Try the next filename style.
    }
  }
  return null
}

export async function inspectAssets(userRoot: string, entry: string, slideCount: number): Promise<AssetStatus> {
  const manifest = await readManifest(userRoot)
  if (!manifest) {
    return {
      state: 'missing',
      message: 'Prepare slide images with: npx slidev-speech-navigation prepare',
    }
  }

  for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) {
    if (!await findImagePath(userRoot, slideNumber)) {
      return {
        state: 'missing',
        message: `Prepared image for slide ${slideNumber} is missing. Run: npx slidev-speech-navigation prepare`,
      }
    }
  }

  let sourceMtimeMs = 0
  try {
    sourceMtimeMs = (await stat(entry)).mtimeMs
  }
  catch {
    return {
      state: 'stale',
      message: 'The prepared images belong to a missing slide deck. Run: npx slidev-speech-navigation prepare',
    }
  }

  if (resolve(manifest.entry) !== resolve(entry)
    || manifest.slideCount !== slideCount
    || sourceMtimeMs > manifest.sourceMtimeMs + 1) {
    return {
      state: 'stale',
      message: 'Slides changed after the images were prepared. Run: npx slidev-speech-navigation prepare',
    }
  }

  return {
    state: 'ready',
    message: `Ready with ${slideCount} prepared slides`,
  }
}

export async function getAssetGeneration(userRoot: string) {
  return (await readManifest(userRoot))?.generatedAt ?? 'missing'
}

export async function loadPreparedSlides(
  userRoot: string,
  slides: SlideInfo[],
  window: SlideWindow,
): Promise<PreparedSlide[]> {
  const prepared: PreparedSlide[] = []

  for (const number of window.numbers) {
    const source = slides[number - 1]
    const imagePath = await findImagePath(userRoot, number)
    if (!source || !imagePath)
      throw new Error(`Prepared image for slide ${number} is missing. Run: npx slidev-speech-navigation prepare`)

    const image = await readFile(imagePath)
    prepared.push({
      number,
      title: source.title?.trim() || `Slide ${number}`,
      notes: source.note?.trim() || '',
      revision: source.revision,
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
    })
  }

  return prepared
}

export function getWindowCacheKey(slides: SlideInfo[], window: SlideWindow, assetGeneration: string) {
  const revisions = window.numbers
    .map(number => `${number}:${slides[number - 1]?.revision ?? 'missing'}`)
    .join('|')
  return `${assetGeneration}|${revisions}`
}
