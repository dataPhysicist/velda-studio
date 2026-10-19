// Where the sun is for the lighting presets: an equinox day at the house's latitude, at a clock
// hour, turned by the plan's north setting. Returned as a unit vector toward the sun in the 3D
// frame (x east on an unrotated plan, y up, z down the sheet).
const LATITUDE = 30.5 // Tallahassee, Florida

/** Unit vector from the house toward the sun at `hour` (local solar time) on an equinox. */
export function sunDirection(hour: number, northDeg: number, latDeg = LATITUDE): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180
  const h = ((hour - 12) * 15 * Math.PI) / 180 // hour angle, negative in the morning
  // Declination 0 (equinox): altitude and azimuth (from north, clockwise).
  const alt = Math.asin(Math.cos(lat) * Math.cos(h))
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat)) + Math.PI // 0 = north, pi/2 = east
  // Plan frame: north is up the sheet (-z) turned clockwise by northDeg.
  const a = az + (northDeg * Math.PI) / 180
  const flat = Math.cos(alt)
  return [Math.sin(a) * flat, Math.sin(alt), -Math.cos(a) * flat]
}
