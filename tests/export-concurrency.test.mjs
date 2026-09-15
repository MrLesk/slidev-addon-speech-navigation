import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { acquirePreparationLock, publishImages } from '../bin/prepare-files.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'speech-export-race-'))
  roots.push(root)
  return root
}
const command = fileURLToPath(new URL('../bin/slidev-speech-navigation.mjs', import.meta.url))
function run(root) {
  const child = spawn(process.execPath, [command, 'slides.md'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => output += chunk)
  child.stderr.on('data', chunk => output += chunk)
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(output)))
  })
}

it('shares one completed export between concurrent processes and publishes a complete generation', async () => {
  const root = await fixture()
  await writeFile(resolve(root, 'package.json'), '{}')
  await writeFile(resolve(root, 'slides.md'), '# One\n---\n# Two')
  const cli = resolve(root, 'node_modules/@slidev/cli/bin')
  await mkdir(cli, { recursive: true })
  await writeFile(resolve(cli, 'slidev.mjs'), `
    import { appendFile, mkdir, writeFile } from 'node:fs/promises';
    import { resolve } from 'node:path';
    await appendFile('export-runs', 'run\\n');
    await new Promise(r => setTimeout(r, 400));
    const output = process.argv[process.argv.indexOf('--output') + 1];
    await mkdir(output, { recursive: true });
    for (const name of ['1-1.png', '2-1.png', '2-2.png']) await writeFile(resolve(output, name), name);
  `)
  const outputs = await Promise.all([run(root), run(root)])
  expect(await readFile(resolve(root, 'export-runs'), 'utf8')).toBe('run\n')
  expect(outputs.some(output => output.includes('Reused 2 slide images'))).toBe(true)
  const generated = resolve(root, '.slidev-speech-navigation')
  const manifest = JSON.parse(await readFile(resolve(generated, 'manifest.json'), 'utf8'))
  expect(manifest.slideCount).toBe(2)
  expect(manifest.imageDirectory).toMatch(/^generation-/)
  expect((await readdir(resolve(generated, manifest.imageDirectory))).sort()).toEqual(['01.png', '02-1.png', '02.png'])
  expect((await readdir(generated)).some(name => name.startsWith('.capture-') || name === 'preparation.lock')).toBe(false)
})

it('keeps published images readable while a replacement is being prepared', async () => {
  const root = await fixture()
  const old = resolve(root, 'old-capture')
  await mkdir(old)
  await writeFile(resolve(old, '01.png'), 'old')
  await publishImages(root, old, { images: ['01.png'], generatedAt: 'old' })
  const previous = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  const next = resolve(root, 'new-capture')
  await mkdir(next)
  await writeFile(resolve(next, '01.png'), 'new')
  expect(JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))).toEqual(previous)
  await publishImages(root, next, { images: ['01.png'], generatedAt: 'new' })
  const current = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  expect(await readFile(resolve(root, previous.imageDirectory, '01.png'), 'utf8')).toBe('old')
  expect(await readFile(resolve(root, current.imageDirectory, '01.png'), 'utf8')).toBe('new')
})

it('releases the cross-process lock for later preparations', async () => {
  const root = await fixture()
  const first = await acquirePreparationLock(root)
  let acquired = false
  const waiting = acquirePreparationLock(root).then(release => { acquired = true; return release })
  await new Promise(r => setTimeout(r, 20))
  expect(acquired).toBe(false)
  await first()
  const second = await waiting
  expect(acquired).toBe(true)
  await second()
})
