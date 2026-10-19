// The sheet picture under the plan: the plan raster saved with the import, placed in the house frame
// by the sheet's affine (raster inches to house inches). Loaded once per blob and kept as an object URL.
import { useEffect, useState } from 'react'
import { useStudio } from '../app/store'
import type { Model } from '../model/types'

export type Underlay = { url: string; w: number; h: number; transform: string }

const urls = new Map<string, Promise<string | null>>()

function load(blobId: string): Promise<string | null> {
  let p = urls.get(blobId)
  if (!p) {
    const repo = useStudio.getState().repo
    p = (repo ? repo.blobBytes(blobId) : Promise.resolve(null))
      .then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/jpeg' })) : null))
      .catch(() => null)
    urls.set(blobId, p)
  }
  return p
}

export function useUnderlay(model: Model | null, level: string): Underlay | null {
  const sheet = model?.sheets.find((s) => s.level === level && s.raster?.blobId)
  const blobId = sheet?.raster.blobId ?? null
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (blobId) void load(blobId).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [blobId])
  if (!sheet || !url) return null
  const [a, b, c, d, e, f] = sheet.toHouse
  return { url, w: sheet.raster.px[0] / sheet.raster.pxPerInch, h: sheet.raster.px[1] / sheet.raster.pxPerInch, transform: `matrix(${a} ${b} ${c} ${d} ${e} ${f})` }
}
