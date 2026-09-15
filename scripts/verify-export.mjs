import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const result = spawnSync(process.execPath, ['bin/slidev-speech-navigation.mjs', 'example/slides.md'], { stdio: 'inherit' })
assert.equal(result.status, 0, 'Example image export must succeed')
const manifest = JSON.parse(await readFile('example/.slidev-speech-navigation/manifest.json', 'utf8'))
const frames = await Promise.all(['02.png', '02-1.png', '02-2.png', '02-3.png'].map(file => readFile(`example/.slidev-speech-navigation/${manifest.imageDirectory ?? 'slides'}/${file}`)))
const hashes = frames.map(frame => createHash('sha256').update(frame).digest('hex'))
assert.equal(new Set(hashes).size, 4, 'Each of the three example reveals must have a distinct image')
console.log('Verified initial view and all three reveal images')
