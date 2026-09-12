#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

function printHelp() {
  console.log(`Slidev Speech Navigation

Usage:
  slidev-speech-navigation prepare [slides.md]

The prepare command renders the deck as PNG images with Slidev. Run it again
after changing slide content, theme styles, components, or visual assets.`)
}

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

async function run(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0)
        resolvePromise()
      else
        reject(new Error(signal ? `Slidev export stopped with ${signal}` : `Slidev export failed with exit code ${code}`))
    })
  })
}

async function prepare(entryArgument) {
  const entry = resolve(process.cwd(), entryArgument || 'slides.md')
  const userRoot = dirname(entry)
  const generatedRoot = resolve(userRoot, '.slidev-speech-navigation')
  const imageRoot = resolve(generatedRoot, 'slides')
  const slidev = resolveSlidev(userRoot)

  await stat(entry).catch(() => {
    throw new Error(`Slide deck not found: ${entry}`)
  })

  await rm(imageRoot, { recursive: true, force: true })
  await mkdir(generatedRoot, { recursive: true })

  console.log(`Preparing slide images from ${basename(entry)}…`)
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
  })

  const images = (await readdir(imageRoot)).filter(file => /^\d+\.png$/.test(file))
  if (images.length === 0)
    throw new Error('Slidev finished without creating PNG images')

  const source = await stat(entry)
  await writeFile(resolve(generatedRoot, 'manifest.json'), `${JSON.stringify({
    entry,
    sourceMtimeMs: source.mtimeMs,
    slideCount: images.length,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`)

  console.log(`Prepared ${images.length} slide images in ${imageRoot}`)
}

const [command, entry] = process.argv.slice(2)

if (!command || command === '--help' || command === '-h') {
  printHelp()
  process.exit(0)
}

if (command !== 'prepare') {
  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exit(1)
}

try {
  await prepare(entry)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error('\nIf Chromium is missing, install it with: npm install -D playwright-chromium')
  process.exit(1)
}
