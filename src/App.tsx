import { useEffect, useMemo, useRef, useState } from "react"
import { Scanner } from "@yudiel/react-qr-scanner"
import GameRow from "./components/GameRow"
import {
  generateGames,
  isSupportedLottoUrl,
  parseNumbersFromUrl,
} from "./lib/lotto"
import {
  createPurchaseErrorRecord,
  derivePurchaseRecord,
  type PurchaseApiResponse,
  type PurchaseRecord,
} from "./lib/purchase"

type GoogleCredentialResponse = { credential?: string }

type GoogleIdClient = {
  initialize: (options: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }) => void
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdClient } }
  }
}

const purchaseStorageKey = "lotto-last-purchase"

function formatDateTime(value: string): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function readStoredPurchaseRecord(): PurchaseRecord | null {
  try {
    const raw = window.localStorage.getItem(purchaseStorageKey)
    return raw ? (JSON.parse(raw) as PurchaseRecord) : null
  } catch {
    return null
  }
}

export default function App() {
  const [showQrTools, setShowQrTools] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [manualUrl, setManualUrl] = useState("")
  const [excludedNumbers, setExcludedNumbers] = useState<string[]>([])
  const [generatedGames, setGeneratedGames] = useState<string[][]>(() =>
    generateGames([], 1)
  )
  const [errorMessage, setErrorMessage] = useState("")
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [googleIdToken, setGoogleIdToken] = useState("")
  const [googleAuthStatus, setGoogleAuthStatus] = useState("")
  const [latestPurchase, setLatestPurchase] = useState<PurchaseRecord | null>(null)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  const autobuyEnabled = import.meta.env.VITE_ENABLE_AUTOBUY === "true"
  const autobuyApiBase = import.meta.env.VITE_AUTOBUY_API_BASE || "/autobuy"
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ""
  const generatedGame = generatedGames[0] || []
  const repeatedGames = useMemo(
    () =>
      generatedGame.length === 6
        ? Array.from({ length: 5 }, () => [...generatedGame])
        : [],
    [generatedGame]
  )
  const canBuy = repeatedGames.length === 5 && Boolean(googleIdToken)
  const showGoogleButton = Boolean(googleClientId) && !googleIdToken

  const commitPurchaseRecord = (record: PurchaseRecord) => {
    setLatestPurchase(record)
    try {
      window.localStorage.setItem(purchaseStorageKey, JSON.stringify(record))
    } catch {
      // The current result still remains visible when storage is unavailable.
    }
  }

  useEffect(() => {
    setLatestPurchase(readStoredPurchaseRecord())
  }, [])

  useEffect(() => {
    if (!autobuyEnabled) return
    if (!googleClientId) {
      setGoogleAuthStatus("Google 로그인 설정이 없습니다.")
      return
    }
    if (!showGoogleButton) return

    const initializeGoogleButton = () => {
      const googleId = window.google?.accounts?.id
      const button = googleButtonRef.current
      if (!googleId || !button) return

      googleId.initialize({
        client_id: googleClientId,
        callback: (response) => {
          const token = response.credential || ""
          if (!token) {
            setGoogleAuthStatus("Google 로그인에 실패했습니다. 다시 시도해 주세요.")
            return
          }
          setGoogleIdToken(token)
          setGoogleAuthStatus("")
        },
      })
      button.innerHTML = ""
      googleId.renderButton(button, {
        type: "icon",
        theme: "outline",
        size: "large",
        shape: "circle",
        locale: "ko",
      })
    }

    if (window.google?.accounts?.id) {
      initializeGoogleButton()
      return
    }

    const scriptId = "google-gsi-script"
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", initializeGoogleButton, { once: true })
      return () => existing.removeEventListener("load", initializeGoogleButton)
    }

    const script = document.createElement("script")
    script.id = scriptId
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.defer = true
    script.onload = initializeGoogleButton
    script.onerror = () =>
      setGoogleAuthStatus("Google 로그인을 불러오지 못했습니다.")
    document.head.appendChild(script)
  }, [autobuyEnabled, googleClientId, showGoogleButton])

  const createNewNumber = (excluded: string[] = excludedNumbers) => {
    try {
      setGeneratedGames(generateGames(excluded, 1))
      setErrorMessage("")
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "번호를 만들지 못했습니다."
      )
    }
  }

  const applyLottoUrl = (value: string) => {
    const url = value.trim()
    if (!url) return
    if (!isSupportedLottoUrl(url)) {
      setErrorMessage("동행복권 QR 주소만 사용할 수 있습니다.")
      return
    }

    const numbers = parseNumbersFromUrl(url)
    if (numbers.length === 0) {
      setErrorMessage("QR 주소에서 번호를 찾지 못했습니다.")
      return
    }

    setManualUrl(url)
    setExcludedNumbers(numbers)
    createNewNumber(numbers)
    setShowScanner(false)
    setShowQrTools(false)
  }

  const logoutGoogle = () => {
    window.google?.accounts?.id?.disableAutoSelect()
    setGoogleIdToken("")
    setGoogleAuthStatus("")
  }

  const submitPurchase = async () => {
    if (!canBuy || purchaseLoading) return

    const requestedAt = new Date().toISOString()
    setPurchaseLoading(true)
    setErrorMessage("")

    try {
      const response = await fetch(`${autobuyApiBase}/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${googleIdToken}`,
        },
        body: JSON.stringify({
          dryRun: false,
          games: repeatedGames.map((game) => game.map(Number)),
        }),
      })
      const rawBody = await response.text()
      let data: PurchaseApiResponse

      try {
        data = rawBody ? (JSON.parse(rawBody) as PurchaseApiResponse) : {}
      } catch {
        data = {
          ok: false,
          error: `서버 응답을 읽지 못했습니다. (HTTP ${response.status})`,
        }
      }

      if (!response.ok) {
        data = {
          ...data,
          ok: false,
          status: "failed",
          error:
            data.error ||
            `구매 요청에 실패했습니다. (HTTP ${response.status})`,
        }
      }

      const record = derivePurchaseRecord(data, {
        requestedAt,
        fallbackGames: repeatedGames,
      })
      commitPurchaseRecord(record)
      if (response.status === 401) {
        setGoogleIdToken("")
        setGoogleAuthStatus("로그인 시간이 만료됐습니다. 다시 로그인해 주세요.")
      }
      if (!response.ok && !record.error) {
        setErrorMessage(`구매 요청에 실패했습니다. (HTTP ${response.status})`)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "구매 서버에 연결하지 못했습니다."
      commitPurchaseRecord(
        createPurchaseErrorRecord(message, {
          requestedAt,
          fallbackGames: repeatedGames,
        })
      )
    } finally {
      setPurchaseLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="nav-min" aria-label="서비스와 로그인 상태">
          <span className="wordmark" aria-label="로또 6/45">6/45</span>
          {googleIdToken ? (
            <div className="account-actions">
              <span className="account-state">Gmail 로그인됨</span>
              <button className="nav-action" type="button" onClick={logoutGoogle}>로그아웃</button>
            </div>
          ) : <span className="account-state">로그인 전</span>}
        </header>

        <div className="workbench-shell">
          <section className="purchase-document" aria-labelledby="purchase-title">
            <header className="document-intro">
              <h1 id="purchase-title">로또 자동구매</h1>
              <p>번호를 확인하고 같은 조합으로 5게임을 구매합니다.</p>
            </header>

            <dl className="purchase-spec" aria-label="구매 조건">
              <div><dt>게임</dt><dd>5게임</dd></div>
              <div><dt>금액</dt><dd>5,000원</dd></div>
              <div><dt>방식</dt><dd>동일 번호</dd></div>
            </dl>

            <section className="number-pane" aria-labelledby="number-title">
            <header className="number-head">
              <h2 id="number-title">구매할 번호</h2>
              {excludedNumbers.length > 0 ? (
                <span className="filter-note">제외 {excludedNumbers.length}개</span>
              ) : <span className="filter-note">제외 번호 없음</span>}
            </header>

            <div className="hero-numbers" aria-live="polite">
              <GameRow numbers={generatedGame} />
            </div>

            <div className="main-actions">
              <button className="btn btn-secondary" type="button" onClick={() => createNewNumber()}>
                번호 다시 뽑기
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                aria-expanded={showQrTools}
                onClick={() => setShowQrTools((shown) => !shown)}
              >
                제외 번호 설정
              </button>
            </div>

            {showQrTools ? (
              <div className="qr-tools">
                <form
                  className="url-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    applyLottoUrl(manualUrl)
                  }}
                >
                  <label htmlFor="lotto-qr-url">동행복권 QR 주소</label>
                  <div className="input-row">
                    <input
                      id="lotto-qr-url"
                      value={manualUrl}
                      onChange={(event) => setManualUrl(event.target.value)}
                      placeholder="https://m.dhlottery.co.kr/…"
                      aria-describedby={
                        errorMessage === "동행복권 QR 주소만 사용할 수 있습니다."
                          ? "lotto-qr-help purchase-error"
                          : "lotto-qr-help"
                      }
                      aria-invalid={
                        errorMessage === "동행복권 QR 주소만 사용할 수 있습니다."
                      }
                    />
                    <button className="btn btn-secondary" type="submit">적용</button>
                  </div>
                  <p id="lotto-qr-help" className="field-help">이전에 구매한 QR 번호를 이번 추첨에서 제외합니다.</p>
                </form>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setShowScanner((shown) => !shown)}
                >
                  {showScanner ? "카메라 닫기" : "카메라로 스캔"}
                </button>
                {showScanner ? (
                  <div className="scanner-wrap">
                    <Scanner
                      formats={["qr_code"]}
                      constraints={{ facingMode: "environment" }}
                      onScan={(codes) => {
                        const value = codes[0]?.rawValue
                        if (value) applyLottoUrl(value)
                      }}
                      onError={(error) =>
                        setErrorMessage(
                          error instanceof Error ? error.message : "카메라를 사용할 수 없습니다."
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {errorMessage ? <p id="purchase-error" className="inline-error" role="alert">{errorMessage}</p> : null}

            {autobuyEnabled ? (
              <div className="buy-area">
                {!googleIdToken ? (
                  <div className="signin-row">
                    <div>
                      <strong>Gmail로 로그인</strong>
                      <p>로그인한 계정 주소는 화면에 표시하지 않습니다.</p>
                    </div>
                    {showGoogleButton ? <div ref={googleButtonRef} /> : null}
                    {googleAuthStatus ? <p className="inline-error">{googleAuthStatus}</p> : null}
                  </div>
                ) : null}
                <button
                  className="btn btn-buy"
                  type="button"
                  data-state={purchaseLoading ? "loading" : "default"}
                  aria-busy={purchaseLoading}
                  disabled={!canBuy || purchaseLoading}
                  onClick={submitPurchase}
                >
                  {purchaseLoading ? "구매 요청 확인 중…" : "5,000원 구매"}
                </button>
                <p className="buy-note">
                  {!googleIdToken
                    ? "로그인하면 구매 버튼이 활성화됩니다."
                    : purchaseLoading
                      ? "동행복권의 최종 결과를 기다리고 있습니다."
                      : "동일 번호 5게임을 동행복권에 전송합니다."}
                </p>
              </div>
            ) : null}
            </section>
          </section>

          {autobuyEnabled && latestPurchase ? (
            <section className={`result-panel result-${latestPurchase.tone}`} aria-live="polite">
              <div className="result-summary">
                <div>
                  <h2>{latestPurchase.title}</h2>
                  <p className="result-message">{latestPurchase.message}</p>
                </div>
                <span className="result-badge">{latestPurchase.statusLabel}</span>
              </div>
              {latestPurchase.submittedGames[0] ? (
                <div className="result-number">
                  <GameRow numbers={latestPurchase.submittedGames[0]} />
                  <span>{latestPurchase.submittedGames.length}게임</span>
                </div>
              ) : null}
              <div className="result-actions">
                {latestPurchase.link ? (
                  <a className="text-link" href={latestPurchase.link} target="_blank" rel="noreferrer">
                    동행복권 구매 내역 확인
                  </a>
                ) : null}
                <details className="result-details">
                  <summary>상세 정보</summary>
                  <dl>
                    <div><dt>요청 시각</dt><dd>{formatDateTime(latestPurchase.requestedAt)}</dd></div>
                    <div><dt>실행 시각</dt><dd>{formatDateTime(latestPurchase.executedAt)}</dd></div>
                    <div><dt>요청 ID</dt><dd>{latestPurchase.requestId || "-"}</dd></div>
                  </dl>
                  {latestPurchase.trace.length > 0 ? (
                    <pre>{latestPurchase.trace.join("\n")}</pre>
                  ) : null}
                </details>
              </div>
            </section>
          ) : null}

          <footer className="foot-mast">
            <span className="wordmark">6/45</span>
            <p>번호를 확인하고 구매하세요.</p>
          </footer>
        </div>
      </div>
    </main>
  )
}
