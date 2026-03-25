export type PurchaseWorkerResult = {
  status?: string
  note?: string
  error?: string
  trace?: string[]
  games?: string[][]
  submittedGames?: string[][]
  reportRows?: string[][]
  reportRowsBeforeSubmit?: string[][]
  reportRowsAfterSubmit?: string[][]
  executedAt?: string
  drawNo?: number | string | null
  gameCount?: number
  confirmPurchase?: boolean
  blockerSource?: string
  retryRecommended?: boolean
}

export type PurchaseWorkerResponse = {
  ok?: boolean
  acknowledged?: boolean
  error?: string
  requestId?: string
  actor?: string
  dryRun?: boolean
  result?: PurchaseWorkerResult
}

export type PurchaseApiResponse = {
  ok?: boolean
  error?: string
  status?: string
  requestId?: string
  actor?: string
  dryRun?: boolean
  drawNo?: number | string | null
  gameCount?: number
  taskName?: string
  worker?: PurchaseWorkerResponse
}

export type PurchaseRecordTone = 'success' | 'warning' | 'error' | 'info'

export type PurchaseRecord = {
  title: string
  message: string
  tone: PurchaseRecordTone
  statusCode: string
  statusLabel: string
  requestId: string
  taskName: string
  actor: string
  dryRun: boolean
  requestedAt: string
  executedAt: string
  submittedGames: string[][]
  observedGames: string[][]
  trace: string[]
  link: string
  blockerSource: string
  error: string
}

type PurchaseRecordOptions = {
  fallbackGames?: string[][]
  requestedAt?: string
}

const defaultRequestedAt = () => new Date().toISOString()

function isGameCollection(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(game => Array.isArray(game) && game.every(number => typeof number === 'string'))
}

function normalizeGames(...candidates: unknown[]): string[][] {
  for (const candidate of candidates) {
    if (!isGameCollection(candidate) || candidate.length === 0) continue

    return candidate.map(game =>
      game.map(number => String(number).padStart(2, '0')).filter(number => number.length > 0)
    )
  }

  return []
}

function messageForStatus(statusCode: string): { tone: PurchaseRecordTone; title: string; statusLabel: string; fallback: string } {
  switch (statusCode) {
    case 'purchase-submitted':
      return {
        tone: 'success',
        title: '구매 완료',
        statusLabel: '완료',
        fallback: '구매가 정상적으로 접수되었습니다.'
      }
    case 'ready-for-final-confirm':
      return {
        tone: 'warning',
        title: '최종 확인 전',
        statusLabel: '확인 필요',
        fallback: '최종 구매 확인 단계가 남아 있습니다.'
      }
    case 'dry-run-complete':
      return {
        tone: 'info',
        title: '드라이런 완료',
        statusLabel: '드라이런',
        fallback: '실구매 없이 전체 흐름만 검증했습니다.'
      }
    case 'skipped':
      return {
        tone: 'warning',
        title: '실구매 차단',
        statusLabel: '차단',
        fallback: '실구매가 비활성화되어 요청만 검증했습니다.'
      }
    case 'limit-exceeded':
      return {
        tone: 'error',
        title: '구매 한도 초과',
        statusLabel: '한도 초과',
        fallback: '오늘의 구매 한도를 초과했습니다.'
      }
    case 'insufficient-balance':
      return {
        tone: 'error',
        title: '예치금 부족',
        statusLabel: '잔액 부족',
        fallback: '예치금이 부족해서 구매를 완료하지 못했습니다.'
      }
    case 'sale-closed':
      return {
        tone: 'error',
        title: '판매 종료',
        statusLabel: '판매 종료',
        fallback: '현재는 구매 가능한 시간이 아닙니다.'
      }
    case 'blocked':
      return {
        tone: 'error',
        title: '구매 차단',
        statusLabel: '차단',
        fallback: '구매 중 차단 메시지가 확인되었습니다.'
      }
    case 'failed':
      return {
        tone: 'error',
        title: '구매 실패',
        statusLabel: '실패',
        fallback: '자동구매 실행 중 오류가 발생했습니다.'
      }
    case 'queued':
      return {
        tone: 'info',
        title: '구매 요청 접수',
        statusLabel: '대기 중',
        fallback: '백엔드에 구매 요청이 접수되었습니다.'
      }
    case 'completed-direct':
      return {
        tone: 'info',
        title: '직접 실행 완료',
        statusLabel: '직접 실행',
        fallback: '워크플로우가 직접 실행되었습니다.'
      }
    default:
      return {
        tone: 'info',
        title: '구매 요청 처리',
        statusLabel: '처리됨',
        fallback: '구매 요청이 처리되었습니다.'
      }
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim() || ''
}

export function derivePurchaseRecord(response: PurchaseApiResponse, options: PurchaseRecordOptions = {}): PurchaseRecord {
  const worker = response.worker
  const result = worker?.result
  const statusCode = firstNonEmpty(result?.status, response.status, response.ok === false ? 'failed' : '') || 'processed'
  const statusMeta = messageForStatus(statusCode)
  const error = firstNonEmpty(result?.error, worker?.error, response.error)
  const message =
    firstNonEmpty(result?.note, error, response.error, statusMeta.fallback) || '구매 요청 처리 결과를 확인할 수 없습니다.'
  const submittedGames = normalizeGames(
    result?.submittedGames,
    result?.reportRowsBeforeSubmit,
    result?.games,
    options.fallbackGames
  )
  const observedGames = normalizeGames(result?.reportRowsAfterSubmit, result?.reportRows)

  return {
    title: statusMeta.title,
    message,
    tone: error && statusMeta.tone === 'info' ? 'error' : statusMeta.tone,
    statusCode,
    statusLabel: statusMeta.statusLabel,
    requestId: firstNonEmpty(response.requestId, worker?.requestId),
    taskName: firstNonEmpty(response.taskName),
    actor: firstNonEmpty(response.actor, worker?.actor),
    dryRun: Boolean(result?.status === 'dry-run-complete' || response.dryRun || worker?.dryRun),
    requestedAt: options.requestedAt || defaultRequestedAt(),
    executedAt: firstNonEmpty(result?.executedAt),
    submittedGames,
    observedGames,
    trace: Array.isArray(result?.trace) ? result.trace.filter(entry => typeof entry === 'string') : [],
    link: statusCode === 'purchase-submitted' ? 'https://www.dhlottery.co.kr' : '',
    blockerSource: firstNonEmpty(result?.blockerSource),
    error
  }
}

export function createPurchaseErrorRecord(message: string, options: PurchaseRecordOptions = {}): PurchaseRecord {
  return derivePurchaseRecord(
    {
      ok: false,
      error: message,
      status: 'failed'
    },
    options
  )
}
