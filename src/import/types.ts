// Plain data passed between the import stages. Page coordinates are PDF points with the origin at
// the top-left of the page and y growing down (the adapter flips pdf.js's y-up space once).
import type { Vec } from '../model/types'

export type Box = [number, number, number, number] // x0, y0, x1, y1

export type TextSpan = {
  str: string
  /** Baseline start of the text, page pt. */
  at: Vec
  /** Unit vector along the reading direction, page frame ([1, 0] normal, [0, -1] rotated to read upward). */
  dir: Vec
  /** Font size in pt (the glyph height). */
  size: number
  /** Advance width in pt along dir. */
  width: number
  bbox: Box
  font: string
}

export type Seg = {
  a: Vec
  b: Vec
  /** Stroke width in pt after the transform. */
  w: number
  color: string // #rrggbb
  alpha: number
  /** True for a piece of a flattened curve. */
  curve?: boolean
}

export type Fill = {
  /** One polygon per subpath, page pt. */
  polys: Vec[][]
  bbox: Box
  color: string
  alpha: number
}

export type ImagePaint = {
  /** pdf.js object id (img_p0_3); not the PDF resource name. */
  id: string
  px: [number, number]
  /** Where the image lands on the page, page pt. */
  rect: Box
  /** Painted while building a soft mask (its pixels are a mask, not a picture). */
  mask: boolean
}

export type PageData = {
  page: number // 1-based
  size: [number, number] // pt, after rotation
  rotation: number
  text: TextSpan[]
  segs: Seg[]
  fills: Fill[]
  images: ImagePaint[]
}

/** A decoded raster plan: one byte per pixel, 0 = black, 255 = white. */
export type Gray = { width: number; height: number; data: Uint8Array }

/** An image stream found in the PDF bytes. */
export type PdfImageStream = {
  obj: number
  width: number
  height: number
  filter: string // DCTDecode, FlateDecode, ...
  bits: number
  colorSpace: string
  smask: number | null
  start: number
  end: number
}
