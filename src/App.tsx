import { useCallback, useRef, useState } from 'react'
import GameRow from './components/GameRow'
import LoginDialog from './components/LoginDialog'
import { generateOneGame } from './lib/lotto'
import { derivePurchaseRecord, type PurchaseApiResponse, type PurchaseRecord } from './lib/purchase'

const gameCount = 5
const purchaseEnabled = import.meta.env.VITE_ENABLE_AUTOBUY === 'true'
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const purchaseApiBase = (import.meta.env.VITE_AUTOBUY_API_BASE || '/autobuy').replace(/\/$/, '')

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
}

function purchaseMessage(record: PurchaseRecord): string {
  switch (record.statusCode) {
    case 'purchase-submitted': return '선택한 번호로 5게임을 구매했어요. 동행복권에서 구매 내역을 확인할 수 있어요.'
    case 'queued': return '구매 요청을 접수했어요. 추가 구매 전에 동행복권에서 내역을 확인해 주세요.'
    case 'insufficient-balance': return '동행복권 예치금이 부족해요. 충전한 뒤 다시 시도해 주세요.'
    case 'limit-exceeded': return '이번 주 구매 한도를 초과했어요. 동행복권에서 구매 내역을 확인해 주세요.'
    case 'sale-closed': return '현재는 구매할 수 없는 시간이에요. 판매 시간에 다시 시도해 주세요.'
    case 'ready-for-final-confirm':
    case 'skipped': return '현재 구매 연결을 확인 중이에요. 실제 구매는 진행되지 않았어요.'
    case 'dry-run-complete': return '구매 연결을 확인했어요. 실제 구매는 진행되지 않았어요.'
    case 'blocked': return '구매를 진행할 수 없어요. 동행복권에서 계정 상태를 확인해 주세요.'
    case 'failed': return '구매를 완료하지 못했어요. 동행복권에서 내역을 확인한 뒤 다시 시도해 주세요.'
    default: return '구매 결과를 확인하지 못했어요. 중복 구매를 피하려면 동행복권 구매 내역을 먼저 확인해 주세요.'
  }
}

