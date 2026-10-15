import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'

describe('purchase API and signed job callbacks', () => {
  let server, base, request, oauthClient, env
  const games = Array.from({ length: 5 }, () => [1, 2, 3, 4, 5, 6])
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer google-user-token' }
  const jobResponse = (payload, result = {}) => ({ ok: true, requestId: payload.requestId, actor: payload.actor, result: { status: 'dry-run-complete', ...result } })

  async function callback(options, response, token) {
    const values = Object.fromEntries(options.data.overrides.containerOverrides[0].env.map(item => [item.name, item.value]))
    const payload = JSON.parse(Buffer.from(values.PURCHASE_PAYLOAD_B64, 'base64url').toString())
    return fetch(`${base}/internal/purchase-job-result/${payload.requestId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Purchase-Callback-Token': token ?? values.PURCHASE_CALLBACK_TOKEN },
      body: JSON.stringify(response ?? jobResponse(payload)),
    })
  }

  async function start(overrides = {}, getClient) {
    env = {
      ALLOWED_EMAIL: 'buyer@example.com', GOOGLE_OAUTH_CLIENT_ID: 'google-client',
      PURCHASE_JOB_NAME: 'projects/test/locations/asia-northeast3/jobs/purchase',
      PURCHASE_CALLBACK_URL: 'https://api.example/internal/purchase-job-result',
      PURCHASE_REQUEST_TIMEOUT_MS: '5000', ALLOWED_ORIGINS: 'https://app.example', ...overrides,
    }
    request = vi.fn(async options => {
      expect((await callback(options)).status).toBe(204)
      return { data: { name: 'operations/job-start' } }
    })
    oauthClient = { verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ email: 'buyer@example.com', email_verified: true }) })) }
    const app = createApp({ env, oauthClient, cloudPlatformAuth: { getClient: getClient || (async () => ({ request })) } })
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${server.address().port}`
  }
  const buy = body => fetch(`${base}/purchase`, { method: 'POST', headers, body: JSON.stringify(body) })
  afterEach(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null }
  })

  it('requires a real Google credential even if an obsolete local-mode flag is set', async () => {
    await start({ LOCAL_MODE: 'true' })
    const response = await fetch(`${base}/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ games }) })
    expect(response.status).toBe(401)
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    { email: 'another@example.com', email_verified: true },
    { email: 'buyer@example.com', email_verified: false },
  ])('rejects unauthorized or unverified Google accounts: %j', async user => {
    await start()
    oauthClient.verifyIdToken.mockResolvedValue({ getPayload: () => user })
    expect((await buy({ games })).status).toBe(403)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an expired Google credential', async () => {
    await start()
    oauthClient.verifyIdToken.mockRejectedValue(new Error('expired'))
    expect((await buy({ games })).status).toBe(401)
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    [], [[1, 1, 2, 3, 4, 5]], [[0, 2, 3, 4, 5, 6]], [[1, 2, 3, 4, 5, 46]],
    [[1, 2, 3, 4, 5]], Array.from({ length: 6 }, () => [1, 2, 3, 4, 5, 6]),
  ].map(invalidGames => [invalidGames]))('rejects invalid games without launching a billable job: %j', async invalidGames => {
    await start()
    expect((await buy({ games: invalidGames })).status).toBe(400)
    expect(request).not.toHaveBeenCalled()
  })

  it('sends exactly one job, verifies the Google audience, and preserves the frontend response contract', async () => {
    await start()
    const response = await buy({ games, dryRun: false })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.worker.result.status).toBe('dry-run-complete')
    expect(body.worker.actor).toBeUndefined()
    expect(body.gameCount).toBe(5)
    expect(oauthClient.verifyIdToken).toHaveBeenCalledWith({ idToken: 'google-user-token', audience: 'google-client' })
    expect(request).toHaveBeenCalledTimes(1)
    const options = request.mock.calls[0][0]
    expect(options.url).toBe(`https://run.googleapis.com/v2/${env.PURCHASE_JOB_NAME}:run`)
    expect(options.retry).toBe(false)
    const values = Object.fromEntries(options.data.overrides.containerOverrides[0].env.map(item => [item.name, item.value]))
    const payload = JSON.parse(Buffer.from(values.PURCHASE_PAYLOAD_B64, 'base64url').toString())
    expect(payload.games).toEqual(games.map(game => game.map(number => String(number).padStart(2, '0'))))
    expect(payload.dryRun).toBe(false)
    expect(values.PURCHASE_CALLBACK_TOKEN).toHaveLength(43)
  })

  it('defaults to a dry run when the caller omits dryRun', async () => {
    await start()
    const response = await buy({ games })
    expect((await response.json()).dryRun).toBe(true)
  })

  it('rejects forged and replayed callbacks and accepts the matching signed result once', async () => {
    await start()
    request.mockImplementation(async options => {
      expect((await callback(options, null, 'forged')).status).toBe(404)
      expect((await callback(options)).status).toBe(204)
      expect((await callback(options)).status).toBe(404)
      return { data: {} }
    })
    expect((await buy({ games, dryRun: true })).status).toBe(200)
  })

  it('rejects a signed callback for a different request', async () => {
    await start()
    request.mockImplementation(async options => {
      expect((await callback(options, { ok: true, requestId: 'wrong-request' })).status).toBe(400)
      expect((await callback(options)).status).toBe(204)
      return { data: {} }
    })
    expect((await buy({ games })).status).toBe(200)
  })

  it('returns startup failures without falling back to the deleted worker or retrying', async () => {
    await start()
    request.mockRejectedValue(new Error('job startup failed'))
    const response = await buy({ games })
    expect(response.status).toBe(500)
    expect((await response.json()).error).toContain('startup failed')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('times out while waiting for a callback without an unhandled rejection', async () => {
    await start({ PURCHASE_REQUEST_TIMEOUT_MS: '30' })
    request.mockResolvedValue({ data: {} })
    const response = await buy({ games })
    expect(response.status).toBe(500)
    expect((await response.json()).error).toContain('verify purchase history')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('also times out safely while authentication to Cloud Run is still pending', async () => {
    await start({ PURCHASE_REQUEST_TIMEOUT_MS: '30' }, () => new Promise(() => {}))
    expect((await buy({ games })).status).toBe(500)
    expect(request).not.toHaveBeenCalled()
  })

  it('reports the runtime and returns CORS headers only for the configured origin', async () => {
    await start()
    const health = await fetch(`${base}/health`, { headers: { Origin: 'https://app.example' } })
    expect(health.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example')
    expect((await health.json()).transport).toBe('cloud-run-job')
    const other = await fetch(`${base}/health`, { headers: { Origin: 'https://other.example' } })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('requires only the active job configuration', () => {
    expect(() => createApp({ env: {} })).toThrow('PURCHASE_JOB_NAME')
  })
})
