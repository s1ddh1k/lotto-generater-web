import crypto from 'node:crypto'
import express from 'express'
import { CloudTasksClient } from '@google-cloud/tasks'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'

const app = express()
app.use(express.json({ limit: '100kb' }))

const allowedEmail = (process.env.ALLOWED_EMAIL || 'joogwankim@gmail.com').toLowerCase()
const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
const oauthClient = new OAuth2Client()
const serviceToServiceAuth = new GoogleAuth()
const tasksClient = new CloudTasksClient()
const localMode = process.env.LOCAL_MODE === 'true'
const directWorkerMode = process.env.DIRECT_WORKER_MODE === 'true'
const localActorEmail = (process.env.LOCAL_ACTOR_EMAIL || allowedEmail).toLowerCase()
const workerRequestTimeoutMs = Number(process.env.WORKER_REQUEST_TIMEOUT_MS || 120000)

const projectId =
  process.env.CLOUD_TASKS_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || ''
const tasksLocation = process.env.CLOUD_TASKS_LOCATION || 'asia-northeast3'
const tasksQueue = process.env.CLOUD_TASKS_QUEUE || 'lotto-purchase-queue'
const purchaseWorkerUrl = process.env.PURCHASE_WORKER_URL || ''
const taskOidcServiceAccount = process.env.TASK_OIDC_SERVICE_ACCOUNT || ''
const taskOidcAudience = process.env.TASK_OIDC_AUDIENCE || purchaseWorkerUrl

const queuePath =
  projectId && tasksLocation && tasksQueue
    ? tasksClient.queuePath(projectId, tasksLocation, tasksQueue)
    : ''
let directWorkerTokenClientPromise = null

function getBearerToken(req) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

function sanitizeGames(games) {
  if (!Array.isArray(games)) return []

  return games
    .filter(game => Array.isArray(game) && game.length === 6)
    .map(game => game.map(number => String(number).padStart(2, '0')))
}

async function verifyGoogleUser(req) {
  if (localMode) {
    const overrideActor = req.headers['x-local-actor-email']
    const actor =
      typeof overrideActor === 'string' && overrideActor.trim()
        ? overrideActor.trim().toLowerCase()
        : localActorEmail

    if (actor !== allowedEmail) {
      return { ok: false, code: 403, message: 'This account is not allowed to use auto-buy' }
    }

    return {
      ok: true,
      user: {
        email: actor,
        sub: 'local-mode'
      }
    }
  }

  const idToken = getBearerToken(req)
  if (!idToken) {
    return { ok: false, code: 401, message: 'Missing Google ID token' }
  }

  if (!googleClientId) {
    return {
      ok: false,
      code: 500,
      message: 'Backend is not configured: GOOGLE_OAUTH_CLIENT_ID is missing'
    }
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: googleClientId
    })
    const payload = ticket.getPayload()

    if (!payload?.email || !payload.email_verified) {
      return { ok: false, code: 403, message: 'Verified Google account is required' }
    }

    const email = payload.email.toLowerCase()
    if (email !== allowedEmail) {
      return { ok: false, code: 403, message: 'This account is not allowed to use auto-buy' }
    }

    return {
      ok: true,
      user: {
        email,
        sub: payload.sub
      }
    }
  } catch {
    return { ok: false, code: 401, message: 'Invalid Google ID token' }
  }
}

async function enqueuePurchaseTask(taskPayload) {
  if (!queuePath) {
    throw new Error('Cloud Tasks is not configured: queue path is missing')
  }

  if (!purchaseWorkerUrl) {
    throw new Error('PURCHASE_WORKER_URL is not configured')
  }

  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: `${purchaseWorkerUrl.replace(/\/$/, '')}/tasks/purchase`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: Buffer.from(JSON.stringify(taskPayload)).toString('base64')
    }
  }

  if (taskOidcServiceAccount) {
    task.httpRequest.oidcToken = {
      serviceAccountEmail: taskOidcServiceAccount,
      audience: taskOidcAudience || purchaseWorkerUrl
    }
  }

  const [response] = await tasksClient.createTask({
    parent: queuePath,
    task
  })

  return response?.name || ''
}

async function invokeWorkerDirect(taskPayload) {
  if (!purchaseWorkerUrl) {
    throw new Error('PURCHASE_WORKER_URL is not configured')
  }

  const audience = taskOidcAudience || purchaseWorkerUrl
  if (!audience) {
    throw new Error('Worker audience is not configured')
  }

  if (!directWorkerTokenClientPromise) {
    directWorkerTokenClientPromise = serviceToServiceAuth.getIdTokenClient(audience)
  }
  const tokenClient = await directWorkerTokenClientPromise
  const authHeaders = await tokenClient.getRequestHeaders()

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, workerRequestTimeoutMs)

  try {
    const response = await fetch(`${purchaseWorkerUrl.replace(/\/$/, '')}/tasks/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify(taskPayload),
      signal: controller.signal
    })

    const text = await response.text()
    let body
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { raw: text }
    }

    if (!response.ok) {
      const message =
        typeof body?.error === 'string' && body.error
          ? body.error
          : `Worker request failed (${response.status})`
      throw new Error(message)
    }

    if (body?.ok === false) {
      const message =
        typeof body?.error === 'string' && body.error ? body.error : 'Worker rejected purchase request'
      throw new Error(message)
    }

    return body
  } finally {
    clearTimeout(timeout)
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'lotto-autobuy-api',
    revision: process.env.K_REVISION || 'local'
  })
})

app.post('/purchase', async (req, res) => {
  const authResult = await verifyGoogleUser(req)
  if (!authResult.ok) {
    return res.status(authResult.code).json({ ok: false, error: authResult.message })
  }

  const { drawNo = null, games = [], dryRun = true } = req.body || {}
  const normalizedGames = sanitizeGames(games)

  if (normalizedGames.length === 0) {
    return res.status(400).json({ ok: false, error: 'games must be an array of 6-number arrays' })
  }

  const requestId = crypto.randomUUID()
  const taskPayload = {
    requestId,
    drawNo,
    dryRun: Boolean(dryRun),
    games: normalizedGames,
    actor: authResult.user.email,
    submittedAt: new Date().toISOString()
  }

  try {
    if (directWorkerMode) {
      const workerResponse = await invokeWorkerDirect(taskPayload)
      return res.status(200).json({
        ok: true,
        requestId,
        status: 'completed-direct',
        drawNo,
        dryRun: Boolean(dryRun),
        gameCount: normalizedGames.length,
        actor: authResult.user.email,
        worker: workerResponse
      })
    }

    const taskName = await enqueuePurchaseTask(taskPayload)

    return res.status(202).json({
      ok: true,
      requestId,
      status: 'queued',
      taskName,
      drawNo,
      dryRun: Boolean(dryRun),
      gameCount: normalizedGames.length,
      actor: authResult.user.email
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process purchase request'
    return res.status(500).json({ ok: false, error: message })
  }
})

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' })
})

const port = Number(process.env.PORT || 8080)
app.listen(port, () => {
  console.log(`lotto-autobuy-api listening on ${port}`)
})
