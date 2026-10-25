// The share viewer (08 section 2): read-only, for anyone with the link. Plan with dimensions and room
// names in provenance colors, 3D with an orbit and the cut-away, levels, comment pins with their
// threads, mood boards, and a scheme switcher when more than one scheme was shared. Plain DOM and
// three.js from jsDelivr; no Toolbelt calls.
import { BADGE_COLOR, BADGE_WORD, planSvg } from '../export/plan-svg'
import { type Table, cellText, schedules } from '../export/schedules'
import { ROLES, finishFor, paletteFor } from '../lib/theme'
import { polygonArea, polygonBounds } from '../model/geom'
import type { Inspiration, Model, Room } from '../model/types'
import { formatFeetInches } from '../model/units'
import type { ViewerData, ViewerScheme } from './data'
import { buildScene } from './scene3d'
import CSS from './viewer.css?raw'

type State = { scheme: number; level: string | null; view: 'plan' | '3d'; cut: boolean; tab: 'comments' | 'sizes' | 'mood' | 'info'; pin: string | null }

const data: ViewerData = JSON.parse(document.getElementById('velda-data')!.textContent || '{}')
const root = document.getElementById('velda-viewer')!
const style = document.createElement('style')
style.textContent = CSS
document.head.appendChild(style)

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}
const ft = (v: number) => formatFeetInches(v)

const firstLevel = (m: Model) => [...m.levels].sort((a, b) => a.elev - b.elev).find((l) => m.walls.some((w) => w.level === l.id))?.id ?? m.levels[0]?.id ?? null
const st: State = { scheme: Math.max(0, data.schemes.findIndex((s) => !s.asBuilt)), level: null, view: 'plan', cut: true, tab: 'comments', pin: null }
st.level = firstLevel(data.schemes[st.scheme].model)
const scheme = (): ViewerScheme => data.schemes[st.scheme]

// Exposed for checks (the browser test reads it).
const probe: { meshes: number; view: string; level: string | null } = { meshes: 0, view: 'plan', level: st.level }
;(window as any).__viewer = probe

function render() {
  root.replaceChildren(header(), h('div', { class: 'vw-body' }, stage(), side()))
  probe.view = st.view
  probe.level = st.level
}

function header() {
  const s = scheme()
  const levels = [...s.model.levels].sort((a, b) => a.elev - b.elev).filter((l) => s.model.walls.some((w) => w.level === l.id))
  return h(
    'header',
    { class: 'vw-head' },
    h('div', { class: 'vw-title' }, h('strong', {}, data.project.name), data.project.address ? h('span', { class: 'muted' }, data.project.address) : null),
    data.schemes.length > 1
      ? h(
          'label',
          { class: 'vw-scheme' },
          'Scheme ',
          (() => {
            const sel = h('select', { 'aria-label': 'Scheme', onchange: (e: Event) => ((st.scheme = Number((e.target as HTMLSelectElement).value)), (st.level = firstLevel(scheme().model) ?? st.level), (st.pin = null), render()) })
            data.schemes.forEach((x, i) => sel.append(h('option', { value: i, selected: i === st.scheme }, `${x.name}${x.asBuilt ? ' (as-built)' : ''}`)))
            return sel
          })(),
        )
      : h('span', { class: 'vw-scheme' }, s.name),
    h(
      'nav',
      { class: 'vw-levels', 'aria-label': 'Level' },
      ...(st.view === '3d' && levels.length > 1 ? [h('button', { 'aria-pressed': st.level === null, onclick: () => ((st.level = null), render()) }, 'Whole house')] : []),
      ...levels.map((l) => h('button', { 'aria-pressed': st.level === l.id, onclick: () => ((st.level = l.id), render()) }, l.name)),
    ),
    h(
      'div',
      { class: 'vw-views', role: 'group', 'aria-label': 'View' },
      h('button', { 'aria-pressed': st.view === 'plan', onclick: () => ((st.view = 'plan'), (st.level = st.level ?? firstLevel(scheme().model)), render()) }, 'Plan'),
      h('button', { 'aria-pressed': st.view === '3d', onclick: () => ((st.view = '3d'), render()) }, '3D'),
      st.view === '3d' ? h('button', { 'aria-pressed': st.cut, onclick: () => ((st.cut = !st.cut), render()) }, st.cut ? 'Walls cut away' : 'Walls full height') : null,
    ),
  )
}

