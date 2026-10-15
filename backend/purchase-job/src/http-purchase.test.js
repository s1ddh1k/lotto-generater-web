import { describe, expect, it } from 'vitest'
import { getLottoSaleWindow } from './http-purchase.js'

describe('getLottoSaleWindow', () => {
  it('closes before 06:00 in Seoul', () => {
    expect(getLottoSaleWindow(new Date('2026-08-18T15:49:00.000Z')).open).toBe(false)
  })

  it('opens at 06:00 on weekdays', () => {
    expect(getLottoSaleWindow(new Date('2026-08-18T21:00:00.000Z')).open).toBe(true)
  })

  it('closes at 20:00 on Saturdays', () => {
    expect(getLottoSaleWindow(new Date('2026-08-22T10:59:00.000Z')).open).toBe(true)
    expect(getLottoSaleWindow(new Date('2026-08-22T11:00:00.000Z')).open).toBe(false)
  })
})
