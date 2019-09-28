import React from "react"
import QrReader from "react-qr-reader"
import styled from "styled-components"

const StyledScanner = styled.div`
  position: relative;
  width: 400px;
  height: 400px;
  text-align: center;
  vertical-align: middle;
  line-height: 400px;
  border-style: solid;
  border-width: 1px;
  border-color: black;
`
const StyledButton = styled.button`
  position: absolute;
  right: 0;
  bottom: 0;
  width: 100px;
  height: 20px;
  z-index: 1;
`

export default function Scanner({ show, scanInterval, onClickToggleButton, onError, onScan }) {
  let scanner = <span>QR 코드 스캐너가 꺼져있습니다.</span>
  if (show) {
    scanner = (
      <QrReader
        delay={scanInterval}
        onError={onError}
        onScan={onScan}
      />
    )
  }

  const toggleButtonLabel = show ? 'Off' : 'On'
  const toggleButton = <StyledButton onClick={onClickToggleButton}>{toggleButtonLabel}</StyledButton>

  return <StyledScanner>
    {scanner}
    {toggleButton}
  </StyledScanner>
}
