import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function acquirePreparationLock(root) {
  await mkdir(root, { recursive: true })
  const lock = resolve(root, 'preparation.lock')
  const token = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + 300_000
  for (;;) {
    try {
      const file = await open(lock, 'wx')
      await file.writeFile(token)
      await file.close()
      return async () => {
        if (await readFile(lock, 'utf8').catch(() => '') === token)
          await rm(lock, { force: true })
      }
    }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = await readFile(lock, 'utf8').catch(() => '')
      const pid = Number(owner.split(':')[0])
      let stale = false
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0) }
        catch (error) { stale = error.code === 'ESRCH' }
      }
      else {
        const info = await stat(lock).catch(() => null)
        stale = Boolean(info && Date.now() - info.mtimeMs > 5_000)
      }
      if (stale && await readFile(lock, 'utf8').catch(() => '') === owner) {
        await rm(lock, { force: true })
        continue
      }
      if (Date.now() >= deadline) throw new Error('Another slide image export is still running. Try again when it finishes.')
      await delay(100)
    }
  }
}

export async function completedSince(root, entry, requestedAt, sourceMtimeMs) {
  try {
    const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
    if (manifest.entry === entry && manifest.sourceMtimeMs === sourceMtimeMs
      && Date.parse(manifest.generatedAt) >= requestedAt && manifest.imageDirectory) {
      await Promise.all(manifest.images.map(file => stat(resolve(root, manifest.imageDirectory, file))))
      return manifest
    }
  }
  catch { /* No completed export can be reused. */ }
  return null
}

/** Publish one complete generation by atomically replacing its manifest. */
export async function publishImages(root, images, manifest) {
  const id = randomUUID()
  const imageDirectory = `generation-${id}`
  await rename(images, resolve(root, imageDirectory))
  const temporaryManifest = resolve(root, `.manifest-${id}.json`)
  await writeFile(temporaryManifest, `${JSON.stringify({ ...manifest, imageDirectory }, null, 2)}\n`)
  await rename(temporaryManifest, resolve(root, 'manifest.json'))
}
