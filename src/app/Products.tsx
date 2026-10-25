// Products Velda found for a room (07 section 7): a card each with its picture, size, price and a
// link, and Place, which puts it against the wall the fit worked out (or the longest free wall).
import { showerFits } from '../library/fit'
import type { ItemKind } from '../model/types'
import { formatFeetInches, productName } from '../model/units'
import type { MessageMeta } from '../repo'
import { handEdit } from './editor'
import { useStudio } from './store'

type Product = NonNullable<MessageMeta['products']>[number]
const ft = (v: number) => formatFeetInches(v).replace(/^0'-/, '')

export function Products({ items }: { items: Product[] }) {
  return (
    <ul className="products">
      {items.map((p) => (
        <li key={p.url} className="product">
          {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <div className="insp-noimg" aria-hidden="true" />}
          <div className="product-body">
            <a href={p.url} target="_blank" rel="noreferrer" className="product-title">
              {p.title}
            </a>
            <span className="muted small">
              {[p.w && p.d ? `${ft(p.w)} x ${ft(p.d)}` : '', p.price ?? '', p.type?.replace(/_/g, ' ') ?? ''].filter(Boolean).join(' · ')}
            </span>
            {p.w && p.d && p.room ? (
              <button type="button" className="link small" onClick={() => void place(p)}>
                Place it
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

const KIND: [RegExp, ItemKind][] = [
  [/tub_shower|tub/, 'tub'],
  [/shower|walk_in|curbless|neo|alcove|double|steam|wet/, 'shower'],
  [/vanity/, 'vanity'],
  [/toilet/, 'toilet'],
]

function place(p: Product) {
  const model = useStudio.getState().model
  const room = model?.rooms.find((r) => r.id === p.room)
  if (!model || !room || !p.w || !p.d) return
  const kind = KIND.find(([re]) => re.test(`${p.type ?? ''} ${p.title}`.toLowerCase()))?.[1] ?? 'item'
  // A shower goes where the fit found room for that type; anything else against the longest free wall.
  const fit = kind === 'shower' ? showerFits(model, room).fits.find((f) => f.id === p.type) : null
  return handEdit(
    [{ op: 'place', item: { kind, label: productName(p.title), w: p.w, d: p.d, props: { url: p.url, ...(p.image ? { image: p.image } : {}), ...(p.price ? { price: p.price } : {}) } }, room: room.id, against: fit?.wall ?? 'longest', align: fit ? 'start' : 'center' }],
    `Placed ${productName(p.title)}`,
  )
}
