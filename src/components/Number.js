import React from 'react'
import styled from "styled-components"

function getBackgroundColorForNumber(number) {
  const integer = parseInt(number)
  if (1 <= integer && 10 >= integer) {
    return "rgb(251, 196, 0)"
  }
  if (11 <= integer && 20 >= integer) {
    return "rgb(105, 200, 242)"
  }
  if (21 <= integer && 30 >= integer) {
    return "rgb(255, 114, 114)"
  }
  if (31 <= integer && 40 >= integer) {
    return "rgb(170, 170, 170)"
  }
  if (41 <= integer && 45 >= integer) {
    return "rgb(176, 216, 64)"
  }
}

const StyledNumber = styled.div`
  margin: 5px;
  display: inline-block;
  width: 40px;
  height: 40px;
  border-radius: 100%;
  line-height: 42px;
  text-align: center;
  vertical-align: middle;
  color: #fff;
  font-weight: 500;
  font-size: 20px;
  background-color: ${props => getBackgroundColorForNumber(props.number)};
`

export default function Number(props) {
  return <StyledNumber number={props.number}>{parseInt(props.number)}</StyledNumber>
}
