import crypto from 'node:crypto'
import express from 'express'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'

function normalizeGames(games) {
  if (!Array.isArray(games) || games.length === 0 || games.length > 5) return null
  const normalized = []
  for (const game of games) {
    if (!Array.isArray(game) || game.length !== 6) return null
    if (game.some(value => typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,2}$/.test(value)))) return null
    const numbers = game.map(Number)
    if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > 45) || new Set(numbers).size !== 6) return null
    normalized.push(numbers.sort((a, b) => a - b).map(number => String(number).padStart(2, '0')))
  }
  return normalized
}

function safeTokenMatch(actual, expected) {
  if (typeof actual !== 'string') return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function createApp({
  env = process.env,
  oauthClient = new OAuth2Client(),
  cloudPlatformAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
} = {}) {
  const allowedEmail = (env.ALLOWED_EMAIL || '').trim().toLowerCase()
  const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID || ''
  const purchaseJobName = env.PURCHASE_JOB_NAME || ''
  const purchaseCallbackUrl = env.PURCHASE_CALLBACK_URL || ''
  const requestTimeoutMs = Number(env.PURCHASE_REQUEST_TIMEOUT_MS || 240_000)
  const allowedOrigins = new Set((env.ALLOWED_ORIGINS || 'https://lottoforunluckypeople.netlify.app').split(',').map(origin => origin.trim()).filter(Boolean))
  if (!allowedEmail || !googleClientId || !purchaseJobName || !purchaseCallbackUrl) {
    throw new Error('ALLOWED_EMAIL, GOOGLE_OAUTH_CLIENT_ID, PURCHASE_JOB_NAME and PURCHASE_CALLBACK_URL are required')
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error('Invalid PURCHASE_REQUEST_TIMEOUT_MS')

  const app = express()
  const pending = new Map()
  app.use((req, res, next) => {
    if (allowedOrigins.has(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })
  app.use(express.json({ limit: '100kb' }))

  async function verifyUser(req) {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : ''
    if (!token) return { code: 401, error: 'Missing Google ID token' }
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: googleClientId })
      const user = ticket.getPayload()
      if (!user?.email_verified || user.email?.toLowerCase() !== allowedEmail) return { code: 403, error: 'This account is not allowed to use auto-buy' }
      return { email: user.email.toLowerCase() }
    } catch {
      return { code: 401, error: 'Invalid Google ID token' }
    }
  }

  async function invokeJob(payload) {
    const callbackToken = crypto.randomBytes(32).toString('base64url')
    let timeout
    const resultPromise = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Purchase job timed out; verify purchase history before retrying')), requestTimeoutMs)
      pending.set(payload.requestId, { callbackToken, resolve })
    })
    try {
      // Observe both promises immediately, including a timeout during job startup.
      const [body] = await Promise.all([
        resultPromise,
        (async () => {
          const client = await cloudPlatformAuth.getClient()
          await client.request({
            url: `https://run.googleapis.com/v2/${purchaseJobName}:run`,
            method: 'POST',
            timeout: requestTimeoutMs,
            retry: false,
            data: { overrides: { containerOverrides: [{ env: [
              { name: 'PURCHASE_PAYLOAD_B64', value: Buffer.from(JSON.stringify(payload)).toString('base64url') },
              { name: 'PURCHASE_CALLBACK_URL', value: purchaseCallbackUrl },
              { name: 'PURCHASE_CALLBACK_TOKEN', value: callbackToken },
            ] }] } },
          })
        })(),
      ])
      if (body?.ok === false) throw new Error(typeof body.error === 'string' ? body.error : 'Purchase job failed')
      return body
    } finally {
      clearTimeout(timeout)
      pending.delete(payload.requestId)
    }
  }

  app.post('/internal/purchase-job-result/:requestId', (req, res) => {
    const request = pending.get(req.params.requestId)
    if (!request || !safeTokenMatch(req.headers['x-purchase-callback-token'], request.callbackToken)) {
      return res.status(404).json({ ok: false, error: 'Unknown purchase job callback' })
    }
    if (req.body?.requestId !== req.params.requestId || typeof req.body?.ok !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Invalid purchase job callback' })
    }
    pending.delete(req.params.requestId)
    request.resolve(req.body)
    return res.status(204).end()
  })

  app.get('/health', (_req, res) => res.json({
    ok: true, service: 'lotto-autobuy-api', transport: 'cloud-run-job',
    revision: env.K_REVISION || 'local', nodeVersion: process.versions.node,
  }))

  app.post('/purchase', async (req, res) => {
    const user = await verifyUser(req)
    if (user.error) return res.status(user.code).json({ ok: false, error: user.error })
    const { drawNo = null, games, dryRun = true } = req.body || {}
    const normalizedGames = normalizeGames(games)
    if (!normalizedGames || typeof dryRun !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Provide 1–5 games of six distinct numbers between 1 and 45, and a boolean dryRun' })
    }
    const payload = {
      requestId: crypto.randomUUID(), drawNo, dryRun, games: normalizedGames,
      actor: user.email, submittedAt: new Date().toISOString(),
    }
    try {
      const result = await invokeJob(payload)
      return res.json({
        ok: true, requestId: payload.requestId, status: 'completed-direct', drawNo,
        dryRun, gameCount: normalizedGames.length, worker: { ...result, actor: undefined },
      })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to execute purchase job' })
    }
  })
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))
  app.use((error, _req, res, _next) => {
    const status = error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500
    res.status(status).json({ ok: false, error: status === 413 ? 'Request body is too large' : status === 400 ? 'Invalid JSON request' : 'Internal server error' })
  })
  return app
}
