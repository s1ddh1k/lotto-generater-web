import { describe, expect, it } from 'vitest'
import { generateOneGame } from './lotto'

describe('generateOneGame', () => {
  it('always returns six distinct, sorted numbers between 1 and 45', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const numbers = generateOneGame()
      expect(numbers).toHaveLength(6)
      expect(new Set(numbers).size).toBe(6)
      expect(numbers).toEqual([...numbers].sort((a, b) => Number(a) - Number(b)))
      for (const number of numbers) {
        expect(number).toMatch(/^\d{2}$/)
        expect(Number(number)).toBeGreaterThanOrEqual(1)
        expect(Number(number)).toBeLessThanOrEqual(45)
      }
    }
  })

  it('generates more than one combination across repeated draws', () => {
    const combinations = new Set(Array.from({ length: 20 }, () => generateOneGame().join(',')))
    expect(combinations.size).toBeGreaterThan(1)
  })
})
