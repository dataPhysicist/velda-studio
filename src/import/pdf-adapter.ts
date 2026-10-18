// Browser side of the plan import: open a PDF with pdf.js on its own inline worker, read every page
// into PageData, draw small thumbnails for the page strip, and hand the plan picture to the trace
// worker. Heavy work (decoding the 29 MP plan, tracing) never runs on the main thread.
import type { Gray, ImagePaint, PageData } from './types'
import { findImageStreams, jpegFor } from './pdf-images'
import { readPage } from './pdf-read'
import type { TraceResult } from './raster/trace'

type PdfJs = typeof import('pdfjs-dist')
let lib: Promise<PdfJs> | null = null

/** pdf.js with its worker inlined in the bundle (the Toolbelt iframe cannot load a worker URL). */
export function pdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    const mod = await import('pdfjs-dist')
    const { default: PdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')
    mod.GlobalWorkerOptions.workerPort = new PdfWorker()
    return mod
  })()
  return lib
}

export type PdfRead = {
  name: string
  bytes: Uint8Array
  pages: PageData[]
  thumbs: string[] // data URLs, about 240 px wide
  pdfjsVersion: string
}

/**
 * Read every page. pdf.js is told to skip images over 4 MP: decoding a 29 MP plan in its JavaScript
 * decoder takes a minute or more on a laptop, and we decode the plan ourselves (natively, in the trace
 * worker). The skipped image's placement still shows in the operator list; its size comes from the file.
 */
export async function readPdf(name: string, bytes: Uint8Array, progress?: (done: number, total: number) => void): Promise<PdfRead> {
  const lib = await pdfjs()
  const task = lib.getDocument({ data: bytes.slice(), maxImageSize: 4_000_000, stopAtErrors: false })
  const doc = await task.promise
  const pages: PageData[] = []
  const thumbs: string[] = []
  const streams = findImageStreams(bytes)
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const data = await readPage(page as never, lib.OPS as Record<string, number>)
      for (const im of data.images) if (!im.px[0]) im.px = sizeFromFile(im, streams)
      pages.push(data)
      thumbs.push(await thumbnail(page, data, bytes, streams))
      progress?.(p, doc.numPages)
      await new Promise((r) => setTimeout(r)) // let the page breathe between pages
    }
  } finally {
    await task.destroy()
  }
  return { name, bytes, pages, thumbs, pdfjsVersion: lib.version }
}

/** Pixel size of a placed image whose paint pdf.js skipped: the file's image of the same shape. */
function sizeFromFile(im: ImagePaint, streams: ReturnType<typeof findImageStreams>): [number, number] {
  const aspect = (im.rect[2] - im.rect[0]) / (im.rect[3] - im.rect[1])
  const fits = streams
    .filter((s) => s.width > 0 && s.height > 0 && Math.abs(s.width / s.height / aspect - 1) < 0.01)
    .sort((p, q) => Number(q.filter === 'DCTDecode') - Number(p.filter === 'DCTDecode') || q.width * q.height - p.width * p.height)
  return fits[0] ? [fits[0].width, fits[0].height] : [0, 0]
}

async function thumbnail(
  page: { getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> } },
  data: PageData,
  bytes: Uint8Array,
  streams: ReturnType<typeof findImageStreams>,
): Promise<string> {
  const vp1 = page.getViewport({ scale: 1 })
  const scale = 240 / vp1.width
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(vp.width)
  canvas.height = Math.ceil(vp.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // the big plan picture first (pdf.js skipped it), then the vector annotations over it
  for (const im of data.images.filter((x) => !x.mask && x.id.startsWith('placed_'))) {
    const jpg = jpegFor(bytes, im.px, streams)
    if (!jpg) continue
    const [x0, y0, x1, y1] = im.rect
    const bmp = await createImageBitmap(new Blob([jpg.slice()], { type: 'image/jpeg' }), { resizeWidth: Math.max(1, Math.round((x1 - x0) * scale)), resizeQuality: 'medium' })
    ctx.drawImage(bmp, x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale)
    bmp.close()
  }
  await page.render({ canvasContext: ctx, viewport: vp, canvas, background: 'rgba(0,0,0,0)' } as never).promise
  return canvas.toDataURL('image/jpeg', 0.75)
}

/** The plan picture's own bytes when the PDF stores it as a JPEG (the usual case for raster plans). */
export function planJpeg(read: PdfRead, plan: ImagePaint): Uint8Array | null {
  return jpegFor(read.bytes, plan.px, findImageStreams(read.bytes))
}

/**
 * Fallback for plans not stored as JPEG: render just the picture's rectangle at its own resolution
 * (at most 300 ppi), never the whole sheet.
 */
export async function renderPlanRect(read: PdfRead, pageNo: number, plan: ImagePaint): Promise<Gray> {
  const lib = await pdfjs()
  const task = lib.getDocument({ data: read.bytes.slice() })
  const doc = await task.promise
  try {
    const page = await doc.getPage(pageNo)
    const [x0, y0, x1, y1] = plan.rect
    const ppi = Math.min(300, (plan.px[0] / (x1 - x0)) * 72)
    const scale = ppi / 72
    const vp = page.getViewport({ scale, offsetX: -x0 * scale, offsetY: -y0 * scale })
    const w = Math.round((x1 - x0) * scale)
    const h = Math.round((y1 - y0) * scale)
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    await page.render({ canvasContext: ctx, viewport: vp, canvas } as never).promise
    const rgba = ctx.getImageData(0, 0, w, h).data
    const data = new Uint8Array(w * h)
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000
    return { width: w, height: h, data }
  } finally {
    await task.destroy()
  }
}

export type TraceProgress = { stage: string; ms?: number }

/** Decode and trace the plan in a worker. */
export async function traceInWorker(
  input: { jpeg: Uint8Array } | { gray: Gray },
  pxPerInch: { x: number; y: number },
  progress?: (p: TraceProgress) => void,
): Promise<TraceResult & { decodeMs: number }> {
  const { default: TraceWorker } = await import('./raster/trace.worker?worker&inline')
  const worker: Worker = new TraceWorker()
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.type === 'progress') progress?.(m)
        else if (m.type === 'done') resolve(m.result)
        else if (m.type === 'error') reject(new Error(m.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || 'the trace worker stopped'))
      if ('jpeg' in input) {
        const buf = input.jpeg.slice().buffer
        worker.postMessage({ jpeg: buf, pxPerInch }, [buf])
      } else {
        const buf = input.gray.data.slice().buffer
        worker.postMessage({ gray: { width: input.gray.width, height: input.gray.height, data: buf }, pxPerInch }, [buf])
      }
    })
  } finally {
    worker.terminate()
  }
}
