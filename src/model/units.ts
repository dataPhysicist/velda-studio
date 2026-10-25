// Units. The model stores inches (to 0.01); Pascal's scene is meters; people read feet and inches.
export const IN = 0.0254
export const m = (inches: number) => inches * IN
export const inch = (meters: number) => meters / IN

/** Feet and inches for display, to the nearest 1/8 in: 236 -> 19'-8", 96.25 -> 8'-0 1/4". */
export function formatFeetInches(inches: number): string {
  const sign = inches < 0 ? '-' : ''
  let eighths = Math.round(Math.abs(inches) * 8)
  const ft = Math.floor(eighths / 96)
  eighths -= ft * 96
  const whole = Math.floor(eighths / 8)
  let rem = eighths - whole * 8
  let fracText = ''
  if (rem) {
    let den = 8
    while (rem % 2 === 0) {
      rem /= 2
      den /= 2
    }
    fracText = ` ${rem}/${den}`
  }
  return `${sign}${ft}'-${whole}${fracText}"`
}

/** Area in square feet, rounded: 453 sf. */
export const sqft = (sqIn: number) => Math.round(sqIn / 144)

/** Shorten text to at most n characters at a word break, without a dangling comma or dash. */
export function clipWords(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t.length <= n) return t
  const cut = t.slice(0, n + 1)
  const at = cut.lastIndexOf(' ')
  return (at > n / 2 ? cut.slice(0, at) : t.slice(0, n)).replace(/[\s,;:(\-]+$/, '')
}

/** A product's name for a label: the part before a comma, dash or bar, at most 48 characters. */
export function productName(title: string): string {
  return clipWords(title.split(/,\s|\s[-–|]\s|\s\(/)[0], 48)
}