export default function App() {
  const [token, setToken] = useState('')
  const [numbers, setNumbers] = useState<string[]>([])
  const [loginOpen, setLoginOpen] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [result, setResult] = useState<PurchaseRecord | null>(null)
  const [purchaseLocked, setPurchaseLocked] = useState(false)
  const purchaseInFlight = useRef(false)

  const handleSignIn = useCallback((credential: string) => {
    setToken(credential)
    setAuthMessage('')
    setNumbers(current => current.length === 6 ? current : generateOneGame())
    setLoginOpen(false)
  }, [])

  const logout = () => {
    if (purchaseInFlight.current) return
    window.google?.accounts?.id?.disableAutoSelect()
    setToken('')
    setNumbers([])
    setResult(null)
    setPurchaseLocked(false)
    setAuthMessage('')
  }

  const regenerate = () => {
    if (!token || purchaseInFlight.current) return
    setNumbers(generateOneGame())
    setPurchaseLocked(false)
  }

  const submitPurchase = async () => {
    if (!token || !purchaseEnabled || numbers.length !== 6 || purchaseInFlight.current || purchaseLocked) return

    purchaseInFlight.current = true
    setPurchaseLoading(true)
    setResult(null)
    const games = Array.from({ length: gameCount }, () => [...numbers])
    const options = { requestedAt: new Date().toISOString(), fallbackGames: games }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 260_000)

    try {
      const response = await fetch(`${purchaseApiBase}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dryRun: false, games: games.map(game => game.map(Number)) }),
        signal: controller.signal,
      })
      const rawBody = await response.text()
      let data: PurchaseApiResponse = {}
      try {
        const parsed: unknown = JSON.parse(rawBody)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          data = parsed as PurchaseApiResponse
        }
      } catch {
        // An unreadable response cannot establish whether the purchase went through.
      }

      if (response.status === 401) {
        setToken('')
        setAuthMessage('로그인 시간이 만료됐어요. 다시 로그인해 주세요.')
        setLoginOpen(true)
        return
      }

      if (response.status >= 500) {
        setResult(derivePurchaseRecord({ status: 'verification-needed' }, options))
        setPurchaseLocked(true)
        return
      }

      if (!response.ok) {
        data = { ...data, ok: false, status: 'failed' }
        if (response.status === 403) {
          setAuthMessage('이 계정은 구매 권한이 없어요. 허용된 Google 계정으로 로그인해 주세요.')
          setToken('')
          setLoginOpen(true)
          return
        }
      }

      const record = derivePurchaseRecord(data, options)
      setResult(record)
      setPurchaseLocked(record.tone !== 'error')
    } catch {
      setResult(derivePurchaseRecord({ status: 'verification-needed' }, options))
      setPurchaseLocked(true)
    } finally {
      window.clearTimeout(timeout)
      purchaseInFlight.current = false
      setPurchaseLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header" aria-label="서비스와 계정">
        <a className="brand" href="/" aria-label="로또 6/45 홈">
          <span className="brand-symbol" aria-hidden="true"><span /><span /><span /><span /></span>
          <span className="wordmark">6/45<span className="brand-dot">.</span></span>
        </a>
        {token ? (
          <div className="account-actions">
            <span className="account-state"><span aria-hidden="true" />로그인됨</span>
            <button className="header-action" type="button" onClick={logout} disabled={purchaseLoading}>로그아웃</button>
          </div>
        ) : (
          <button className="header-action" type="button" onClick={() => setLoginOpen(true)} aria-haspopup="dialog">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="6.5" r="3" /><path d="M4 17v-1a6 6 0 0 1 12 0v1" /></svg>
            로그인
          </button>
        )}
      </header>

      <main className="main-content">
        <header className="page-intro">
          <h1>번호 뽑고, <span>바로 구매.</span></h1>
          <p>고민은 줄이고, 행운은 가볍게.<br />랜덤 번호로 모바일에서도 간편하게.</p>
        </header>

        <section className="lotto-ticket" aria-labelledby="ticket-title">
          <div className="ticket-heading">
            <h2 id="ticket-title">나의 행운 번호</h2>
            <span className="ticket-type">로또 6/45</span>
          </div>

          <div className={`number-stage${token ? '' : ' number-stage-empty'}`}>
            <div className="number-display" role="status" aria-label="생성한 로또 번호">
              {token && numbers.length === 6 ? (
                <GameRow key={numbers.join('-')} numbers={numbers} />
              ) : (
                <div className="number-placeholders" aria-label="로그인 후 번호가 생성됩니다">
                  {Array.from({ length: 6 }, (_, index) => <span className="number-placeholder" key={index} aria-hidden="true">?</span>)}
                </div>
              )}
            </div>
            {token ? (
              <button className="regenerate-button" type="button" onClick={regenerate} disabled={purchaseLoading}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16.5 8A6.7 6.7 0 1 0 17 12M16.5 3.5V8H12" /></svg>
                다시 뽑기
              </button>
            ) : <p className="number-hint">로그인하면 행운 번호를 뽑아드려요.</p>}
          </div>

          <div className="ticket-checkout">
            <div className="order-summary">
              <div><span className="order-label">동일 번호 5게임</span><span className="order-description">1게임 1,000원</span></div>
              <strong className="order-total">5,000<span>원</span></strong>
            </div>

            {token ? (
              <button
                className="primary-button"
                type="button"
                onClick={submitPurchase}
                disabled={!purchaseEnabled || purchaseLoading || purchaseLocked}
                aria-busy={purchaseLoading}
                data-state={purchaseLoading ? 'loading' : purchaseLocked ? result?.tone === 'success' ? 'success' : 'pending' : 'default'}
              >
                {purchaseLoading ? <><span className="spinner" aria-hidden="true" />구매 요청 확인 중</>
                  : purchaseLocked ? <>{result?.statusCode === 'purchase-submitted' ? '구매 완료' : '구매 내역을 확인해 주세요'}{result?.tone === 'success' ? <span aria-hidden="true">✓</span> : <ArrowIcon />}</>
                  : <>5,000원 구매하기<ArrowIcon /></>}
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={() => setLoginOpen(true)} aria-haspopup="dialog">
                로그인하고 번호 뽑기<ArrowIcon />
              </button>
            )}
            <p className="checkout-note" role="status">
              {purchaseLoading ? '결과를 확인하고 있어요. 잠시만 기다려 주세요.'
                : token && !purchaseEnabled ? '현재 구매 기능을 사용할 수 없어요.'
                : purchaseLocked ? '새 번호를 뽑으면 다시 구매할 수 있어요.'
                : '선택한 번호로 동일한 5게임을 구매해요.'}
            </p>
          </div>
        </section>

        {token && result ? (
          <section className={`purchase-result result-${result.tone}`} role="status" aria-labelledby="result-title">
            <div className="result-heading">
              <span className="result-icon" aria-hidden="true">{result.tone === 'success' ? '✓' : result.tone === 'error' ? '!' : 'i'}</span>
              <h2 id="result-title">{result.title}</h2>
            </div>
            <p>{purchaseMessage(result)}</p>
            {result.submittedGames[0] ? <div className="result-numbers"><span>요청한 번호</span><GameRow numbers={result.submittedGames[0]} /></div> : null}
            <a className="result-link" href="https://www.dhlottery.co.kr" target="_blank" rel="noreferrer">동행복권에서 확인<ArrowIcon /></a>
          </section>
        ) : null}

        <footer className="page-footer"><span>6/45</span><span>오늘의 선택에, 작은 행운을.</span></footer>
      </main>

      {loginOpen ? <LoginDialog clientId={googleClientId} message={authMessage} onSignIn={handleSignIn} onClose={() => setLoginOpen(false)} /> : null}
    </div>
  )
}
