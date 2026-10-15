import { expect, test, type Page } from '@playwright/test'

// Keep authentication and purchases local: no real account or money is used.
const googleIdentityStub = `
  (() => {
    let callback;
    window.google = { accounts: { id: {
      initialize(options) { callback = options.callback; },
      renderButton(element, options) {
        const button = document.createElement('button');
        button.textContent = 'Google로 계속하기';
        button.style.cssText = 'width:100%;min-height:44px;border:1px solid #dadce0;border-radius:4px;background:#fff;color:#3c4043;font:inherit';
        button.addEventListener('click', () => callback({ credential: 'test-google-id-token' }));
        element.replaceChildren(button);
      },
      disableAutoSelect() {},
    } } };
  })();
`

async function login(page: Page) {
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await page.getByRole('button', { name: 'Google로 계속하기' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('로그인됨', { exact: true })).toBeVisible()
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'application/javascript', body: googleIdentityStub,
  }))
  // Every test must opt into its own simulated purchase response.
  await page.route('**/autobuy/purchase', route => route.fulfill({ status: 503, json: { ok: false } }))
  await page.goto('/')
})

test('keeps login and the primary action on the first screen', async ({ page }, testInfo) => {
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '로그인하고 번호 뽑기' })).toBeInViewport()
  await expect(page.locator('.number-ball')).toHaveCount(0)
  await expect(page.getByText(/QR|제외 번호|상세 정보|Gmail/)).toHaveCount(0)
  await expectNoOverflow(page)
  await testInfo.attach('로그인 전', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})

test('opens login from the header or main action and restores keyboard focus', async ({ page }, testInfo) => {
  const headerLogin = page.getByRole('button', { name: '로그인', exact: true })
  await headerLogin.click()
  const dialog = page.getByRole('dialog', { name: '로그인하고 시작하세요' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Google로 계속하기' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '로그인 창 닫기' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Google로 계속하기' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '로그인 창 닫기' })).toBeFocused()
  await headerLogin.evaluate(button => (button as HTMLButtonElement).focus())
  await expect(page.getByRole('button', { name: '로그인 창 닫기' })).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(headerLogin).toBeFocused()
  await page.getByRole('button', { name: '로그인하고 번호 뽑기' }).click()
  await expect(dialog).toBeVisible()
  await expectNoOverflow(page)
  await testInfo.attach('로그인 창', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '로그인 창 닫기' }).click()
  await expect(dialog).toHaveCount(0)
})

