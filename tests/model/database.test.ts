import { describe, expect, it } from 'vitest'
import { DEV_DB, LIVE_DB, resolveDb } from '../../src/toolbelt'

describe('which workspace database a build uses', () => {
  it('uses the test copy unless the build or the page says otherwise', () => {
    expect(resolveDb('', undefined)).toBe(DEV_DB)
    expect(resolveDb('', LIVE_DB)).toBe(LIVE_DB)
    expect(resolveDb('?db=velda_studio.duckdb', DEV_DB)).toBe(LIVE_DB)
  })
  it('ignores a ?db= value that is not a plain database file name', () => {
    expect(resolveDb("?db=x.duckdb'; DROP TABLE schemes;--", DEV_DB)).toBe(DEV_DB)
    expect(resolveDb('?db=../velda3d.duckdb', DEV_DB)).toBe(DEV_DB)
  })
})
