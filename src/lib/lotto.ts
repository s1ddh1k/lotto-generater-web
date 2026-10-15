export function generateOneGame(): string[] {
  const available = Array.from({ length: 45 }, (_, index) => index + 1)
  const selected: number[] = []

  for (let index = 0; index < 6; index += 1) {
    const position = Math.floor(Math.random() * available.length)
    selected.push(available.splice(position, 1)[0])
  }

  return selected.sort((a, b) => a - b).map(number => String(number).padStart(2, '0'))
}
