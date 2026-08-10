type NumberBallProps = {
  number: string
}

function getToneClass(number: string): string {
  const integer = Number(number)

  if (integer >= 1 && integer <= 10) return 'ball-range-1'
  if (integer >= 11 && integer <= 20) return 'ball-range-2'
  if (integer >= 21 && integer <= 30) return 'ball-range-3'
  if (integer >= 31 && integer <= 40) return 'ball-range-4'
  return 'ball-range-5'
}

export default function NumberBall({ number }: NumberBallProps) {
  return (
    <span className={`number-ball ${getToneClass(number)}`}>
      {Number(number)}
    </span>
  )
}
