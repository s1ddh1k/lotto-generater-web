import { runHttpPurchase } from './http-purchase.js'

const callbackUrl = process.env.PURCHASE_CALLBACK_URL || ''
const callbackToken = process.env.PURCHASE_CALLBACK_TOKEN || ''
const encodedPayload = process.env.PURCHASE_PAYLOAD_B64 || ''

function decodePayload() {
  if (!encodedPayload) throw new Error('PURCHASE_PAYLOAD_B64 is missing')
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
}

async function postResult(body) {
  if (!callbackUrl || !callbackToken) throw new Error('Purchase result callback is not configured')

  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${callbackUrl.replace(/\/$/, '')}/${encodeURIComponent(body.requestId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Purchase-Callback-Token': callbackToken
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      })
      if (response.ok) return
      lastError = new Error(`Callback failed (HTTP ${response.status})`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
  }

  throw lastError || new Error('Callback failed')
}

async function main() {
  let payload
  let response

  try {
    payload = decodePayload()
    const allowedEmail = (process.env.ALLOWED_EMAIL || '').toLowerCase()
    if (!payload.actor || payload.actor.toLowerCase() !== allowedEmail) {
      throw new Error('Actor is not allowed')
    }

    const result = payload.dryRun
      ? {
          status: 'dry-run-complete',
          executedAt: new Date().toISOString(),
          drawNo: payload.drawNo,
          gameCount: payload.games.length,
          games: payload.games,
          submittedGames: payload.games,
          note: '구매 없이 작업 실행 경로를 확인했습니다.'
        }
      : await runHttpPurchase(payload, {
          userId: process.env.DHL_USER_ID || '',
          password: process.env.DHL_USER_PASSWORD || '',
          loginUrl: process.env.DHL_LOGIN_URL || 'https://www.dhlottery.co.kr/login',
          directGameUrl:
            process.env.DHL_DIRECT_GAME_URL || 'https://ol.dhlottery.co.kr/olotto/game/game645.do',
          timeoutMs: Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 60_000),
          confirmPurchase: process.env.CONFIRM_PURCHASE === 'true'
        })

    response = {
      ok: true,
      acknowledged: true,
      requestId: payload.requestId,
      actor: payload.actor,
      dryRun: Boolean(payload.dryRun),
      result
    }
  } catch (error) {
    response = {
      ok: false,
      acknowledged: false,
      requestId: payload?.requestId || '',
      error: error instanceof Error ? error.message : 'Purchase job failed'
    }
  }

  console.log(JSON.stringify({ event: 'purchase-job-result', response }))
  await postResult(response)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
