#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { acquirePreparationLock, completedSince, publishImages } from './prepare-files.mjs'

function resolveSlidev(cwd) {
  const resolvers = [
    createRequire(resolve(cwd, 'package.json')),
    createRequire(import.meta.url),
  ]
  for (const resolver of resolvers) {
    try {
      return resolver.resolve('@slidev/cli/bin/slidev.mjs')
    }
    catch {
      // Try resolving from the installed addon next.
    }
  }
  throw new Error('Slidev is not installed. Add @slidev/cli to this presentation first.')
}

async function run(command, args, options, quiet = false) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    let output = ''
    const rememberOutput = (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-12_000)
    }
    child.stdout?.on('data', rememberOutput)
    child.stderr?.on('data', rememberOutput)
    let forceStop
    const stopChild = (signal) => {
      child.kill(signal)
      forceStop ??= setTimeout(() => child.kill('SIGKILL'), 4_000)
    }
    const stopForInterrupt = () => stopChild('SIGINT')
    const stopForTermination = () => stopChild('SIGTERM')
    const cleanup = () => {
      if (forceStop)
        clearTimeout(forceStop)
      process.off('SIGINT', stopForInterrupt)
      process.off('SIGTERM', stopForTermination)
    }
    process.once('SIGINT', stopForInterrupt)
    process.once('SIGTERM', stopForTermination)
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      if (code === 0)
        resolvePromise()
      else {
        const reason = signal ? `Slidev export stopped with ${signal}` : `Slidev export failed with exit code ${code}`
        reject(new Error(output.trim() ? `${reason}\n${output.trim()}` : reason))
      }
    })
  })
}

async function prepare(entryArgument) {
  const entry = resolve(process.cwd(), entryArgument || 'slides.md')
  const userRoot = dirname(entry)
  const generatedRoot = resolve(userRoot, '.slidev-speech-navigation')
  const requestedAt = Date.now()
  const release = await acquirePreparationLock(generatedRoot)
  let captureRoot
  try {
    const slidev = resolveSlidev(userRoot)
    const automatic = process.env.SLIDEV_SPEECH_NAVIGATION_AUTO === '1'

    const sourceBeforeExport = await stat(entry).catch(() => {
      throw new Error(`Slide deck not found: ${entry}`)
    })

    const completed = await completedSince(generatedRoot, entry, requestedAt, sourceBeforeExport.mtimeMs)
    if (completed) {
      console.log(`[speech-navigation] Reused ${completed.slideCount} slide images from the completed export`)
      return
    }
    captureRoot = await mkdtemp(resolve(generatedRoot, '.capture-'))
    const imageRoot = resolve(captureRoot, 'slides')

    console.log(`${automatic ? '[speech-navigation] ' : ''}Preparing slide images from ${basename(entry)}…`)
    await run(process.execPath, [
      slidev,
      'export',
      basename(entry),
      '--format',
      'png',
      '--output',
      imageRoot,
      '--with-clicks',
      '--wait',
      '350',
    ], {
      cwd: userRoot,
      env: {
        ...process.env,
        SLIDEV_SPEECH_NAVIGATION_EXPORT: '1',
        SLIDEV_SPEECH_NAVIGATION_EXPORT_CACHE: resolve(captureRoot, 'vite'),
      },
    }, automatic)

    // Slidev's print exporter emits <slide>-<click + 1>.png.
    // Use the print exporter because keyboard shortcuts are disabled in per-slide print mode.
    const exported = (await readdir(imageRoot)).flatMap(file => {
      const match = /^(\d+)-(\d+)\.png$/.exec(file)
      return match ? [{ file, slide: Number(match[1]), click: Number(match[2]) - 1 }] : []
    })
    const starts = new Map()
    for (const frame of exported)
      starts.set(frame.slide, Math.min(starts.get(frame.slide) ?? Infinity, frame.click))
    const normalized = []
    for (const frame of exported) {
      const prefix = String(frame.slide).padStart(2, '0')
      const name = `${prefix}${frame.click === starts.get(frame.slide) ? '' : `-${frame.click}`}.png`
      await rename(resolve(imageRoot, frame.file), resolve(imageRoot, `prepared-${name}`))
      normalized.push(name)
    }
    // Avoid collisions between raw frame IDs and normalized names in long decks.
    for (const name of normalized)
      await rename(resolve(imageRoot, `prepared-${name}`), resolve(imageRoot, name))
    const frames = (await readdir(imageRoot)).filter(file => /^\d+(?:-\d+)?\.png$/.test(file))
    const images = frames.filter(file => /^\d+\.png$/.test(file))
    if (images.length === 0)
      throw new Error('Slidev finished without creating PNG images')

    const sourceAfterExport = await stat(entry)
    if (sourceAfterExport.mtimeMs > sourceBeforeExport.mtimeMs + 1)
      throw new Error('The slide deck changed during image capture.')
    await publishImages(generatedRoot, imageRoot, {
      version: 2,
      entry,
      sourceMtimeMs: sourceAfterExport.mtimeMs,
      slideCount: images.length,
      images: frames,
      generatedAt: new Date().toISOString(),
    })

    console.log(automatic
      ? `[speech-navigation] Prepared ${images.length} slide images`
      : `Prepared ${images.length} slide images in ${generatedRoot}`)
  }
  finally {
    try {
      if (captureRoot) await rm(captureRoot, { recursive: true, force: true })
    }
    finally {
      await release()
    }
  }
}

const [entry] = process.argv.slice(2)

try {
  await prepare(entry)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
