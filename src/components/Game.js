import React from "react"
import Number from "./Number.js"

export default function Game({ numbers }) {
  if (!numbers) return <></>

  return (
    <div>
      {numbers.map((n, index) => (
        <Number key={index} number={n} />
      ))}
    </div>
  )
}
