#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

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
  const imageRoot = resolve(generatedRoot, 'slides')
  const slidev = resolveSlidev(userRoot)
  const automatic = process.env.SLIDEV_SPEECH_NAVIGATION_AUTO === '1'

  const sourceBeforeExport = await stat(entry).catch(() => {
    throw new Error(`Slide deck not found: ${entry}`)
  })

  await rm(imageRoot, { recursive: true, force: true })
  await mkdir(generatedRoot, { recursive: true })

  console.log(`${automatic ? '[speech-navigation] ' : ''}Preparing slide images from ${basename(entry)}…`)
  await run(process.execPath, [
    slidev,
    'export',
    basename(entry),
    '--format',
    'png',
    '--output',
    imageRoot,
    '--per-slide',
  ], {
    cwd: userRoot,
    env: {
      ...process.env,
      SLIDEV_SPEECH_NAVIGATION_EXPORT: '1',
    },
  }, automatic)

  const images = (await readdir(imageRoot)).filter(file => /^\d+\.png$/.test(file))
  if (images.length === 0)
    throw new Error('Slidev finished without creating PNG images')

  const sourceAfterExport = await stat(entry)
  if (sourceAfterExport.mtimeMs > sourceBeforeExport.mtimeMs + 1)
    throw new Error('The slide deck changed during image capture.')
  await writeFile(resolve(generatedRoot, 'manifest.json'), `${JSON.stringify({
    entry,
    sourceMtimeMs: sourceAfterExport.mtimeMs,
    slideCount: images.length,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`)

  console.log(automatic
    ? `[speech-navigation] Prepared ${images.length} slide images`
    : `Prepared ${images.length} slide images in ${imageRoot}`)
}

const [entry] = process.argv.slice(2)

try {
  await prepare(entry)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
