// What a share link carries: the schemes shared, each with its model and comments, and small
// thumbnails of the inspiration pictures. Written by the studio (src/export/viewer-html.ts), read by
// the viewer (src/viewer/main.ts). Plain JSON inside the HTML file.
import type { Comment, Model } from '../model/types'

export type ViewerReply = { body: string; author: string; created_at: string }
export type ViewerScheme = {
  id: string
  name: string
  version: string
  date: string
  asBuilt: boolean
  model: Model
  comments: (Comment & { replies: ViewerReply[] })[]
}
export type ViewerData = {
  v: 1
  project: { name: string; address?: string }
  created: string
  intent: string
  schemes: ViewerScheme[]
  /** Inspiration card id to a small data-URI picture (the page could read it); others show colors and a link. */
  thumbs: Record<string, string>
}
