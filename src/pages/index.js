import React, { useState } from 'react'
import styled from 'styled-components'
import { parseNumbersFromUrl, generateFiveGame } from '../components/lotto.js'
import Scanner from '../components/Scanner.js'
import Game from '../components/Game.js'

const DH_LOTTERY_URL = 'http://m.dhlottery.co.kr'

const StyledApp = styled.div`
  display: grid;
`

function splitArrayChunk(array, chunkSize) {  
  return Array(Math.ceil(array.length / chunkSize))
    .fill()
    .map((_, index) => index * chunkSize)
    .map(begin => array.slice(begin, begin + chunkSize))
}

export default function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [decodedUrl, setDecodedUrl] = useState('')
  const [excludedNumbers, setExcludedNumbers] = useState([])
  const [generatedNumbers, setGeneratedNumbers] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  const onScan = decodedUrl => {
    if (!decodedUrl) return

    setDecodedUrl(decodedUrl)
    setShowScanner(false)

    if (!decodedUrl.startsWith(DH_LOTTERY_URL)) {
      setExcludedNumbers([])
      setGeneratedNumbers([])
      setErrorMessage('로또 QR코드가 아닙니다')
      return
    }

    const excludedNumbers = parseNumbersFromUrl(decodedUrl)
    setExcludedNumbers(excludedNumbers)

    const generatedNumbers = generateFiveGame(excludedNumbers)
    setGeneratedNumbers(generatedNumbers)
  }

  const onError = error => {
    setErrorMessage(error.message)
  }

  const toggleShowScanner = () => {
    setShowScanner(!showScanner)
  }

  return (
    <StyledApp>
      <Scanner
        show={showScanner}
        onClickToggleButton={toggleShowScanner}
        onScan={onScan}
        onError={onError}
      />
      <div>
        제외된 번호
        {splitArrayChunk(excludedNumbers, 6).map((numbers, index) => (
          <Game key={index} numbers={numbers} />
        ))}
      </div>
      <div>
        생성된 번호
        {splitArrayChunk(generatedNumbers, 6).map((numbers, index) => (
          <Game key={index} numbers={numbers} />
        ))}
      </div>
      <div>스캔된 QR코드 문자열: <a href={decodedUrl}>{decodedUrl}</a></div>
      <div>에러 메시지: {errorMessage}</div>
    </StyledApp>
  )
}
