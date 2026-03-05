import { useEffect, useMemo, useRef, useState } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import GameRow from './components/GameRow'
import { generateGames, isSupportedLottoUrl, parseNumbersFromUrl } from './lib/lotto'

type GoogleCredentialResponse = {
  credential?: string
}

type GoogleIdClient = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdClient
      }
    }
  }
}

function splitArrayChunk<T>(array: T[], chunkSize: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / chunkSize) }, (_, index) => {
    const begin = index * chunkSize
    return array.slice(begin, begin + chunkSize)
  })
}

function decodeEmailFromIdToken(token: string): string {
  try {
    const payload = token.split('.')[1]
    if (!payload) return ''

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const json = atob(padded)
    const parsed = JSON.parse(json) as { email?: string }
    return typeof parsed.email === 'string' ? parsed.email : ''
  } catch {
    return ''
  }
}

function toSafeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.href
  } catch {
    return ''
  }
}

export default function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [decodedUrl, setDecodedUrl] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [excludedNumbers, setExcludedNumbers] = useState<string[]>([])
  const [generatedGames, setGeneratedGames] = useState<string[][]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false)
  const [purchaseModalNote, setPurchaseModalNote] = useState('')
  const [purchaseModalLink, setPurchaseModalLink] = useState('')
  const [googleIdToken, setGoogleIdToken] = useState('')
  const [googleUserEmail, setGoogleUserEmail] = useState('')
  const [googleAuthStatus, setGoogleAuthStatus] = useState('')
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  const autobuyEnabled = import.meta.env.VITE_ENABLE_AUTOBUY === 'true'
  const autobuyApiBase = import.meta.env.VITE_AUTOBUY_API_BASE || '/autobuy'
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

  const excludedNumberGroups = useMemo(() => splitArrayChunk(excludedNumbers, 6), [excludedNumbers])
  const generatedNumberCount = useMemo(
    () => generatedGames.reduce((count, game) => count + game.length, 0),
    [generatedGames]
  )
  const safeDecodedUrl = useMemo(() => toSafeHttpUrl(decodedUrl), [decodedUrl])

  const openPurchaseModal = (note: string, link = '') => {
    setPurchaseModalNote(note)
    setPurchaseModalLink(link)
    setPurchaseModalOpen(true)
  }

  const closePurchaseModal = () => {
    setPurchaseModalOpen(false)
    setPurchaseModalLink('')
  }

  useEffect(() => {
    if (!autobuyEnabled) return

    if (!googleClientId) {
      setGoogleAuthStatus('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.')
      return
    }

    const initializeGoogleButton = () => {
      const googleId = window.google?.accounts?.id
      if (!googleId || !googleButtonRef.current) return

      googleId.initialize({
        client_id: googleClientId,
        callback: response => {
          const token = response.credential || ''
          if (!token) {
            setGoogleAuthStatus('Google 로그인 토큰을 받지 못했습니다.')
            return
          }

          setGoogleIdToken(token)
          const email = decodeEmailFromIdToken(token)
          setGoogleUserEmail(email)
          setGoogleAuthStatus(email ? `Google 로그인 완료: ${email}` : 'Google 로그인 완료')
        }
      })

      googleButtonRef.current.innerHTML = ''
      googleId.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        logo_alignment: 'left',
        locale: 'ko'
      })
    }

    if (window.google?.accounts?.id) {
      initializeGoogleButton()
      return
    }

    const scriptId = 'google-gsi-script'
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null

    if (existing) {
      existing.addEventListener('load', initializeGoogleButton, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => initializeGoogleButton()
    script.onerror = () => {
      setGoogleAuthStatus('Google 로그인 스크립트 로드에 실패했습니다.')
    }
    document.head.appendChild(script)
  }, [autobuyEnabled, googleClientId])

  const applyLottoUrl = (value: string) => {
    const nextUrl = value.trim()
    if (!nextUrl) return

    setManualUrl(nextUrl)

    if (!isSupportedLottoUrl(nextUrl)) {
      setDecodedUrl('')
      setExcludedNumbers([])
      setGeneratedGames([])
      setErrorMessage('로또 QR코드 URL이 아닙니다.')
      return
    }

    const parsedNumbers = parseNumbersFromUrl(nextUrl)
    if (parsedNumbers.length === 0) {
      setDecodedUrl('')
      setExcludedNumbers([])
      setGeneratedGames([])
      setErrorMessage('QR URL에서 번호를 찾지 못했습니다.')
      return
    }

    try {
      setDecodedUrl(nextUrl)
      setExcludedNumbers(parsedNumbers)
      setGeneratedGames(generateGames(parsedNumbers, 1))
      setErrorMessage('')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '번호 생성 중 알 수 없는 에러가 발생했습니다.'
      setDecodedUrl('')
      setGeneratedGames([])
      setErrorMessage(message)
    }
  }

  const onScannerScan = (detectedCodes: Array<{ rawValue?: string }>) => {
    const firstCode = detectedCodes[0]?.rawValue
    if (!firstCode) return

    applyLottoUrl(firstCode)
    setShowScanner(false)
  }

  const onScannerError = (error: unknown) => {
    if (error && typeof error === 'object' && 'message' in error) {
      setErrorMessage((error as { message: string }).message)
    }
  }

  const generateWithoutExclude = () => {
    setGeneratedGames(generateGames([], 1))
    setErrorMessage('')
  }

  const logoutGoogle = () => {
    window.google?.accounts?.id?.disableAutoSelect()
    setGoogleIdToken('')
    setGoogleUserEmail('')
    setGoogleAuthStatus('Google 로그아웃 완료')
  }

  const submitPurchase = async () => {
    if (generatedGames.length === 0) {
      openPurchaseModal('생성된 번호가 없습니다.')
      return
    }

    const baseGame = generatedGames[0]
    const repeatedGames = Array.from({ length: 5 }, () => [...baseGame])
    if (!googleIdToken) {
      openPurchaseModal('Google 로그인 후 실행해 주세요.')
      return
    }

    setPurchaseLoading(true)

    try {
      const response = await fetch(`${autobuyApiBase}/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${googleIdToken}`
        },
        body: JSON.stringify({
          dryRun: false,
          games: repeatedGames.map(game => game.map(number => Number.parseInt(number, 10)))
        })
      })

      const data = (await response.json()) as {
        ok?: boolean
        error?: string
        status?: string
        worker?: { result?: { status?: string; note?: string; error?: string; trace?: string[] } }
      }

      if (!response.ok || !data?.ok) {
        console.error('[autobuy-api] purchase failed', {
          httpStatus: response.status,
          data
        })
        openPurchaseModal('구매 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      const workerResult = data.worker?.result
      if (workerResult) {
        console.log('[purchase-worker] result', workerResult)
        if (workerResult.trace && workerResult.trace.length > 0) {
          console.debug('[purchase-worker] trace', workerResult.trace)
        }
        if (workerResult.error) {
          console.error('[purchase-worker] error', workerResult.error)
        }
        const moveLink = workerResult.status === 'purchase-submitted' ? 'https://www.dhlottery.co.kr' : ''
        openPurchaseModal(workerResult.note || '구매 요청이 처리되었습니다.', moveLink)
      } else {
        console.log('[autobuy-api] purchase response', data)
        openPurchaseModal('구매 요청이 접수되었습니다.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'API 요청 중 에러가 발생했습니다.'
      console.error('[autobuy-api] purchase request error', message)
      openPurchaseModal('API 요청 중 에러가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPurchaseLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <section className="app-frame">
        <header className="hero reveal r1">
          <p className="eyebrow">Lotto For Unlucky People</p>
          <h1>로또 번호 메이커</h1>
          <p className="description">
            QR을 스캔하거나 URL을 붙여 넣어 제외 번호를 반영한 1게임 번호를 만들고, 구매 시 동일 번호 5게임으로 전송합니다.
          </p>

          <div className="stat-row">
            <span className="stat-chip">
              <strong>{excludedNumbers.length}</strong> Excluded
            </span>
            <span className="stat-chip">
              <strong>{generatedGames.length}</strong> Games
            </span>
            <span className="stat-chip">
              <strong>{generatedNumberCount}</strong> Numbers
            </span>
          </div>
        </header>

        <section className="control-panel reveal r2">
          <div className="action-row">
            <button className="btn btn-primary" type="button" onClick={() => setShowScanner(value => !value)}>
              {showScanner ? 'QR 스캐너 끄기' : 'QR 스캐너 켜기'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={generateWithoutExclude}>
              번호 1게임 생성
            </button>
          </div>

          <div className="manual-input-row">
            <input
              value={manualUrl}
              onChange={event => setManualUrl(event.target.value)}
              placeholder="QR URL을 붙여넣으세요"
              aria-label="QR URL"
            />
            <button className="btn btn-primary" type="button" onClick={() => applyLottoUrl(manualUrl)}>
              URL 적용
            </button>
          </div>

          {autobuyEnabled ? (
            <>
              <div className="purchase-row">
                <div className="purchase-auth-block">
                  <p className="section-title">Google 인증</p>
                  {googleClientId ? <div ref={googleButtonRef} /> : <p className="error-text">클라이언트 ID 미설정</p>}
                  <p className={googleUserEmail ? 'purchase-auth-email' : 'muted'}>
                    {googleUserEmail ? `로그인 계정: ${googleUserEmail}` : '로그인 필요'}
                  </p>
                </div>

                <div className="purchase-action-block">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={generatedGames.length === 0 || purchaseLoading || !googleIdToken}
                    onClick={submitPurchase}
                  >
                    {purchaseLoading ? '구매 요청 중...' : '자동구매 실행'}
                  </button>
                  {googleIdToken ? (
                    <button className="btn btn-ghost" type="button" onClick={logoutGoogle}>
                      Google 로그아웃
                    </button>
                  ) : null}
                </div>
              </div>

              {googleAuthStatus ? (
                <p className={googleUserEmail ? 'purchase-status-ok' : 'purchase-status-error'}>
                  {googleAuthStatus}
                </p>
              ) : null}
              <p className="purchase-result muted">구매 요청 시 생성 번호 1게임을 동일하게 5게임 전송합니다.</p>
            </>
          ) : null}
        </section>

        {showScanner ? (
          <section className="scanner-panel reveal r3">
            <p className="section-title">QR 스캐너</p>
            <div className="scanner-wrap">
              <Scanner
                formats={['qr_code']}
                constraints={{ facingMode: 'environment' }}
                onScan={onScannerScan}
                onError={onScannerError}
              />
            </div>
          </section>
        ) : null}

        <section className="result-grid">
          <article className="result-panel reveal r3">
            <h2>제외된 번호</h2>
            {excludedNumberGroups.length === 0 ? (
              <p className="muted">아직 제외된 번호가 없습니다.</p>
            ) : (
              excludedNumberGroups.map((numbers, index) => <GameRow key={`exclude-${index}`} numbers={numbers} />)
            )}
          </article>

          <article className="result-panel reveal r4">
            <h2>생성된 번호</h2>
            {generatedGames.length === 0 ? (
              <p className="muted">버튼을 눌러 번호를 생성해보세요.</p>
            ) : (
              generatedGames.map((numbers, index) => (
                <GameRow key={`generated-${index}`} label={`${index + 1}게임 (x5 구매)`} numbers={numbers} />
              ))
            )}
          </article>
        </section>

        <footer className="meta-row reveal r5">
          <div className="meta-item">
            <span className="meta-label">스캔/입력 URL</span>
            {safeDecodedUrl ? (
              <a href={safeDecodedUrl} target="_blank" rel="noreferrer">
                {safeDecodedUrl}
              </a>
            ) : (
              <p className="muted">없음</p>
            )}
          </div>
          <div className="meta-item">
            <span className="meta-label">상태</span>
            <p className={errorMessage ? 'error-text' : 'muted'}>{errorMessage || '정상'}</p>
          </div>
        </footer>
      </section>

      {purchaseModalOpen ? (
        <div className="result-modal-backdrop" role="presentation" onClick={closePurchaseModal}>
          <section
            className="result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <h3 id="result-modal-title">구매 결과</h3>
            <p className="result-modal-note">{purchaseModalNote}</p>
            <div className="result-modal-actions">
              {purchaseModalLink ? (
                <a className="btn btn-ghost" href={purchaseModalLink} target="_blank" rel="noreferrer">
                  동행복권 사이트로 이동
                </a>
              ) : null}
              <button className="btn btn-primary" type="button" onClick={closePurchaseModal}>
                확인
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
