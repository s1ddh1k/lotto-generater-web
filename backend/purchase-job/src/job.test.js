import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executePayload, runJob } from './job.js'

const payload = { requestId: 'request-1', actor: 'buyer@example.com', dryRun: true, games: [['01', '02', '03', '04', '05', '06']] }
const env = {
  ALLOWED_EMAIL: 'buyer@example.com', PURCHASE_CALLBACK_URL: 'https://api.example/internal/purchase-job-result',
  PURCHASE_CALLBACK_TOKEN: 'signed-callback', PURCHASE_PAYLOAD_B64: Buffer.from(JSON.stringify(payload)).toString('base64url'),
}

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('one-shot purchase job', () => {
  it('never contacts the lottery site during a dry run', async () => {
    const purchase = vi.fn()
    const result = await executePayload(payload, env, purchase)
    expect(result.status).toBe('dry-run-complete')
    expect(result.submittedGames).toEqual(payload.games)
    expect(purchase).not.toHaveBeenCalled()
  })

  it('rejects an unauthorized actor before attempting a purchase', async () => {
    const purchase = vi.fn()
    await expect(executePayload({ ...payload, actor: 'other@example.com' }, env, purchase)).rejects.toThrow('not allowed')
    expect(purchase).not.toHaveBeenCalled()
  })

  it('does not treat a string as the dry-run flag', async () => {
    await expect(executePayload({ ...payload, dryRun: 'false' }, env)).rejects.toThrow('Invalid purchase payload')
  })

  it('sends the signed callback with the matching request result', async () => {
    const purchase = vi.fn()
    const fetchResult = vi.fn(async () => ({ ok: true }))
    await runJob({ env, purchase, fetchResult })
    expect(purchase).not.toHaveBeenCalled()
    expect(fetchResult).toHaveBeenCalledTimes(1)
    const [url, options] = fetchResult.mock.calls[0]
    expect(url).toBe('https://api.example/internal/purchase-job-result/request-1')
    expect(options.headers['X-Purchase-Callback-Token']).toBe('signed-callback')
    expect(JSON.parse(options.body).result.status).toBe('dry-run-complete')
  })

  it('retries callback delivery without repeating the purchase', async () => {
    const purchase = vi.fn(async () => ({ status: 'purchase-submitted' }))
    const fetchResult = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true })
    const liveEnv = { ...env, CONFIRM_PURCHASE: 'true', PURCHASE_PAYLOAD_B64: Buffer.from(JSON.stringify({ ...payload, dryRun: false })).toString('base64url') }
    await runJob({ env: liveEnv, purchase, fetchResult, wait: async () => {} })
    expect(purchase).toHaveBeenCalledTimes(1)
    expect(purchase.mock.calls[0][1].confirmPurchase).toBe(true)
    expect(fetchResult).toHaveBeenCalledTimes(3)
  })

  it('stops retrying a rejected callback and does not repeat the purchase', async () => {
    const fetchResult = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(runJob({ env, fetchResult, wait: async () => {} })).rejects.toThrow('HTTP 404')
    expect(fetchResult).toHaveBeenCalledTimes(1)
  })
})
