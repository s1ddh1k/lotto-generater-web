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

type GoogleCredentialResponse = {
  credential?: string
}

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
    google?: {
      accounts?: {
        id?: GoogleIdClient
      }
    }
  }
}

function splitArrayChunk<T>(array: T[], chunkSize: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / chunkSize) },
    (_, index) => {
      const begin = index * chunkSize
      return array.slice(begin, begin + chunkSize)
    }
  )
}

function decodeEmailFromIdToken(token: string): string {
  try {
    const payload = token.split(".")[1]
    if (!payload) return ""

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const json = atob(padded)
    const parsed = JSON.parse(json) as { email?: string }
    return typeof parsed.email === "string" ? parsed.email : ""
  } catch {
    return ""
  }
}

function toSafeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    return url.href
  } catch {
    return ""
  }
}

const purchaseStorageKey = "lotto-last-purchase"

function formatDateTime(value: string): string {
  if (!value) return "-"

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed)
}

function readStoredPurchaseRecord(): PurchaseRecord | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(purchaseStorageKey)
    if (!raw) return null
    return JSON.parse(raw) as PurchaseRecord
  } catch {
    return null
  }
}

function areSameGames(left: string[][], right: string[][]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export default function App() {
  const [showScanner, setShowScanner] = useState(false)
  const [decodedUrl, setDecodedUrl] = useState("")
  const [manualUrl, setManualUrl] = useState("")
  const [excludedNumbers, setExcludedNumbers] = useState<string[]>([])
  const [generatedGames, setGeneratedGames] = useState<string[][]>([])
  const [errorMessage, setErrorMessage] = useState("")
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [purchaseStartedAt, setPurchaseStartedAt] = useState("")
  const [googleIdToken, setGoogleIdToken] = useState("")
  const [googleUserEmail, setGoogleUserEmail] = useState("")
  const [googleAuthStatus, setGoogleAuthStatus] = useState("")
  const [latestPurchase, setLatestPurchase] = useState<PurchaseRecord | null>(
    null
  )
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  const autobuyEnabled = import.meta.env.VITE_ENABLE_AUTOBUY === "true"
  const autobuyApiBase = import.meta.env.VITE_AUTOBUY_API_BASE || "/autobuy"
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ""

  const excludedNumberGroups = useMemo(
    () => splitArrayChunk(excludedNumbers, 6),
    [excludedNumbers]
  )
  const repeatedGames = useMemo(
    () =>
      generatedGames[0]
        ? Array.from({ length: 5 }, () => [...generatedGames[0]])
        : [],
    [generatedGames]
  )
  const safeDecodedUrl = useMemo(() => toSafeHttpUrl(decodedUrl), [decodedUrl])
  const showObservedGames = useMemo(() => {
    if (!latestPurchase) return false
    if (latestPurchase.observedGames.length === 0) return false
    return !areSameGames(
      latestPurchase.submittedGames,
      latestPurchase.observedGames
    )
  }, [latestPurchase])

  const hasSummary = purchaseLoading || Boolean(latestPurchase)
  const summaryTone = purchaseLoading ? "info" : latestPurchase?.tone || "info"
  const summaryTitle = purchaseLoading
    ? "자동구매 전송 중"
    : latestPurchase?.title || "최근 기록이 없습니다"
  const summaryMessage = purchaseLoading
    ? "번호 1게임을 5회 전송하고 응답을 기다리는 중입니다."
    : latestPurchase?.message || "실행하면 결과와 전송 번호가 여기에 남습니다."
  const summaryStatusLabel = purchaseLoading
    ? "진행 중"
    : latestPurchase?.statusLabel || ""
  const summaryRequestedAt = purchaseLoading
    ? purchaseStartedAt
    : latestPurchase?.requestedAt || ""
  const summaryExecutedAt = purchaseLoading
    ? ""
    : latestPurchase?.executedAt || ""
  const summaryRequestId = purchaseLoading
    ? ""
    : latestPurchase?.requestId || ""
  const summaryActor = purchaseLoading
    ? googleUserEmail
    : latestPurchase?.actor || googleUserEmail
  const summarySubmittedGames = purchaseLoading
    ? repeatedGames
    : latestPurchase?.submittedGames || []
  const summaryObservedGames =
    purchaseLoading || !latestPurchase ? [] : latestPurchase.observedGames
  const summaryTrace =
    purchaseLoading || !latestPurchase ? [] : latestPurchase.trace
  const summaryLink =
    purchaseLoading || !latestPurchase ? "" : latestPurchase.link
  const summaryBlockerSource =
    purchaseLoading || !latestPurchase ? "" : latestPurchase.blockerSource
  const headerStatus =
    errorMessage ||
    (safeDecodedUrl ? "제외 번호를 반영했습니다." : "번호를 준비해 주세요.")
  const hasPreparedNumbers = generatedGames.length > 0
  const canSubmitPurchase = repeatedGames.length > 0 && Boolean(googleIdToken)
  const accountStatusTone = !googleClientId
    ? "error"
    : googleIdToken
      ? "success"
      : "warning"
  const accountStatusLabel = !googleClientId
    ? "설정 필요"
    : googleIdToken
      ? "확인됨"
      : "로그인 필요"
  const showGoogleSigninButton = Boolean(googleClientId) && !googleIdToken
  const accountIdentityLabel =
    googleUserEmail || (googleIdToken ? "로그인됨" : "")
  const accountSupportText = googleIdToken
    ? ""
    : googleAuthStatus || "로그인하면 바로 실행할 수 있습니다."
  const buyStatusTone = purchaseLoading
    ? "info"
    : canSubmitPurchase
      ? "success"
      : "warning"
  const buyStatusLabel = purchaseLoading
    ? "전송 중"
    : canSubmitPurchase
      ? "준비 완료"
      : hasPreparedNumbers
        ? "로그인 필요"
        : "번호 필요"
  const buyStatusMessage = purchaseLoading
    ? "동행복권으로 전송 중입니다."
    : canSubmitPurchase
      ? "번호와 계정이 준비됐습니다. 지금 바로 보낼 수 있습니다."
      : hasPreparedNumbers
        ? "로그인하면 바로 전송할 수 있습니다."
        : "먼저 번호를 준비해 주세요."

  const commitPurchaseRecord = (record: PurchaseRecord) => {
    setLatestPurchase(record)

    try {
      window.localStorage.setItem(purchaseStorageKey, JSON.stringify(record))
    } catch {
      // Ignore storage failures and keep in-memory state only.
    }
  }

  useEffect(() => {
    setLatestPurchase(readStoredPurchaseRecord())
  }, [])

  useEffect(() => {
    if (!autobuyEnabled) return

    if (!googleClientId) {
      setGoogleAuthStatus("Google 클라이언트 ID가 설정되지 않았습니다.")
      return
    }

    const initializeGoogleButton = () => {
      const googleId = window.google?.accounts?.id
      if (!googleId || !googleButtonRef.current) return

      googleId.initialize({
        client_id: googleClientId,
        callback: (response) => {
          const token = response.credential || ""
          if (!token) {
            setGoogleAuthStatus("Google 로그인 토큰을 받지 못했습니다.")
            return
          }

          setGoogleIdToken(token)
          const email = decodeEmailFromIdToken(token)
          setGoogleUserEmail(email)
          setGoogleAuthStatus("")
        },
      })

      googleButtonRef.current.innerHTML = ""
      googleId.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "medium",
        text: "signin_with",
        shape: "pill",
        logo_alignment: "left",
        locale: "ko",
      })
    }

    if (window.google?.accounts?.id) {
      initializeGoogleButton()
      return
    }

    const scriptId = "google-gsi-script"
    const existing = document.getElementById(
      scriptId
    ) as HTMLScriptElement | null

    if (existing) {
      existing.addEventListener("load", initializeGoogleButton, { once: true })
      return
    }

    const script = document.createElement("script")
    script.id = scriptId
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.defer = true
    script.onload = () => initializeGoogleButton()
    script.onerror = () => {
      setGoogleAuthStatus("Google 로그인 스크립트를 불러오지 못했습니다.")
    }
    document.head.appendChild(script)
  }, [autobuyEnabled, googleClientId, googleIdToken])

  const applyLottoUrl = (value: string) => {
    const nextUrl = value.trim()
    if (!nextUrl) return

    setManualUrl(nextUrl)

    if (!isSupportedLottoUrl(nextUrl)) {
      setDecodedUrl("")
      setExcludedNumbers([])
      setGeneratedGames([])
      setErrorMessage("동행복권 QR URL만 읽을 수 있습니다.")
      return
    }

    const parsedNumbers = parseNumbersFromUrl(nextUrl)
    if (parsedNumbers.length === 0) {
      setDecodedUrl("")
      setExcludedNumbers([])
      setGeneratedGames([])
      setErrorMessage("URL에서 제외 번호를 찾지 못했습니다.")
      return
    }

    try {
      setDecodedUrl(nextUrl)
      setExcludedNumbers(parsedNumbers)
      setGeneratedGames(generateGames(parsedNumbers, 1))
      setErrorMessage("")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "번호 생성 중 오류가 발생했습니다."
      setDecodedUrl("")
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
    if (error && typeof error === "object" && "message" in error) {
      setErrorMessage((error as { message: string }).message)
    }
  }

  const generateWithoutExclude = () => {
    setGeneratedGames(generateGames([], 1))
    setErrorMessage("")
  }

  const logoutGoogle = () => {
    window.google?.accounts?.id?.disableAutoSelect()
    setGoogleIdToken("")
    setGoogleUserEmail("")
    setGoogleAuthStatus("")
  }

  const submitPurchase = async () => {
    if (repeatedGames.length === 0 || !googleIdToken) return

    const requestedAt = new Date().toISOString()
    setPurchaseStartedAt(requestedAt)
    setPurchaseLoading(true)

    try {
      const response = await fetch(`${autobuyApiBase}/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${googleIdToken}`,
        },
        body: JSON.stringify({
          dryRun: false,
          games: repeatedGames.map((game) =>
            game.map((number) => Number.parseInt(number, 10))
          ),
        }),
      })

      const rawBody = await response.text()
      let data: PurchaseApiResponse

      try {
        data = rawBody ? (JSON.parse(rawBody) as PurchaseApiResponse) : {}
      } catch {
        data = {
          ok: false,
          error:
            rawBody || `응답을 해석하지 못했습니다. (HTTP ${response.status})`,
        }
      }

      const record = derivePurchaseRecord(data, {
        requestedAt,
        fallbackGames: repeatedGames,
      })
      commitPurchaseRecord(record)

      if (!response.ok || record.tone === "error") {
        console.error("[autobuy-api] purchase failed", {
          httpStatus: response.status,
          data,
        })
      } else {
        console.log("[autobuy-api] purchase response", data)
      }

      if (record.trace.length > 0) {
        console.debug("[purchase-worker] trace", record.trace)
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "API 요청 중 오류가 발생했습니다."
      console.error("[autobuy-api] purchase request error", message)
      const record = createPurchaseErrorRecord(message, {
        requestedAt,
        fallbackGames: repeatedGames,
      })
      commitPurchaseRecord(record)
    } finally {
      setPurchaseLoading(false)
      setPurchaseStartedAt("")
    }
  }

  return (
    <main className="app-shell">
      <section className="app-frame">
        <header className="page-head">
          <div className="page-head-main">
            <h1>로또 구매 콘솔</h1>
            <p className="description">
              번호를 만들고 자동구매 결과를 바로 확인합니다.
            </p>
          </div>
        </header>

        {autobuyEnabled ? (
          <section
            className={`purchase-summary-panel summary-${summaryTone}`}
            aria-live="polite"
          >
            <div className="purchase-summary-head">
              <div>
                <p className="section-kicker">최근 실행</p>
                <h2>{summaryTitle}</h2>
              </div>
              {summaryStatusLabel ? (
                <span className={`status-badge status-${summaryTone}`}>
                  {summaryStatusLabel}
                </span>
              ) : null}
            </div>

            <p className={`purchase-summary-message tone-${summaryTone}`}>
              {summaryMessage}
            </p>

            {hasSummary ? (
              <>
                <div className="purchase-meta-grid">
                  <div className="purchase-meta-item">
                    <span className="meta-label">요청</span>
                    <p>
                      {summaryRequestedAt
                        ? formatDateTime(summaryRequestedAt)
                        : "-"}
                    </p>
                  </div>
                  <div className="purchase-meta-item">
                    <span className="meta-label">실행</span>
                    <p>
                      {summaryExecutedAt
                        ? formatDateTime(summaryExecutedAt)
                        : "-"}
                    </p>
                  </div>
                  <div className="purchase-meta-item">
                    <span className="meta-label">요청 ID</span>
                    <p>{summaryRequestId || "-"}</p>
                  </div>
                  <div className="purchase-meta-item">
                    <span className="meta-label">계정</span>
                    <p>{summaryActor || "-"}</p>
                  </div>
                </div>

                {summarySubmittedGames.length > 0 ? (
                  <div className="purchase-games-block">
                    <p className="section-kicker">전송 번호</p>
                    {summarySubmittedGames.map((numbers, index) => (
                      <GameRow
                        key={`purchase-submitted-${index}`}
                        label={`${index + 1}게임`}
                        numbers={numbers}
                      />
                    ))}
                  </div>
                ) : null}

                {!purchaseLoading && showObservedGames ? (
                  <div className="purchase-games-block">
                    <p className="section-kicker">확인 번호</p>
                    {summaryObservedGames.map((numbers, index) => (
                      <GameRow
                        key={`purchase-observed-${index}`}
                        label={`${index + 1}게임`}
                        numbers={numbers}
                      />
                    ))}
                  </div>
                ) : null}

                {summaryBlockerSource ? (
                  <p className="purchase-result muted">
                    감지 레이어: {summaryBlockerSource}
                  </p>
                ) : null}

                {summaryLink ? (
                  <div className="purchase-summary-actions">
                    <a
                      className="btn btn-ghost"
                      href={summaryLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      동행복권 열기
                    </a>
                  </div>
                ) : null}

                {!purchaseLoading && summaryTrace.length > 0 ? (
                  <details className="trace-panel">
                    <summary>실행 로그 {summaryTrace.length}건</summary>
                    <div className="trace-list">
                      {summaryTrace.map((entry, index) => (
                        <p key={`${entry}-${index}`}>{entry}</p>
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        <section className="workspace-grid">
          <section className="workflow-panel">
            <div className="workflow-step workflow-step-prepare">
              <div className="step-head">
                <div className="step-head-main">
                  <span className="step-index">1</span>
                  <div>
                    <p className="section-kicker">번호 준비</p>
                    <h2>주소 읽기</h2>
                    <p className="step-copy">
                      QR이나 주소에서 제외 번호를 읽습니다.
                    </p>
                  </div>
                </div>
              </div>

              <div className="action-row">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setShowScanner((value) => !value)}
                >
                  {showScanner ? "스캔 닫기" : "QR 스캔"}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={generateWithoutExclude}
                >
                  번호만 생성
                </button>
              </div>

              <div className="manual-input-row">
                <label className="field-label" htmlFor="qr-url-input">
                  복권 QR 주소
                </label>
                <div className="manual-input-group">
                  <input
                    id="qr-url-input"
                    value={manualUrl}
                    onChange={(event) => setManualUrl(event.target.value)}
                    placeholder="동행복권 QR 주소를 붙여넣으세요"
                    aria-label="복권 QR 주소"
                  />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => applyLottoUrl(manualUrl)}
                  >
                    주소 읽기
                  </button>
                </div>
              </div>

              {safeDecodedUrl || errorMessage ? (
                <div className="step-feedback">
                  <p className={errorMessage ? "error-text" : "feedback-text"}>
                    {headerStatus}
                  </p>
                  {safeDecodedUrl ? (
                    <a
                      className="feedback-link"
                      href={safeDecodedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      읽은 주소 열기
                    </a>
                  ) : null}
                </div>
              ) : null}

              {showScanner ? (
                <div className="scanner-block">
                  <div className="scanner-head">
                    <p className="section-kicker">카메라 스캔</p>
                    <p className="step-copy">후면 카메라로 바로 읽습니다.</p>
                  </div>
                  <div className="scanner-wrap">
                    <Scanner
                      formats={["qr_code"]}
                      constraints={{ facingMode: "environment" }}
                      onScan={onScannerScan}
                      onError={onScannerError}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {autobuyEnabled ? (
              <>
                <div className="workflow-step workflow-step-account">
                  <div className="step-head">
                    <div className="step-head-main">
                      <span className="step-index">2</span>
                      <div>
                        <p className="section-kicker">계정</p>
                        <h2>Google 로그인</h2>
                        <p className="step-copy">
                          허용된 계정으로만 실행합니다.
                        </p>
                      </div>
                    </div>
                    <span
                      className={`status-badge status-${accountStatusTone}`}
                    >
                      {accountStatusLabel}
                    </span>
                  </div>

                  <div className="auth-surface auth-surface-compact">
                    {showGoogleSigninButton ? (
                      <div className="auth-button-slot" ref={googleButtonRef} />
                    ) : null}
                    {accountIdentityLabel ? (
                      <p className="purchase-auth-email">
                        {accountIdentityLabel}
                      </p>
                    ) : null}
                    {googleIdToken ? (
                      <button
                        className="btn btn-ghost btn-compact"
                        type="button"
                        onClick={logoutGoogle}
                      >
                        로그아웃
                      </button>
                    ) : null}
                    {!googleIdToken && accountSupportText ? (
                      <p
                        className={`auth-support ${googleAuthStatus ? "purchase-status-error" : "muted"}`}
                      >
                        {accountSupportText}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="workflow-step workflow-step-buy">
                  <div className="step-head">
                    <div className="step-head-main">
                      <span className="step-index">3</span>
                      <div>
                        <p className="section-kicker">자동구매</p>
                        <h2>5게임 보내기</h2>
                        <p className="step-copy">
                          준비된 번호 1게임을 5회 전송합니다.
                        </p>
                      </div>
                    </div>
                    <span className={`status-badge status-${buyStatusTone}`}>
                      {buyStatusLabel}
                    </span>
                  </div>

                  <div className="buy-summary-row">
                    <div className="buy-summary-item">
                      <span className="meta-label">전송 방식</span>
                      <p>
                        {hasPreparedNumbers ? "1게임 x 5회" : "번호 준비 필요"}
                      </p>
                    </div>
                    <div className="buy-summary-item">
                      <span className="meta-label">계정 상태</span>
                      <p>{googleIdToken ? "확인됨" : "로그인 필요"}</p>
                    </div>
                  </div>

                  <p className={`step-callout tone-${buyStatusTone}`}>
                    {buyStatusMessage}
                  </p>

                  <div className="purchase-action-block">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={!canSubmitPurchase || purchaseLoading}
                      onClick={submitPurchase}
                    >
                      {purchaseLoading ? "전송 중..." : "자동구매 실행"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </section>

          <section className="number-board">
            <div className="board-section board-section-excluded">
              <div className="board-head">
                <p className="section-kicker">제외 번호</p>
                <h2>읽은 번호</h2>
              </div>
              {excludedNumberGroups.length === 0 ? (
                <p className="muted">아직 불러온 제외 번호가 없습니다.</p>
              ) : (
                excludedNumberGroups.map((numbers, index) => (
                  <GameRow key={`exclude-${index}`} numbers={numbers} />
                ))
              )}
            </div>

            <div className="board-section board-section-generated">
              <div className="board-head">
                <p className="section-kicker">생성 번호</p>
                <h2>이번 기준 번호</h2>
              </div>
              {generatedGames.length === 0 ? (
                <p className="muted">QR을 읽거나 번호를 직접 생성해 주세요.</p>
              ) : (
                generatedGames.map((numbers, index) => (
                  <GameRow
                    key={`generated-${index}`}
                    label={`${index + 1}게임`}
                    numbers={numbers}
                  />
                ))
              )}
              {generatedGames.length > 0 ? (
                <p className="board-note">같은 번호 5게임 전송</p>
              ) : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  )
}
