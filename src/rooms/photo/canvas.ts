// Pictures in the browser: reading a phone photo the right way up, cutting it to a working size, and
// moving between files, pixels and small previews.
import { type Img, nearestSize } from './compose'

export type Prepared = { blob: Blob; w: number; h: number; ratio: string; thumb: string; img: Img }

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function bitmap(src: Blob | string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof src !== 'string') {
    try {
      // Phones store which way up the picture is; honor it.
      return await createImageBitmap(src, { imageOrientation: 'from-image' })
    } catch {
      src = URL.createObjectURL(src)
    }
  }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  try {
    await img.decode()
  } catch {
    throw new Error('this picture could not be opened. If it came from an iPhone as a HEIC file, send it as a JPEG (most phones do this when you pick "Most Compatible" or share it by message)')
  }
  return img
}

const sizeOf = (b: ImageBitmap | HTMLImageElement) => ('naturalWidth' in b ? [b.naturalWidth, b.naturalHeight] : [b.width, b.height])

/** A photo cut (from the middle) to the nearest working shape and size, with a small preview. */
export async function prepare(file: Blob): Promise<Prepared> {
  const bmp = await bitmap(file)
  const [sw, sh] = sizeOf(bmp)
  const size = nearestSize(sw, sh)
  const ar = size.w / size.h
  let cw = sw
  let ch = sh
  if (sw / sh > ar) cw = Math.round(sh * ar)
  else ch = Math.round(sw / ar)
  const c = canvas(size.w, size.h)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, size.w, size.h)
  const data = g.getImageData(0, 0, size.w, size.h)
  return { blob: await toJpeg(c, 0.9), w: size.w, h: size.h, ratio: size.ratio, thumb: thumbOf(c), img: { w: size.w, h: size.h, data: data.data } }
}

/** Pixels of a picture drawn at exactly w by h. */
export async function pixels(src: Blob | string, w: number, h: number): Promise<Img> {
  const bmp = await bitmap(src)
  const c = canvas(w, h)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, w, h)
  return { w, h, data: g.getImageData(0, 0, w, h).data }
}

function draw(img: Img) {
  const c = canvas(img.w, img.h)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0)
  return c
}

export function toJpeg(c: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('the picture could not be saved'))), 'image/jpeg', quality))
}

export const jpegOf = (img: Img, quality = 0.9) => toJpeg(draw(img), quality)

/** A picture resized to w by h, as a JPEG (for sending a crop to the model at a size it takes). */
export function jpegAt(img: Img, w: number, h: number, quality = 0.92): Promise<Blob> {
  const c = canvas(w, h)
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(draw(img), 0, 0, w, h)
  return toJpeg(c, quality)
}

export function thumbOf(c: HTMLCanvasElement, width = 280): string {
  const t = canvas(width, Math.round((width * c.height) / c.width))
  const g = t.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(c, 0, 0, t.width, t.height)
  return t.toDataURL('image/jpeg', 0.62)
}

export const thumbOfImg = (img: Img) => thumbOf(draw(img))
export const urlOf = (img: Img) => draw(img).toDataURL('image/jpeg', 0.9)