test('generates and regenerates six numbers after login', async ({ page }, testInfo) => {
  await login(page)
  const balls = page.locator('.number-display .number-ball')
  await expect(balls).toHaveCount(6)
  const first = (await balls.allTextContents()).map(Number)
  expect(new Set(first).size).toBe(6)
  expect(first).toEqual([...first].sort((a, b) => a - b))
  expect(first.every(number => number >= 1 && number <= 45)).toBe(true)
  await page.getByRole('button', { name: '다시 뽑기' }).click()
  await expect.poll(() => balls.allTextContents()).not.toEqual(first.map(String))
  await expect(page.getByRole('button', { name: '5,000원 구매하기' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '5,000원 구매하기' })).toBeInViewport()
  await expectNoOverflow(page)
  await testInfo.attach('로그인 후', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})

test('submits the shown numbers as five identical games and blocks duplicate requests', async ({ page }, testInfo) => {
  await login(page)
  const numbers = (await page.locator('.number-display .number-ball').allTextContents()).map(Number)
  let requestCount = 0
  let releaseResponse!: () => void
  const responseReady = new Promise<void>(resolve => { releaseResponse = resolve })
  await page.route('**/autobuy/purchase', async route => {
    requestCount += 1
    expect(route.request().headers().authorization).toBe('Bearer test-google-id-token')
    expect(route.request().postDataJSON()).toEqual({ dryRun: false, games: Array.from({ length: 5 }, () => numbers) })
    await responseReady
    await route.fulfill({ json: { ok: true, worker: { ok: true, result: { status: 'purchase-submitted' } } } })
  })
  try {
    await page.getByRole('button', { name: '5,000원 구매하기' }).evaluate(button => {
      for (let index = 0; index < 4; index += 1) (button as HTMLButtonElement).click()
    })
    await expect(page.getByRole('button', { name: '구매 요청 확인 중' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '다시 뽑기' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeDisabled()
    await expect.poll(() => requestCount).toBe(1)
  } finally {
    releaseResponse()
  }
  await expect(page.getByRole('heading', { name: '구매 완료', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '구매 완료' })).toBeDisabled()
  await expect(page.getByRole('link', { name: '동행복권에서 확인' })).toHaveAttribute('href', 'https://www.dhlottery.co.kr')
  await expectNoOverflow(page)
  await testInfo.attach('구매 결과', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await page.getByRole('button', { name: '다시 뽑기' }).click()
  await expect(page.getByRole('button', { name: '5,000원 구매하기' })).toBeEnabled()
  expect(requestCount).toBe(1)
})

test('asks for login again when the session has expired without resubmitting', async ({ page }) => {
  await login(page)
  const originalNumbers = await page.locator('.number-display .number-ball').allTextContents()
  let requests = 0
  await page.route('**/autobuy/purchase', route => {
    requests += 1
    return route.fulfill({ status: 401, json: { ok: false } })
  })
  await page.getByRole('button', { name: '5,000원 구매하기' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('로그인 시간이 만료')
  await page.getByRole('button', { name: 'Google로 계속하기' }).click()
  expect(await page.locator('.number-display .number-ball').allTextContents()).toEqual(originalNumbers)
  await expect(page.getByRole('button', { name: '5,000원 구매하기' })).toBeEnabled()
  expect(requests).toBe(1)
})

test('explains account restrictions and allows switching accounts', async ({ page }) => {
  await login(page)
  await page.route('**/autobuy/purchase', route => route.fulfill({ status: 403, json: { ok: false } }))
  await page.getByRole('button', { name: '5,000원 구매하기' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('구매 권한이 없어요')
  await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeVisible()
})

for (const scenario of ['network error', 'server error', 'unreadable response', 'queued response'] as const) {
  test(`keeps ${scenario} from being mistaken for a completed purchase`, async ({ page }) => {
    await login(page)
    await page.route('**/autobuy/purchase', route => {
      if (scenario === 'network error') return route.abort('failed')
      if (scenario === 'server error') return route.fulfill({ status: 500, json: { ok: false, error: 'Job callback timed out' } })
      if (scenario === 'unreadable response') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Bad gateway</html>' })
      return route.fulfill({ json: { ok: true, status: 'queued' } })
    })
    await page.getByRole('button', { name: '5,000원 구매하기' }).click()
    await expect(page.locator('.purchase-result')).toBeVisible()
    await expect(page.getByRole('heading', { name: '구매 완료', exact: true })).toHaveCount(0)
    await expect(page.locator('.primary-button')).toBeDisabled()
    await expect(page.locator('.primary-button')).toHaveAttribute('data-state', 'pending')
    await expect(page.getByRole('link', { name: '동행복권에서 확인' })).toBeVisible()
    await expectNoOverflow(page)
  })
}

test('shows a failed purchase clearly and keeps retry available', async ({ page }) => {
  await login(page)
  await page.route('**/autobuy/purchase', route => route.fulfill({ json: {
    ok: true, worker: { ok: true, result: { status: 'sale-closed' } },
  } }))
  await page.getByRole('button', { name: '5,000원 구매하기' }).click()
  await expect(page.getByRole('heading', { name: '판매 종료', exact: true })).toBeVisible()
  await expect(page.getByText('현재는 구매할 수 없는 시간이에요.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '5,000원 구매하기' })).toBeEnabled()
})

test('recovers when loading Google sign-in fails', async ({ page }) => {
  let loads = 0
  await page.route('https://accounts.google.com/gsi/client', route => {
    loads += 1
    return loads === 1 ? route.abort('failed') : route.fulfill({ contentType: 'application/javascript', body: googleIdentityStub })
  })
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('불러오지 못했어요')
  await page.getByRole('button', { name: '다시 시도' }).click()
  await page.getByRole('button', { name: 'Google로 계속하기' }).click()
  await expect(page.getByText('로그인됨', { exact: true })).toBeVisible()
  expect(loads).toBe(2)
})

test('clears numbers and purchase results on logout', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.locator('.number-ball')).toHaveCount(0)
  await expect(page.locator('.purchase-result')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '로그인하고 번호 뽑기' })).toBeVisible()
})

test('allows retrying when Google sign-in takes too long', async ({ page }) => {
  await page.clock.install()
  await page.route('https://accounts.google.com/gsi/client', () => {})
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByText('로그인 연결 중')).toBeVisible()
  await page.clock.fastForward(15_001)
  await expect(page.getByRole('alert')).toContainText('불러오지 못했어요')
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeEnabled()
})

test('stops waiting for a purchase without claiming failure or sending it again', async ({ page }) => {
  await page.clock.install()
  await login(page)
  let requests = 0
  await page.route('**/autobuy/purchase', () => { requests += 1 })
  await page.getByRole('button', { name: '5,000원 구매하기' }).click()
  await expect(page.getByRole('button', { name: '구매 요청 확인 중' })).toBeDisabled()
  await expect.poll(() => requests).toBe(1)
  await page.clock.fastForward(260_001)
  await expect(page.getByRole('heading', { name: '구매 내역 확인 필요' })).toBeVisible()
  await expect(page.locator('.primary-button')).toHaveAttribute('data-state', 'pending')
  await expect(page.locator('.primary-button')).toBeDisabled()
  expect(requests).toBe(1)
})
