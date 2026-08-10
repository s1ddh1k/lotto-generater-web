import crypto from 'node:crypto'
import express from 'express'
import { CloudTasksClient } from '@google-cloud/tasks'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'

const app = express()
app.use(express.json({ limit: '100kb' }))

const allowedEmail = (process.env.ALLOWED_EMAIL || '').trim().toLowerCase()
const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
const oauthClient = new OAuth2Client()
const serviceToServiceAuth = new GoogleAuth()
const cloudPlatformAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const tasksClient = new CloudTasksClient()
const localMode = process.env.LOCAL_MODE === 'true'
const directWorkerMode = process.env.DIRECT_WORKER_MODE === 'true'
const localActorEmail = (process.env.LOCAL_ACTOR_EMAIL || allowedEmail).toLowerCase()
const workerRequestTimeoutMs = Number(process.env.WORKER_REQUEST_TIMEOUT_MS || 120000)
const purchaseJobName = process.env.PURCHASE_JOB_NAME || ''
const purchaseCallbackUrl = process.env.PURCHASE_CALLBACK_URL || ''
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://lottoforunluckypeople.netlify.app')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
)

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (typeof origin === 'string' && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }

  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

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
const pendingJobResults = new Map()

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

function safeTokenMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual || '')
  const expectedBuffer = Buffer.from(expected || '')
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

async function invokePurchaseJob(taskPayload) {
  if (!purchaseJobName || !purchaseCallbackUrl) {
    throw new Error('Purchase job callback is not configured')
  }

  const callbackToken = crypto.randomBytes(32).toString('base64url')
  let timeoutId
  const resultPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      pendingJobResults.delete(taskPayload.requestId)
      reject(new Error('Purchase job timed out'))
    }, workerRequestTimeoutMs)
    pendingJobResults.set(taskPayload.requestId, { callbackToken, resolve })
  })

  try {
    const authClient = await cloudPlatformAuth.getClient()
    await authClient.request({
      url: `https://run.googleapis.com/v2/${purchaseJobName}:run`,
      method: 'POST',
      data: {
        overrides: {
          containerOverrides: [
            {
              env: [
                {
                  name: 'PURCHASE_PAYLOAD_B64',
                  value: Buffer.from(JSON.stringify(taskPayload)).toString('base64url')
                },
                { name: 'PURCHASE_CALLBACK_URL', value: purchaseCallbackUrl },
                { name: 'PURCHASE_CALLBACK_TOKEN', value: callbackToken }
              ]
            }
          ]
        }
      }
    })
    const body = await resultPromise
    if (body?.ok === false) {
      throw new Error(typeof body.error === 'string' && body.error ? body.error : 'Purchase job failed')
    }
    return body
  } catch (error) {
    pendingJobResults.delete(taskPayload.requestId)
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

app.post('/internal/purchase-job-result/:requestId', (req, res) => {
  const pending = pendingJobResults.get(req.params.requestId)
  const suppliedToken = req.headers['x-purchase-callback-token']
  if (!pending || typeof suppliedToken !== 'string' || !safeTokenMatch(suppliedToken, pending.callbackToken)) {
    return res.status(404).json({ ok: false, error: 'Unknown purchase job callback' })
  }

  pendingJobResults.delete(req.params.requestId)
  pending.resolve(req.body)
  return res.status(204).end()
})

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
    if (directWorkerMode || purchaseJobName) {
      const workerResponse = purchaseJobName
        ? await invokePurchaseJob(taskPayload)
        : await invokeWorkerDirect(taskPayload)
      return res.status(200).json({
        ok: true,
        requestId,
        status: 'completed-direct',
        drawNo,
        dryRun: Boolean(dryRun),
        gameCount: normalizedGames.length,
        worker: { ...workerResponse, actor: undefined }
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
      gameCount: normalizedGames.length
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
