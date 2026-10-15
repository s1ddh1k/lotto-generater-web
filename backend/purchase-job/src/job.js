import { pathToFileURL } from 'node:url'
import { runHttpPurchase } from './http-purchase.js'

export async function executePayload(payload, env = process.env, purchase = runHttpPurchase) {
  const allowedEmail = (env.ALLOWED_EMAIL || '').trim().toLowerCase()
  if (!allowedEmail || payload?.actor?.toLowerCase() !== allowedEmail) throw new Error('Actor is not allowed')
  if (!Array.isArray(payload.games) || payload.games.length < 1 || payload.games.length > 5 || typeof payload.dryRun !== 'boolean') {
    throw new Error('Invalid purchase payload')
  }
  if (payload.dryRun) {
    return {
      status: 'dry-run-complete', executedAt: new Date().toISOString(),
      drawNo: payload.drawNo, gameCount: payload.games.length,
      games: payload.games, submittedGames: payload.games,
      note: '구매 없이 작업 실행 경로를 확인했습니다.',
    }
  }
  return purchase(payload, {
    userId: env.DHL_USER_ID || '', password: env.DHL_USER_PASSWORD || '',
    loginUrl: env.DHL_LOGIN_URL || 'https://www.dhlottery.co.kr/login',
    directGameUrl: env.DHL_DIRECT_GAME_URL || 'https://ol.dhlottery.co.kr/olotto/game/game645.do',
    timeoutMs: Number(env.PURCHASE_HTTP_TIMEOUT_MS || 60_000),
    confirmPurchase: env.CONFIRM_PURCHASE === 'true',
  })
}

export async function runJob({ env = process.env, purchase = runHttpPurchase, fetchResult = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let payload
  let response
  try {
    if (!env.PURCHASE_PAYLOAD_B64) throw new Error('PURCHASE_PAYLOAD_B64 is missing')
    payload = JSON.parse(Buffer.from(env.PURCHASE_PAYLOAD_B64, 'base64url').toString('utf8'))
    response = {
      ok: true, acknowledged: true, requestId: payload.requestId,
      actor: payload.actor, dryRun: payload.dryRun,
      result: await executePayload(payload, env, purchase),
    }
  } catch (error) {
    response = { ok: false, acknowledged: false, requestId: payload?.requestId || '', error: error instanceof Error ? error.message : 'Purchase job failed' }
  }
  console.log(JSON.stringify({ event: 'purchase-job-result', nodeVersion: process.versions.node, response: { ...response, actor: undefined } }))
  if (!env.PURCHASE_CALLBACK_URL || !env.PURCHASE_CALLBACK_TOKEN) throw new Error('Purchase result callback is not configured')

  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const reply = await fetchResult(`${env.PURCHASE_CALLBACK_URL.replace(/\/$/, '')}/${encodeURIComponent(response.requestId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Purchase-Callback-Token': env.PURCHASE_CALLBACK_TOKEN },
        body: JSON.stringify(response), signal: AbortSignal.timeout(30_000),
      })
      if (reply.ok) return response
      lastError = new Error(`Callback failed (HTTP ${reply.status})`)
      if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) break
    } catch (error) {
      lastError = error
    }
    if (attempt < 2) await wait(500 * (attempt + 1))
  }
  throw lastError || new Error('Callback failed')
}

async function main() {
  if (process.argv.includes('--self-test')) {
    // This path never uses account secrets, contacts the lottery site, or buys a ticket.
    const result = await executePayload({ actor: 'self-test@localhost', dryRun: true, games: [['01', '02', '03', '04', '05', '06']] }, { ALLOWED_EMAIL: 'self-test@localhost' })
    console.log(JSON.stringify({ event: 'purchase-job-self-test', ok: result.status === 'dry-run-complete', nodeVersion: process.versions.node, status: result.status }))
    return
  }
  await runJob()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
