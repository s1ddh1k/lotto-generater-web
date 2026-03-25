import type { CSSProperties } from 'react'

type NumberBallProps = {
  number: string
}

function getBackgroundColorForNumber(number: string): string {
  const integer = Number(number)

  if (integer >= 1 && integer <= 10) return '#c7aa58'
  if (integer >= 11 && integer <= 20) return '#6484ad'
  if (integer >= 21 && integer <= 30) return '#c46e5f'
  if (integer >= 31 && integer <= 40) return '#666b73'
  return '#7f9d65'
}

export default function NumberBall({ number }: NumberBallProps) {
  const style: CSSProperties = {
    backgroundColor: getBackgroundColorForNumber(number)
  }

  return (
    <span className="number-ball" style={style}>
      {Number(number)}
    </span>
  )
}
