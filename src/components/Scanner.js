import React, { useState, useEffect } from "react"
import styled from "styled-components"

const StyledScanner = styled.div`
  position: relative;
  width: 100%;
  max-width: 400px;
  height: 400px;
  text-align: center;
  vertical-align: middle;
  line-height: 400px;
  border-style: solid;
  border-width: 1px;
  border-color: black;
`
const ToggleButton = styled.button`
  position: absolute;
  right: 0;
  bottom: 0;
  width: 100px;
  z-index: 10;
`

const GenerateButton = styled.button`
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100px;
  z-index: 10;
`

export default function Scanner({ show, scanInterval, onClickToggleButton, onClickGenerateButton, onError, onScan }) {
  let [scanner, setScanner] = useState(<div>QR 코드 스캐너가 꺼져있습니다.</div>)
  useEffect(() => {
    if (show) {
      function loadScanner() {
        const QrReader = require("react-qr-reader")
        setScanner(
          <QrReader
            delay={scanInterval}
            onError={onError}
            onScan={onScan}
          />
        )
      }
      loadScanner()
    } else {
      setScanner(<div>QR 코드 스캐너가 꺼져있습니다.</div>)
    }
  }, [show, scanInterval, onError, onScan])

  const generateButton = <GenerateButton onClick={onClickGenerateButton} className='absolute bottom-0 left-0 z-10'>그냥 생성하기</GenerateButton>

  const toggleButtonLabel = show ? 'Off' : 'On'
  const toggleButton = <ToggleButton onClick={onClickToggleButton}>{toggleButtonLabel}</ToggleButton>

  return <StyledScanner>
    {scanner}
    {generateButton}
    {toggleButton}
  </StyledScanner>
}
