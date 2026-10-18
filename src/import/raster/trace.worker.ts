// The trace worker: decodes the plan picture (a 5063 x 5760 JPEG on A2) to gray in strips, so the
// peak memory stays near one strip plus the gray buffer, then runs the wall trace.
import type { Gray } from '../types'
import { traceWalls } from './trace'

const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

async function decode(jpeg: ArrayBuffer): Promise<Gray> {
  const bmp = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
  const { width, height } = bmp
  const data = new Uint8Array(width * height)
  const strip = 512
  const canvas = new OffscreenCanvas(width, strip)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  for (let y = 0; y < height; y += strip) {
    const h = Math.min(strip, height - y)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, strip)
    ctx.drawImage(bmp, 0, y, width, h, 0, 0, width, h)
    const rgba = ctx.getImageData(0, 0, width, h).data
    const base = y * width
    for (let i = 0, j = 0; i < width * h; i++, j += 4) data[base + i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000
  }
  bmp.close()
  return { width, height, data }
}

self.onmessage = async (e: MessageEvent) => {
  try {
    const t0 = performance.now()
    const { jpeg, gray, pxPerInch } = e.data
    post({ type: 'progress', stage: 'Reading the plan picture' })
    const g: Gray = jpeg ? await decode(jpeg) : { width: gray.width, height: gray.height, data: new Uint8Array(gray.data) }
    const decodeMs = Math.round(performance.now() - t0)
    post({ type: 'progress', stage: 'Tracing walls, doors and windows', ms: decodeMs })
    const result = traceWalls(g, pxPerInch)
    post({ type: 'done', result: { ...result, decodeMs } })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
