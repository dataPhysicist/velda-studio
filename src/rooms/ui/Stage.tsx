// The photo, and everything done to it: ask for a change in words, mark a spot so only that spot can
// change, compare with the real photo, keep or discard the result, and step through the versions.
import { Bookmark, Brush as BrushIcon, Download, Eraser, ImagePlus, Send, Trash2, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { softMask } from '../photo/compose'
import { again, type Brush, change, discard, download, keep, openVersion, removeVersion, setProtect, star, toggleArea, useRooms } from '../store'
import type { Photo } from '../db'

const MASK_W = 160

type BrushHandle = { get(): Brush | null; clear(): void }

/** Paint over the part of the photo that may change. */
const BrushLayer = forwardRef<BrushHandle, { ratio: number; size: number; onInk: (has: boolean) => void }>(function BrushLayer({ ratio, size, onInk }, ref) {
  const cv = useRef<HTMLCanvasElement>(null)
  const mh = Math.round(MASK_W / ratio)
  const mask = useRef(new Uint8Array(MASK_W * mh))
  const last = useRef<[number, number] | null>(null)
  useImperativeHandle(ref, () => ({
    get() {
      if (!mask.current.some((v) => v)) return null
      return { mask: softMask(mask.current, MASK_W, mh, 2), w: MASK_W, h: mh }
    },
    clear() {
      mask.current.fill(0)
      const c = cv.current
      c?.getContext('2d')!.clearRect(0, 0, c.width, c.height)
      onInk(false)
    },
  }))
  useLayoutEffect(() => {
    const c = cv.current!
    c.width = 640
    c.height = Math.round(640 / ratio)
  }, [ratio])
  const stamp = (fx: number, fy: number) => {
    const c = cv.current!
    const g = c.getContext('2d')!
    const r = size * c.width
    g.fillStyle = 'rgba(46, 107, 98, 0.45)'
    g.globalCompositeOperation = 'source-over'
    g.beginPath()
    g.arc(fx * c.width, fy * c.height, r, 0, Math.PI * 2)
    g.fill()
    const mr = size * MASK_W
    const cx = fx * MASK_W
    const cy = fy * mh
    for (let y = Math.max(0, Math.floor(cy - mr)); y <= Math.min(mh - 1, Math.ceil(cy + mr)); y++)
      for (let x = Math.max(0, Math.floor(cx - mr)); x <= Math.min(MASK_W - 1, Math.ceil(cx + mr)); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= mr * mr) mask.current[y * MASK_W + x] = 1
  }
  const at = (e: React.PointerEvent): [number, number] => {
    const b = cv.current!.getBoundingClientRect()
    return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]
  }
  const stroke = (p: [number, number]) => {
    const a = last.current ?? p
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - a[0], p[1] - a[1]) / (size * 0.5)))
    for (let i = 1; i <= steps; i++) stamp(a[0] + ((p[0] - a[0]) * i) / steps, a[1] + ((p[1] - a[1]) * i) / steps)
    last.current = p
  }
  return (
    <canvas
      ref={cv}
      className="brush-layer"
      aria-label="Paint over the part to change"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        last.current = null
        stroke(at(e))
        onInk(true)
      }}
      onPointerMove={(e) => {
        if (last.current && e.buttons) stroke(at(e))
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    />
  )
})

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.round((Date.now() - since) / 1000)
  return <span className="muted">{s < 3 ? 'Usually about 20 seconds' : `${s} seconds`}</span>
}

