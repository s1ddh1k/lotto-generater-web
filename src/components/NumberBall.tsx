import type { CSSProperties } from 'react'

type NumberBallProps = {
  number: string
}

function getBackgroundColorForNumber(number: string): string {
  const integer = Number(number)

  if (integer >= 1 && integer <= 10) return '#f4cf77'
  if (integer >= 11 && integer <= 20) return '#6aa7e8'
  if (integer >= 21 && integer <= 30) return '#ff7666'
  if (integer >= 31 && integer <= 40) return '#5a5e62'
  return '#98e187'
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
