// Velda Studio stores and talks in inches; Pascal's scene is in meters.
export const IN = 0.0254

export const m = (inches: number) => inches * IN
export const inch = (meters: number) => meters / IN

/** 114 -> 9'-6", 30.5 -> 2'-6½" */
export function ftIn(inches: number): string {
  const sign = inches < 0 ? '-' : ''
  let v = Math.abs(inches)
  let ft = Math.floor(v / 12)
  let rest = Math.round((v - ft * 12) * 2) / 2
  if (rest >= 12) {
    ft += 1
    rest -= 12
  }
  const r = Number.isInteger(rest) ? `${rest}` : `${Math.floor(rest)}½`
  return ft ? `${sign}${ft}'-${r}"` : `${sign}${r}"`
}

export const round1 = (v: number) => Math.round(v * 10) / 10
