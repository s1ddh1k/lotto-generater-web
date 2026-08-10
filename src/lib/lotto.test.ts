import { describe, expect, it } from 'vitest'
import { generateGames, generateOneGame, parseNumbersFromUrl } from './lotto'

describe('generateOneGame', () => {
  it('returns 6 unique numbers in valid range', () => {
    const numbers = generateOneGame([])

    expect(numbers).toHaveLength(6)
    expect(new Set(numbers).size).toBe(6)
    for (const number of numbers) {
      expect(Number(number)).toBeGreaterThanOrEqual(1)
      expect(Number(number)).toBeLessThanOrEqual(45)
    }
  })

  it('does not include excluded numbers', () => {
    const excluded = ['01', '02', '03', '04', '05', '06']
    const numbers = generateOneGame(excluded)

    for (const number of numbers) {
      expect(excluded).not.toContain(number)
    }
  })
})

describe('generateGames', () => {
  it('returns requested number of games', () => {
    const games = generateGames([], 5)
    expect(games).toHaveLength(5)
    for (const game of games) {
      expect(game).toHaveLength(6)
    }
  })
})

describe('parseNumbersFromUrl', () => {
  it('parses encoded numbers from lottery qr url payload', () => {
    const url = 'https://m.dhlottery.co.kr/?v=0000q010203040506q0708091011121234567890'
    expect(parseNumbersFromUrl(url)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
      '12'
    ])
  })

  it('returns empty array for unsupported payload', () => {
    expect(parseNumbersFromUrl('https://example.com')).toEqual([])
  })
})
