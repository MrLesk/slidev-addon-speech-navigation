import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SlideInfo } from '@slidev/types'
import type { PreparedSlide } from '../shared/contracts'
import type { SlideWindow } from '../core/window'

const ASSET_DIRECTORY = '.slidev-speech-navigation'

interface AssetManifest {
  version?: number
  images?: string[]
  imageDirectory?: string
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

function getImageRoot(userRoot: string, manifest: AssetManifest | null) {
  return resolve(getAssetRoot(userRoot), manifest?.imageDirectory ?? 'slides')
}

function getImageCandidates(imageRoot: string, slideNumber: number) {
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
    if (value.imageDirectory !== undefined
      && (typeof value.imageDirectory !== 'string' || !/^generation-[a-f0-9-]+$/.test(value.imageDirectory)))
      return null
    return value as AssetManifest
  }
  catch {
    return null
  }
}

async function findImagePath(imageRoot: string, slideNumber: number) {
  for (const candidate of getImageCandidates(imageRoot, slideNumber)) {
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
      message: 'Slide images are not ready yet. They are prepared automatically when Slidev starts.',
    }
  }

  if (manifest.version !== 2 || !Array.isArray(manifest.images)
    || !manifest.images.every(file => typeof file === 'string' && /^\d+(?:-\d+)?\.png$/.test(file)))
    return { state: 'stale', message: 'Preparing images for each reveal step…' }

  const imageRoot = getImageRoot(userRoot, manifest)
  for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) {
    if (!await findImagePath(imageRoot, slideNumber)) {
      return {
        state: 'missing',
        message: `Prepared image for slide ${slideNumber} is missing. Rebuilding the images automatically.`,
      }
    }
  }

  for (const file of manifest.images) {
    try { await stat(resolve(imageRoot, file)) }
    catch { return { state: 'missing', message: 'A reveal image is missing. Rebuilding the images automatically.' } }
  }

  let sourceMtimeMs = 0
  try {
    sourceMtimeMs = (await stat(entry)).mtimeMs
  }
  catch {
    return {
      state: 'stale',
      message: 'The active slide deck could not be found.',
    }
  }

  if (resolve(manifest.entry) !== resolve(entry)
    || manifest.slideCount !== slideCount
    || sourceMtimeMs > manifest.sourceMtimeMs + 1) {
    return {
      state: 'stale',
      message: 'Slides changed after their images were prepared. They will be refreshed automatically.',
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
  const imageRoot = getImageRoot(userRoot, await readManifest(userRoot))
  const files = await readdir(imageRoot)

  for (const number of window.numbers) {
    const source = slides[number - 1]
    const imagePath = await findImagePath(imageRoot, number)
    if (!source || !imagePath)
      throw new Error(`Prepared image for slide ${number} is missing`)

    const start = Number.isInteger(source.frontmatter?.clicksStart) ? source.frontmatter.clicksStart as number : 0
    const candidates = files.flatMap((file) => {
      const match = /^(\d+)-(\d+)\.png$/.exec(file)
      return match && Number(match[1]) === number ? [{ click: Number(match[2]), file }] : []
    }).filter(step => step.click > start).sort((a, b) => a.click - b.click)
    const steps = [{ click: start, imageDataUrl: `data:image/png;base64,${(await readFile(imagePath)).toString('base64')}` }]
    for (const step of candidates) {
      steps.push({ click: step.click, imageDataUrl: `data:image/png;base64,${(await readFile(resolve(imageRoot, step.file))).toString('base64')}` })
    }
    prepared.push({
      number,
      title: source.title?.trim() || `Slide ${number}`,
      notes: source.note?.trim() || '',
      revision: source.revision,
      imageDataUrl: steps.at(-1)!.imageDataUrl,
      steps,
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
