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