export function Stage({ photo, draft, setDraft }: { photo: Photo; draft: string; setDraft: (s: string) => void }) {
  const versionId = useRooms((s) => s.versionId)
  const versions = useRooms((s) => s.versions)
  const images = useRooms((s) => s.images)
  const pending = useRooms((s) => s.pending)
  const busy = useRooms((s) => s.busy)
  const list = useMemo(() => versions.filter((v) => v.photo_id === photo.id), [versions, photo.id])
  const cur = list.find((v) => v.id === versionId) ?? list[list.length - 1]
  const first = list[0]
  const [marking, setMarking] = useState(false)
  const [ink, setInk] = useState(false)
  const [size, setSize] = useState(0.045)
  const [before, setBefore] = useState(false)
  const [refs, setRefs] = useState<File[]>([])
  const brush = useRef<BrushHandle>(null)
  const pick = useRef<HTMLInputElement>(null)
  const ratio = photo.w / photo.h

  useEffect(() => {
    setMarking(false)
    setInk(false)
  }, [versionId, photo.id])

  const src = before ? (pending ? images[list.find((v) => v.id === pending.baseVersion)?.path ?? ''] : images[first?.path ?? '']) : pending ? pending.preview : cur ? images[cur.path] : undefined
  const canCompare = !!pending || (cur && first && cur.id !== first.id)

  const send = (words = draft, opts: Parameters<typeof change>[1] = {}) => {
    if (!words.trim() || busy) return
    const b = marking ? (brush.current?.get() ?? null) : null
    void change(words, { brush: b, refs, ...opts })
    setDraft('')
    setRefs([])
    setMarking(false)
    setInk(false)
  }
  const an = pending?.result.analysis
  const areas = pending && pending.result.kind === 'full' && an ? an.regions.filter((r) => pending.keep.includes(r.id) || r.area >= 0.004).slice(0, 8) : []
  const same = pending ? Math.round((1 - differingShare(pending)) * 100) : 0

  return (
    <div className="stage">
      <div className="frame-wrap" style={{ maxWidth: `calc(72vh * ${ratio})` }}>
        <div className={`frame${busy ? ' is-busy' : ''}`} style={{ aspectRatio: `${photo.w} / ${photo.h}` }}>
          {src ? <img src={src} alt={pending ? `${pending.label}, not saved yet` : (cur?.label ?? 'Photo')} draggable={false} /> : <div className="frame-wait">Loading the photo</div>}
          {marking && !pending && !busy && <BrushLayer ref={brush} ratio={ratio} size={size} onInk={setInk} />}
          {pending && pending.protect && !before && areas.length > 0 && (
            <div className="areas" aria-label="What changed">
              {areas.map((r) => {
                const kept = pending.keep.includes(r.id)
                return (
                  <button
                    key={r.id}
                    className={`area${kept ? ' kept' : ''}`}
                    style={{ left: `${r.box[0] * 100}%`, top: `${r.box[1] * 100}%`, width: `${(r.box[2] - r.box[0]) * 100}%`, height: `${(r.box[3] - r.box[1]) * 100}%` }}
                    onClick={() => toggleArea(r.id)}
                    title={kept ? 'This part changed. Click to put it back the way it was.' : 'The model also changed this part; it has been put back. Click to keep its change.'}
                  >
                    <span>{kept ? 'Changed' : 'Put back'}</span>
                  </button>
                )
              })}
            </div>
          )}
          {busy && (
            <div className="frame-busy" role="status">
              <strong>{busy.text}</strong>
              <Elapsed since={busy.started} />
            </div>
          )}
          {canCompare && !busy && (
            <button
              className="hold"
              onPointerDown={() => setBefore(true)}
              onPointerUp={() => setBefore(false)}
              onPointerLeave={() => setBefore(false)}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setBefore(true)}
              onKeyUp={() => setBefore(false)}
            >
              {before ? (pending ? 'Before this change' : 'Your photo') : 'Hold to see before'}
            </button>
          )}
        </div>
      </div>

      {pending ? (
        <div className="review" role="group" aria-label="Review this change">
          <p className="review-say">
            {pending.result.kind === 'spot'
              ? 'Only the part you marked changed. Everything outside it is exactly as it was.'
              : pending.protect
                ? `${pending.keep.length === 1 ? 'One area changed' : `${pending.keep.length} areas changed`}. The rest (${same}% of the picture) is exactly as it was.`
                : pending.result.whole
                  ? 'This is a new look for the whole room, so the whole picture was redrawn.'
                  : 'The whole picture was redrawn.'}
            {pending.protect && areas.length > pending.keep.length && ' Boxes marked "Put back" are things the model changed that you did not ask for.'}
          </p>
          {pending.result.kind === 'full' && an && an.regions.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={pending.protect} onChange={(e) => setProtect(e.target.checked)} /> Only change what I asked for
            </label>
          )}
          <div className="review-go">
            <button className="btn primary" onClick={() => void keep()} disabled={!!busy}>
              Keep it
            </button>
            <button className="btn" onClick={() => void again()} disabled={!!busy}>
              Try again
            </button>
            <button className="btn quiet" onClick={discard} disabled={!!busy}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          {marking && (
            <div className="mark-bar">
              <span>{ink ? 'Only the painted part will change.' : 'Paint over the part you want to change.'}</span>
              <span className="sizes" role="group" aria-label="Brush size">
                {[
                  ['Small', 0.022],
                  ['Medium', 0.045],
                  ['Large', 0.09],
                ].map(([name, v]) => (
                  <button type="button" key={name as string} aria-pressed={size === v} onClick={() => setSize(v as number)}>
                    {name}
                  </button>
                ))}
              </span>
              <button type="button" className="link" onClick={() => brush.current?.clear()}>
                <Eraser size={14} /> Clear
              </button>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={marking ? 'What should the painted part become?' : 'What would you like to change? For example: paint the vanity navy blue'}
            aria-label="What would you like to change?"
            disabled={!!busy}
          />
          {refs.length > 0 && (
            <div className="refs">
              {refs.map((f, i) => (
                <span key={i} className="ref">
                  Copying the look of {f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name}
                  <button type="button" aria-label="Remove this picture" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="ask-row">
            <button type="button" className={`btn tool${marking ? ' on' : ''}`} aria-pressed={marking} onClick={() => setMarking(!marking)} disabled={!!busy}>
              <BrushIcon size={16} /> {marking ? 'Marking a spot' : 'Mark a spot'}
            </button>
            <button type="button" className="btn tool" onClick={() => pick.current?.click()} disabled={!!busy} title="Add a picture of something you like, and ask for its look">
              <ImagePlus size={16} /> Copy a look
            </button>
            <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => (setRefs([...refs, ...Array.from(e.target.files ?? [])].slice(0, 3)), (e.target.value = ''))} />
            <button type="submit" className="btn primary send" disabled={!draft.trim() || !!busy}>
              <Send size={16} /> Show me
            </button>
          </div>
        </form>
      )}

      <div className="strip" role="list" aria-label="Versions of this photo">
        {list.map((v) => {
          const on = !pending && v.id === cur?.id
          return (
            <div key={v.id} role="listitem" className={`ver${on ? ' on' : ''}`}>
              <button className="ver-pic" onClick={() => void openVersion(v.id)} aria-current={on} title={v.words || 'The photo as you took it'}>
                <img src={v.thumb} alt="" />
                {v.fav && <Bookmark className="ver-fav" size={14} fill="currentColor" />}
              </button>
              <span className="ver-name">{v.label}</span>
              {on && (
                <span className="ver-tools">
                  <button onClick={() => void star(v.id)} aria-pressed={v.fav} title={v.fav ? 'Remove from favorites' : 'Mark as a favorite'}>
                    <Bookmark size={15} fill={v.fav ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => download(v.id)} title="Download this picture">
                    <Download size={15} />
                  </button>
                  {v.meta.kind !== 'photo' && (
                    <button onClick={() => void removeVersion(v.id)} title="Delete this version">
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              )}
            </div>
          )
        })}
        {pending && (
          <div role="listitem" className="ver on unsaved">
            <span className="ver-pic">
              <img src={pending.preview} alt="" />
            </span>
            <span className="ver-name">{pending.label}</span>
            <span className="muted small">Not saved yet</span>
          </div>
        )}
      </div>
      {!pending && cur && cur.id !== first?.id && <p className="muted small base-note">Your next change starts from "{cur.label}". Pick another version above to start from it instead.</p>}
    </div>
  )
}

/** Share of the picture under review that differs from the picture it started from. */
function differingShare(p: NonNullable<ReturnType<typeof useRooms.getState>['pending']>): number {
  const a = p.base.data
  const b = p.final.data
  let n = 0
  // Every 4th pixel is plenty for a percentage.
  for (let i = 0; i < a.length; i += 16) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++
  return n / (a.length / 16)
}

