import React from 'react'
import styled from "styled-components"

function getBackgroundColorForNumber(number) {
  const integer = parseInt(number)
  if (1 <= integer && 10 >= integer) {
    return "#f4cf77"
  }
  if (11 <= integer && 20 >= integer) {
    return "#6aa7e8"
  }
  if (21 <= integer && 30 >= integer) {
    return "#ff7666"
  }
  if (31 <= integer && 40 >= integer) {
    return "#5a5e62"
  }
  if (41 <= integer && 45 >= integer) {
    return "#98e187"
  }
}

const StyledNumber = styled.div`
  margin: 2px;
  display: inline-block;
  width: 30px;
  height: 30px;
  border-radius: 100%;
  line-height: 32px;
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
