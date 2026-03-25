import { describe, expect, it } from 'vitest'
import { createPurchaseErrorRecord, derivePurchaseRecord } from './purchase'

describe('derivePurchaseRecord', () => {
  it('treats purchase-submitted as success and prefers submitted games', () => {
    const record = derivePurchaseRecord(
      {
        ok: true,
        status: 'completed-direct',
        requestId: 'req-1',
        worker: {
          ok: true,
          result: {
            status: 'purchase-submitted',
            note: '구매가 완료되었습니다.',
            submittedGames: [
              ['01', '02', '03', '04', '05', '06'],
              ['01', '02', '03', '04', '05', '06']
            ],
            reportRowsAfterSubmit: [['01', '02', '03', '04', '05', '06']],
            trace: ['step-a']
          }
        }
      },
      {
        requestedAt: '2026-03-25T10:00:00.000Z',
        fallbackGames: [['11', '12', '13', '14', '15', '16']]
      }
    )

    expect(record.tone).toBe('success')
    expect(record.statusCode).toBe('purchase-submitted')
    expect(record.statusLabel).toBe('완료')
    expect(record.message).toBe('구매가 완료되었습니다.')
    expect(record.submittedGames).toHaveLength(2)
    expect(record.observedGames).toEqual([['01', '02', '03', '04', '05', '06']])
    expect(record.link).toBe('https://www.dhlottery.co.kr')
    expect(record.trace).toEqual(['step-a'])
  })

  it('keeps queued responses as informational', () => {
    const record = derivePurchaseRecord(
      {
        ok: true,
        status: 'queued',
        requestId: 'req-2',
        taskName: 'task-1'
      },
      {
        fallbackGames: [['21', '22', '23', '24', '25', '26']]
      }
    )

    expect(record.tone).toBe('info')
    expect(record.statusCode).toBe('queued')
    expect(record.statusLabel).toBe('대기 중')
    expect(record.submittedGames).toEqual([['21', '22', '23', '24', '25', '26']])
    expect(record.taskName).toBe('task-1')
  })
})

describe('createPurchaseErrorRecord', () => {
  it('builds an error record with fallback games', () => {
    const record = createPurchaseErrorRecord('API 요청 실패', {
      fallbackGames: [['31', '32', '33', '34', '35', '36']]
    })

    expect(record.tone).toBe('error')
    expect(record.statusCode).toBe('failed')
    expect(record.message).toBe('API 요청 실패')
    expect(record.submittedGames).toEqual([['31', '32', '33', '34', '35', '36']])
  })
})