function stage() {
  const box = h('main', { class: 'vw-stage' })
  if (st.view === 'plan') plan(box)
  else void three(box)
  box.append(h('p', { class: 'vw-intent' }, data.intent))
  return box
}

function plan(box: HTMLElement) {
  const s = scheme()
  const level = st.level ?? firstLevel(s.model)
  if (!level) return
  const d = planSvg(s.model, { level, text: 9 })
  const wrap = h('div', { class: 'vw-plan' })
  wrap.innerHTML = d.svg
  const svg = wrap.querySelector('svg')!
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${s.model.levels.find((l) => l.id === level)?.name ?? ''} plan`)
  // Comment pins.
  const NS = 'http://www.w3.org/2000/svg'
  const pins = s.comments.filter((c) => c.level === level)
  pins.forEach((c, i) => {
    const gpin = document.createElementNS(NS, 'g')
    gpin.setAttribute('class', `vw-pin${st.pin === c.id ? ' is-on' : ''}${c.resolved ? ' is-resolved' : ''}`)
    gpin.setAttribute('data-id', c.id)
    gpin.setAttribute('transform', `translate(${c.at[0]} ${c.at[1]})`)
    gpin.innerHTML = `<circle r="9"></circle><text y="3.5" text-anchor="middle" font-size="10" font-family="helvetica">${i + 1}</text>`
    gpin.addEventListener('click', (e) => {
      e.stopPropagation()
      st.pin = c.id
      st.tab = 'comments'
      render()
    })
    svg.append(gpin)
  })
  // Pan and zoom by the view box.
  let vb = d.bounds ? [d.bounds.x0, d.bounds.y0, d.w, d.h] : [0, 0, 100, 100]
  const set = () => svg.setAttribute('viewBox', vb.map((v) => v.toFixed(2)).join(' '))
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const k = Math.exp(e.deltaY * 0.0015)
      const scale = Math.max(vb[2] / r.width, vb[3] / r.height)
      const mx = vb[0] + (e.clientX - r.left - (r.width - vb[2] / scale) / 2) * scale
      const my = vb[1] + (e.clientY - r.top - (r.height - vb[3] / scale) / 2) * scale
      vb = [mx - (mx - vb[0]) * k, my - (my - vb[1]) * k, vb[2] * k, vb[3] * k]
      set()
    },
    { passive: false },
  )
  let drag: { x: number; y: number; vb: number[] } | null = null
  wrap.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.vw-pin')) return
    drag = { x: e.clientX, y: e.clientY, vb: [...vb] }
    wrap.setPointerCapture(e.pointerId)
  })
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return
    const r = svg.getBoundingClientRect()
    const scale = Math.max(drag.vb[2] / r.width, drag.vb[3] / r.height)
    vb = [drag.vb[0] - (e.clientX - drag.x) * scale, drag.vb[1] - (e.clientY - drag.y) * scale, drag.vb[2], drag.vb[3]]
    set()
  })
  wrap.addEventListener('pointerup', () => (drag = null))
  box.append(wrap, legend())
}

function legend() {
  return h(
    'ul',
    { class: 'vw-legend', 'aria-label': 'Where the numbers came from' },
    ...(['measured', 'traced', 'assumed', 'velda', 'conflict'] as const).map((b) => h('li', {}, h('span', { class: 'sw', style: `background:${BADGE_COLOR[b]}` }), BADGE_WORD[b])),
  )
}

let renderer: any = null
async function three(box: HTMLElement) {
  const holder = h('div', { class: 'vw-3d' }, h('p', { class: 'muted' }, 'Loading the 3D view...'))
  box.append(holder)
  try {
    const T = await import('three')
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
    const s = scheme()
    const built = buildScene(T, s.model, { level: st.level, cut: st.cut })
    probe.meshes = built.meshes
    const scene = new T.Scene()
    scene.background = new T.Color('#f3f1ec')
    scene.add(new T.HemisphereLight('#ffffff', '#bdb7aa', 1.6))
    const sun = new T.DirectionalLight('#ffffff', 1.4)
    sun.position.set(built.center.x + built.size, built.size * 1.2, built.center.z + built.size * 0.6)
    scene.add(sun)
    scene.add(built.group)
    const w = holder.clientWidth || 800
    const hh = holder.clientHeight || 600
    const cam = new T.PerspectiveCamera(45, w / hh, 0.05, 500)
    const dist = built.size * 1.15
    cam.position.set(built.center.x + dist * 0.35, built.center.y + dist * 0.8, built.center.z + dist * 0.9)
    renderer?.dispose?.()
    renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(w, hh)
    holder.replaceChildren(renderer.domElement)
    const controls = new OrbitControls(cam, renderer.domElement)
    controls.target.copy(built.center)
    controls.update()
    const loop = () => {
      if (!renderer.domElement.isConnected) return
      renderer.render(scene, cam)
      requestAnimationFrame(loop)
    }
    loop()
    new ResizeObserver(() => {
      const W = holder.clientWidth
      const H = holder.clientHeight
      if (!W || !H) return
      cam.aspect = W / H
      cam.updateProjectionMatrix()
      renderer.setSize(W, H)
    }).observe(holder)
  } catch (e) {
    holder.replaceChildren(h('p', { class: 'muted' }, `The 3D view needs a connection to cdn.jsdelivr.net (${String(e).slice(0, 80)}).`))
  }
}

function side() {
  const s = scheme()
  const tabs = h(
    'div',
    { class: 'vw-tabs', role: 'tablist' },
    ...(
      [
        ['comments', `Comments (${s.comments.length})`],
        ['sizes', 'Sizes'],
        ['mood', 'Mood boards'],
        ['info', 'About'],
      ] as const
    ).map(([k, label]) => h('button', { role: 'tab', 'aria-selected': st.tab === k, onclick: () => ((st.tab = k), render()) }, label)),
  )
  const body = h('div', { class: 'vw-panel' })
  if (st.tab === 'comments') body.append(...comments(s))
  else if (st.tab === 'sizes') body.append(...sizes(s.model))
  else if (st.tab === 'mood') body.append(...moods(s.model))
  else body.append(...about(s))
  return h('aside', { class: 'vw-side' }, tabs, body)
}

function comments(s: ViewerScheme) {
  if (!s.comments.length) return [h('p', { class: 'muted' }, 'No comments on this scheme.')]
  const levelName = (id: string) => s.model.levels.find((l) => l.id === id)?.name ?? id
  const perLevel = new Map<string, number>()
  return s.comments.map((c) => {
    const n = (perLevel.get(c.level) ?? 0) + 1
    perLevel.set(c.level, n)
    return h(
      'article',
      {
        class: `vw-comment${st.pin === c.id ? ' is-on' : ''}${c.resolved ? ' is-resolved' : ''}`,
        'data-id': c.id,
        onclick: () => ((st.pin = c.id), (st.level = c.level), (st.view = 'plan'), render()),
      },
      h('div', { class: 'vw-meta' }, h('span', { class: 'vw-num' }, String(n)), `${levelName(c.level)} · ${c.author} · ${c.created_at.slice(0, 10)}${c.resolved ? ' · resolved' : ''}`),
      h('p', {}, c.body),
      ...c.replies.map((r) => h('div', { class: 'vw-reply' }, h('div', { class: 'vw-meta' }, `${r.author} · ${r.created_at.slice(0, 10)}`), h('p', {}, r.body))),
    )
  })
}

/** What each schedule shows here (the CSV and PDF keep every column, ids included). */
const SHOW: Record<string, string[]> = {
  rooms: ['name', 'width_in', 'depth_in', 'area_sf', 'ceiling_in'],
  doors: ['rooms', 'width_in', 'height_in', 'style', 'swing'],
  windows: ['room', 'width_in', 'head_in', 'sill_in', 'style', 'egress'],
  items: ['room', 'item', 'width_in', 'depth_in', 'height_in', 'vendor'],
}

/** The rooms, doors, windows and fixtures of the level shown, with their sizes (02 success criterion 4). */
function sizes(m: Model) {
  const level = m.levels.find((l) => l.id === st.level)?.name
  const out: HTMLElement[] = [h('p', { class: 'muted' }, `${level ?? 'Every level'}. Rooms are wall to wall; heights are from the floor.`)]
  for (const t of schedules(m)) {
    const rows = t.rows.filter((r) => !level || r.level === level)
    if (!rows.length) continue
    const cols = t.cols.filter((c) => SHOW[t.name]?.includes(c.key))
    const cell = (t: Table, c: Table['cols'][number], r: Table['rows'][number]) => {
      const v = cellText(t, c, r)
      return c.key === 'vendor' && r.link ? h('a', { href: String(r.link), target: '_blank', rel: 'noreferrer noopener' }, v || 'link') : v
    }
    out.push(
      h('h3', {}, t.title),
      h(
        'table',
        { class: 'vw-table' },
        h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', {}, c.label)))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, ...cols.map((c) => h('td', { class: c.ft || c.key === 'area_sf' ? 'num' : undefined }, cell(t, c, r)))))),
      ),
    )
  }
  return out
}

function moods(m: Model) {
  const rooms = m.rooms.filter((r) => r.polygon.length >= 3 && (r.theme || m.inspiration.some((c) => c.rooms.includes(r.id))))
  if (!rooms.length) return [h('p', { class: 'muted' }, 'No mood boards yet: no room has a theme or inspiration in this scheme.')]
  return rooms.map((r) => mood(m, r))
}

function mood(m: Model, r: Room) {
  const theme = (r.theme && m.themes[r.theme]) || (m.theme ? m.themes[m.theme] : null)
  const b = polygonBounds(r.polygon)
  const cards = m.inspiration.filter((c) => c.rooms.includes(r.id) && c.kind !== 'board').slice(0, 12)
  const sw: HTMLElement[] = []
  if (theme)
    for (const role of ROLES) {
      const p = paletteFor(theme, role)
      const f = finishFor(theme, role)
      if (!p && !theme.data.finishes?.[role]) continue
      const hex = f.color ?? p?.hex ?? '#ddd'
      sw.push(h('li', {}, h('span', { class: 'sw', style: `background:${hex}` }), h('strong', {}, role), ` ${p?.name ?? ''} `, h('code', {}, hex)))
    }
  return h(
    'section',
    { class: 'vw-mood' },
    h('h3', {}, r.name),
    h('p', { class: 'muted' }, `${ft(b.x1 - b.x0)} x ${ft(b.y1 - b.y0)}, ${Math.round(polygonArea(r.polygon) / 144)} sf`),
    theme ? h('p', {}, h('strong', {}, theme.name), theme.data.description ? ` ${theme.data.description}` : '') : null,
    sw.length ? h('ul', { class: 'vw-sw' }, ...sw) : null,
    theme?.data.materials?.length ? h('ul', { class: 'vw-mat' }, ...theme.data.materials.map((x) => h('li', {}, h('strong', {}, x.category), ` ${x.choice}`))) : null,
    cards.length ? h('ul', { class: 'vw-pics' }, ...cards.map(picture)) : null,
  )
}

function picture(c: Inspiration) {
  const src = data.thumbs[c.id]
  const link = c.url ?? (c.image && /^https?:/.test(c.image) ? c.image : undefined)
  const colors = (c.tags.palette.length ? c.tags.palette : (c.sampled ?? [])).slice(0, 5)
  return h(
    'li',
    {},
    src ? h('img', { src, alt: c.title ?? 'inspiration', loading: 'lazy' }) : h('div', { class: 'vw-chips' }, ...colors.map((s) => h('span', { style: `background:${s.hex}`, title: s.hex }))),
    h('span', { class: 'vw-cap' }, c.title ?? c.kind),
    link ? h('a', { href: link, target: '_blank', rel: 'noreferrer noopener' }, c.source ?? 'link') : null,
  )
}

function about(s: ViewerScheme) {
  return [
    h('p', {}, h('strong', {}, s.name), s.asBuilt ? ' (the house as it is today)' : ''),
    h('p', { class: 'muted' }, `${s.version}, ${s.date}`),
    h('p', {}, data.intent),
    h('p', { class: 'muted' }, `Shared ${data.created.slice(0, 10)} from Velda Studio. This page is read-only.`),
  ]
}

render()
