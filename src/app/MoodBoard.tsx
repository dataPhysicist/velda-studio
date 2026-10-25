// A printable mood board for one room (06 section 6, used by the handoff package in Phase 8): the
// room's theme (colors by role with names and hex values, materials, what to avoid) and its
// inspiration pictures with where each came from. Print shows only the board.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ROLES, finishFor, paletteFor } from '../lib/theme'
import { polygonArea, polygonBounds } from '../model/geom'
import { formatFeetInches as ft } from '../model/units'
import { pictureUrl } from './inspiration'
import { useStudio } from './store'

export function MoodBoard({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const model = useStudio((s) => s.model)
  const scheme = useStudio((s) => s.schemes.find((x) => x.id === s.schemeId)?.name)
  useEffect(() => {
    document.body.classList.add('has-moodboard')
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => {
      document.body.classList.remove('has-moodboard')
      window.removeEventListener('keydown', esc)
    }
  }, [])
  const room = model?.rooms.find((r) => r.id === roomId)
  if (!model || !room) return null
  const theme = (room.theme && model.themes[room.theme]) || (model.theme ? model.themes[model.theme] : null)
  const cards = model.inspiration.filter((c) => c.rooms.includes(room.id) && c.kind !== 'board')
  const b = polygonBounds(room.polygon)
  // Outside the studio, so printing can hide the studio and keep the board.
  return createPortal(
    <div className="moodboard" role="dialog" aria-label={`${room.name} mood board`}>
      <div className="mb-actions">
        <button type="button" className="btn small primary" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
      <header className="mb-head">
        <h1>{room.name}</h1>
        <p>
          {scheme} · {ft(b.x1 - b.x0)} x {ft(b.y1 - b.y0)}, {Math.round(polygonArea(room.polygon) / 144)} sf · 5008 Velda Dairy
        </p>
      </header>
      {theme ? (
        <section className="mb-theme">
          <h2>{theme.name}</h2>
          {theme.data.description && <p>{theme.data.description}</p>}
          <ul className="mb-swatches">
            {ROLES.map((role) => {
              const pal = paletteFor(theme, role)
              const fin = finishFor(theme, role)
              if (!pal && !theme.data.finishes?.[role]) return null
              return (
                <li key={role}>
                  <span className="mb-chip" style={{ background: fin.color ?? pal?.hex ?? '#ddd' }} />
                  <strong>{role}</strong>
                  <span>{pal?.name ?? fin.note ?? fin.library ?? ''}</span>
                  <code>{fin.color ?? pal?.hex ?? ''}</code>
                </li>
              )
            })}
            {/* Colors beyond the first for a role (a second accent, the veining): shown too. */}
            {(theme.data.palette ?? [])
              .filter((p) => { const r = (p.role ?? '').toLowerCase(); return !(ROLES as readonly string[]).includes(r) || p !== paletteFor(theme, r as any) })
              .map((p) => (
                <li key={`${p.role}-${p.hex}`}>
                  <span className="mb-chip" style={{ background: p.hex }} />
                  <strong>{p.role ?? 'color'}</strong>
                  <span>{p.name}</span>
                  <code>{p.hex}</code>
                </li>
              ))}
          </ul>
          {!!theme.data.materials?.length && (
            <ul className="mb-materials">
              {theme.data.materials.map((m) => (
                <li key={`${m.category}-${m.choice}`}>
                  <strong>{m.category}</strong> {m.choice}
                </li>
              ))}
            </ul>
          )}
          {!!theme.data.avoid?.length && <p className="mb-avoid">Avoid: {theme.data.avoid.join('; ')}</p>}
        </section>
      ) : (
        <p className="mb-note">No theme for this room yet. Pick inspiration in the Inspiration tab and choose "Make a theme from these".</p>
      )}
      {cards.length ? (
        <ul className="mb-grid">
          {cards.map((c) => (
            <Picture key={c.id} image={c.image} title={c.title ?? ''} source={c.source ?? ''} colors={c.tags.palette.map((p) => p.hex)} notes={c.tags.notes} />
          ))}
        </ul>
      ) : (
        <p className="mb-note">No inspiration filed under this room yet.</p>
      )}
      <footer className="mb-foot">Pictures are mood, not dimensions. Colors on screen and in print vary; confirm finishes with physical samples.</footer>
    </div>,
    document.body,
  )
}

function Picture({ image, title, source, colors, notes }: { image?: string; title: string; source: string; colors: string[]; notes?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => void pictureUrl(image).then(setSrc), [image])
  return (
    <li>
      {src ? <img src={src} alt={title} /> : <div className="insp-noimg" />}
      <div className="mb-cap">
        <strong>{title}</strong>
        <span>{source}</span>
        {!!colors.length && (
          <span className="insp-swatches">
            {colors.slice(0, 5).map((h) => (
              <span key={h} style={{ background: h }} />
            ))}
          </span>
        )}
        {notes && <em>{notes}</em>}
      </div>
    </li>
  )
}
