// The Export and Share dialogs (08 sections 2, 7 and 8).
import { useEffect, useMemo, useState } from 'react'
import type { CheckLine } from '../export/checklist'
import { type Built, type Context, context, PARTS, type PartKey, type ShareRecord, share, shares, size, stopShare, buildParts, zipParts } from './handoff'
import { focusOn, useStudio } from './store'

function useContext(open: boolean) {
  const [c, setC] = useState<Context | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setC(null)
    context()
      .then((x) => (x ? setC(x) : setErr('Open a scheme first.')))
      .catch((e) => setErr(String((e as Error).message || e)))
  }, [open])
  return { c, err }
}

function Veil({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return (
    <div className="confirm-veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Checklist({ lines, onFix }: { lines: CheckLine[]; onFix: (l: CheckLine) => void }) {
  return (
    <ul className="handoff-check">
      {lines.map((l) => (
        <li key={l.text} className={l.ok ? 'is-ok' : 'is-missing'}>
          <span className="mark" aria-hidden="true">
            {l.ok ? '✓' : '!'}
          </span>
          <div>
            <span>{l.text}</span>
            {!l.ok && !!l.missing.length && (
              <ul>
                {l.missing.slice(0, 4).map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {l.missing.length > 4 && <li>and {l.missing.length - 4} more</li>}
              </ul>
            )}
            {!l.ok && l.fix && (
              <button type="button" className="link small" onClick={() => onFix(l)}>
                Show me
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Take the person to what a checklist line is about. */
function fixIt(c: Context, l: CheckLine) {
  const f = l.fix
  if (!f) return
  if (f.kind === 'issue') useStudio.setState({ ctxTab: 'checks' })
  else if (f.kind === 'room') focusOn({ roomId: f.ids[0] })
  else if (f.kind === 'level') focusOn({ levelId: f.ids[0], roomId: null })
  else if (f.kind === 'opening') {
    const o = c.model.openings.find((x) => x.id === f.ids[0])
    const lv = o ? c.model.walls.find((w) => w.id === o.wall)?.level : null
    if (lv) focusOn({ levelId: lv, roomId: null })
  } else if (f.kind === 'dimension') {
    const d = c.model.dimensions.find((x) => x.id === f.ids[0])
    if (d) focusOn({ levelId: d.level, roomId: null })
  }
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { c, err } = useContext(true)
  const [sel, setSel] = useState<Set<PartKey>>(new Set(PARTS.map((p) => p.key)))
  const [paper, setPaper] = useState<'tabloid' | 'arch-d'>('tabloid')
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ files: Built[]; zip: { name: string; blob: Blob } } | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const urls = useMemo(() => (done ? new Map([...done.files.map((f) => [f.path, URL.createObjectURL(f.blob)] as const), ['zip', URL.createObjectURL(done.zip.blob)] as const]) : null), [done])
  useEffect(() => () => urls?.forEach((u) => URL.revokeObjectURL(u)), [urls])
  const build = async () => {
    if (!c) return
    setFail(null)
    setDone(null)
    try {
      setBusy('Starting')
      const files = await buildParts(c, sel, { size: paper, progress: setBusy })
      setBusy('Zipping')
      const zip = await zipParts(c, files)
      setDone({ files, zip })
    } catch (e) {
      setFail(String((e as Error).message || e))
    } finally {
      setBusy(null)
    }
  }
  const proposed = c && !c.isAsBuilt
  return (
    <Veil title="Export" onClose={onClose} wide>
      {err && <p className="veil-error">{err}</p>}
      {!c && !err && <p className="muted">Reading the scheme...</p>}
      {c && (
        <div className="handoff">
          <section>
            <p>
              <strong>{c.scheme.name}</strong>
              {c.isAsBuilt ? ' (the as-built)' : c.asBuilt ? `, compared with ${c.asBuilt.scheme.name}` : ', with no as-built to compare with'}
            </p>
            <h3>Ready for your designer or architect?</h3>
            <Checklist
              lines={c.checklist}
              onFix={(l) => {
                fixIt(c, l)
                onClose()
              }}
            />
            <p className="muted small">This list does not stop the export; it goes in the package as README.md so whoever gets it knows what is still open.</p>
          </section>
          <section>
            <h3>What goes in</h3>
            <ul className="handoff-parts">
              {PARTS.map((p) => {
                const off = p.key === 'changes' && !proposed
                return (
                  <li key={p.key}>
                    <label className={off ? 'is-off' : ''}>
                      <input
                        type="checkbox"
                        disabled={off || !!busy}
                        checked={!off && sel.has(p.key)}
                        onChange={(e) => setSel((s) => (e.target.checked ? new Set([...s, p.key]) : new Set([...s].filter((x) => x !== p.key))))}
                      />
                      <span>
                        {p.label} <span className="muted small">{off ? 'only for a scheme compared with the as-built' : p.note}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {sel.has('sheets') && (
              <fieldset className="handoff-paper">
                <legend className="small muted">Sheet size</legend>
                <label>
                  <input type="radio" name="paper" checked={paper === 'tabloid'} onChange={() => setPaper('tabloid')} /> 11 x 17
                </label>
                <label>
                  <input type="radio" name="paper" checked={paper === 'arch-d'} onChange={() => setPaper('arch-d')} /> 24 x 36
                </label>
              </fieldset>
            )}
            <button type="button" className="btn primary" disabled={!!busy || !sel.size} onClick={() => void build()}>
              {busy ? `${busy}...` : done ? 'Build again' : 'Build package'}
            </button>
            {fail && <p className="veil-error">The package could not be built: {fail}</p>}
            {done && urls && (
              <div className="handoff-done" role="status">
                <p>
                  <a className="btn primary small" href={urls.get('zip')} download={done.zip.name}>
                    Download {done.zip.name}
                  </a>{' '}
                  <span className="muted small">{size(done.zip.blob.size)}</span>
                </p>
                <ul>
                  {done.files.map((f) => (
                    <li key={f.path}>
                      <a href={urls.get(f.path)} download={f.path.split('/').pop()}>
                        {f.path}
                      </a>{' '}
                      <span className="muted small">{size(f.blob.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </Veil>
  )
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { c, err } = useContext(true)
  const sdk = useStudio((s) => s.sdk)
  const [days, setDays] = useState(30)
  const [withComments, setWithComments] = useState(true)
  const [list, setList] = useState<ShareRecord[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [made, setMade] = useState<ShareRecord | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  useEffect(() => {
    void shares().then(setList)
  }, [])
  const run = async (what: string, f: () => Promise<unknown>) => {
    setFail(null)
    setBusy(what)
    try {
      await f()
      setList(await shares())
    } catch (e) {
      setFail(String((e as Error).message || e))
    } finally {
      setBusy(null)
    }
  }
  const copy = async (u: string) => {
    await navigator.clipboard?.writeText(u).catch(() => {})
    setCopied(u)
    setTimeout(() => setCopied(null), 1600)
  }
  const mine = c ? list.filter((x) => x.schemes.includes(c.scheme.id)) : []
  return (
    <Veil title="Share a read-only link" onClose={onClose}>
      {err && <p className="veil-error">{err}</p>}
      {!c && !err && <p className="muted">Reading the scheme...</p>}
      {c && (
        <div className="share">
          <p>
            Anyone with the link sees <strong>{c.scheme.name}</strong>
            {c.asBuilt && !c.isAsBuilt ? <> and {c.asBuilt.scheme.name} for comparison</> : null}: the plan with its dimensions, the 3D view, comments and mood boards. They do not need a Toolbelt account.
          </p>
          <p className="muted small">People with the link cannot change anything or comment on it. A designer who needs to write is added to your Toolbelt workspace and uses the studio itself.</p>
          {!sdk && <p className="veil-error">Sharing needs the Toolbelt page.</p>}
          <div className="share-make">
            <label>
              Link works for{' '}
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={30}>30 days</option>
                <option value={365}>1 year</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} /> Include comments
            </label>
            <button type="button" className="btn primary" disabled={!sdk || !!busy} onClick={() => void run('Making the link', async () => setMade(await share(c, days, undefined, { comments: withComments })))}>
              {busy === 'Making the link' ? 'Making the link...' : 'Make a link'}
            </button>
          </div>
          {made && (
            <div className="share-link" role="status">
              <input readOnly value={made.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn small" onClick={() => void copy(made.url)}>
                {copied === made.url ? 'Copied' : 'Copy'}
              </button>
              <a href={made.url} target="_blank" rel="noreferrer" className="link small">
                Open
              </a>
            </div>
          )}
          {fail && <p className="veil-error">{fail}</p>}
          {!!mine.length && (
            <>
              <h3>Links for this scheme</h3>
              <ul className="share-list">
                {mine.map((r) => (
                  <li key={r.id} className={r.stopped ? 'is-off' : ''}>
                    <div>
                      <span>{r.names.join(' + ')}</span>{' '}
                      <span className="muted small">
                        made {r.created.slice(0, 10)}, {r.stopped ? 'turned off' : `works until ${r.expires.slice(0, 10)}`}, {size(r.bytes)}
                      </span>
                    </div>
                    {!r.stopped && (
                      <div className="share-actions">
                        <button type="button" className="link small" onClick={() => void copy(r.url)}>
                          {copied === r.url ? 'Copied' : 'Copy link'}
                        </button>
                        <button type="button" className="link small" disabled={!!busy} onClick={() => void run('Updating', () => share(c, days, r))}>
                          Update to this version
                        </button>
                        <button type="button" className="link small" disabled={!!busy} onClick={() => void run('Turning off', () => stopShare(r))}>
                          Turn off
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Veil>
  )
}
