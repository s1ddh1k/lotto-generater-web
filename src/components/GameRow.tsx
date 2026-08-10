import NumberBall from './NumberBall'

type GameRowProps = {
  numbers: string[]
  label?: string
}

export default function GameRow({ numbers, label }: GameRowProps) {
  return (
    <div className="game-row">
      {label ? <p className="game-label">{label}</p> : null}
      <div className="game-numbers">
        {numbers.map(number => (
          <NumberBall key={`${label ?? 'n'}-${number}`} number={number} />
        ))}
      </div>
    </div>
  )
}
