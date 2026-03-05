const MIN_NUMBER = 1
const MAX_NUMBER = 45

function padNumber(value: number): string {
  return value.toString().padStart(2, '0')
}

function isDuplicatedNumber(number: string, excludedNumbers: Set<string>, selectedNumbers: Set<string>): boolean {
  return excludedNumbers.has(number) || selectedNumbers.has(number)
}

function randomLottoNumber(): string {
  const value = Math.floor(Math.random() * (MAX_NUMBER - MIN_NUMBER + 1)) + MIN_NUMBER
  return padNumber(value)
}

export function generateOneGame(excludedNumbers: string[] = []): string[] {
  const excluded = new Set(excludedNumbers)
  const selected = new Set<string>()

  if (excluded.size > MAX_NUMBER - 6) {
    throw new Error('제외 번호가 너무 많아서 6개를 생성할 수 없습니다.')
  }

  while (selected.size < 6) {
    const candidate = randomLottoNumber()
    if (!isDuplicatedNumber(candidate, excluded, selected)) {
      selected.add(candidate)
    }
  }

  return Array.from(selected).sort((a, b) => Number(a) - Number(b))
}

export function generateGames(excludedNumbers: string[] = [], gameCount = 5): string[][] {
  return Array.from({ length: gameCount }, () => generateOneGame(excludedNumbers))
}

export function isSupportedLottoUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.hostname.endsWith('dhlottery.co.kr')
  } catch {
    return false
  }
}

export function parseNumbersFromUrl(url: string): string[] {
  const firstQIndex = url.indexOf('q')
  if (firstQIndex === -1) {
    return []
  }

  const encoded = url.slice(firstQIndex + 1).replaceAll('q', '')
  if (encoded.length < 12) {
    return []
  }

  const withoutRound = encoded.slice(0, -10)
  const pairs = withoutRound.match(/\d{2}/g) ?? []

  return pairs.filter(pair => {
    const value = Number(pair)
    return value >= MIN_NUMBER && value <= MAX_NUMBER
  })
}
