import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import puppeteer from 'puppeteer'

const app = express()
app.use(express.json({ limit: '200kb' }))

const allowedEmail = (process.env.ALLOWED_EMAIL || 'joogwankim@gmail.com').toLowerCase()
const enableRealPurchase = process.env.ENABLE_REAL_PURCHASE === 'true'
const confirmPurchase = process.env.CONFIRM_PURCHASE === 'true'

const dhlUserId = process.env.DHL_USER_ID || ''
const dhlUserPassword = process.env.DHL_USER_PASSWORD || ''
const dhlLoginUrl = process.env.DHL_LOGIN_URL || 'https://www.dhlottery.co.kr/login'
const dhlGameUrl = process.env.DHL_GAME_URL || 'https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40'

const browserHeadless = process.env.BROWSER_HEADLESS !== 'false'
const browserPlatformSpoof = process.env.BROWSER_PLATFORM_SPOOF || 'Win32'
const navigationTimeoutMs = Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 60000)
const actionDelayMs = Number(process.env.BROWSER_ACTION_DELAY_MS || 120)
const maxGameCount = Number(process.env.PURCHASE_MAX_GAMES || 5)
const captureScreenshotEnabled = process.env.CAPTURE_SCREENSHOT === 'true'

function sanitizeGames(games) {
  if (!Array.isArray(games)) return []

  return games
    .filter(game => Array.isArray(game) && game.length === 6)
    .map(game => game.map(number => Number.parseInt(String(number), 10)).filter(Number.isInteger))
    .filter(numbers => numbers.length === 6)
    .filter(numbers => numbers.every(number => number >= 1 && number <= 45))
    .filter(numbers => new Set(numbers).size === 6)
}

function formatGames(games) {
  return games.map(game => game.map(number => String(number).padStart(2, '0')))
}

function parsePayload(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid payload' }

  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const actor = typeof body.actor === 'string' ? body.actor.toLowerCase() : ''
  const dryRun = Boolean(body.dryRun)
  const drawNo = body.drawNo ?? null
  const submittedAt = typeof body.submittedAt === 'string' ? body.submittedAt : null
  const games = sanitizeGames(body.games)

  if (!requestId) return { ok: false, error: 'requestId is required' }
  if (!actor) return { ok: false, error: 'actor is required' }
  if (Array.isArray(body.games) && body.games.length > maxGameCount) {
    return { ok: false, error: `games can contain at most ${maxGameCount} entries` }
  }
  if (games.length === 0) return { ok: false, error: 'games must contain at least one valid 6-number game' }

  return {
    ok: true,
    payload: {
      requestId,
      actor,
      dryRun,
      drawNo,
      submittedAt,
      games
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function logStep(trace, message) {
  trace.push(`${new Date().toISOString()} ${message}`)
}

async function clickFirst(frame, selectors) {
  for (const selector of selectors) {
    const handle = await frame.$(selector)
    if (!handle) continue

    try {
      const box = await handle.boundingBox()
      if (box) {
        await handle.click({ delay: 25 })
      } else {
        await handle.evaluate(element => element.click())
      }
      return selector
    } catch {
      // Try next selector.
    }
  }

  return ''
}

async function clickByText(frame, textCandidates) {
  const token = await frame.evaluate(candidates => {
    const normalize = value => String(value || '').replace(/\s+/g, '').trim()
    const wanted = candidates.map(normalize).filter(Boolean)
    if (wanted.length === 0) return ''

    const nodes = Array.from(document.querySelectorAll('button,a,input[type="button"],input[type="submit"],span,div,label'))
    for (const node of nodes) {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (rect.width < 1 || rect.height < 1) continue

      const raw = node instanceof HTMLInputElement ? node.value : node.textContent
      const text = normalize(raw)
      if (!text) continue
      if (text.length > 24) continue

      if (wanted.some(w => text === w || text.includes(w))) {
        node.click()
        return String(raw || '').slice(0, 24)
      }
    }

    return ''
  }, textCandidates)

  return token
}

async function clickNumber(frame, number) {
  const control = await frame.evaluate(target => {
    const byValue = document.querySelector(`#checkNumGroup input[name="check645num"][value="${target}"]`)
    const byId = document.getElementById(`check645num${target}`)
    const input = byValue || byId
    if (!(input instanceof HTMLInputElement)) return { ok: false, method: 'not-found' }

    const selectedBefore = Array.from(document.querySelectorAll('input[name="check645num"]:checked')).length
    if (input.checked) {
      return { ok: true, method: `already:${input.id || target}`, selectedBefore, selectedAfter: selectedBefore }
    }

    const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null
    if (label instanceof HTMLElement) {
      label.click()
    } else {
      input.click()
    }

    // Fallback: force checkbox checked and trigger onchange handler.
    if (!input.checked) {
      input.checked = true
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const selectedAfter = Array.from(document.querySelectorAll('input[name="check645num"]:checked')).length
    return {
      ok: input.checked,
      method: label instanceof HTMLElement ? `label:${input.id || target}` : `input:${input.id || target}`,
      selectedBefore,
      selectedAfter
    }
  }, number)
  if (control.ok) return control

  return { ok: false, method: 'not-found' }
}

async function readVisibleAlert(frame) {
  return frame.evaluate(() => {
    const layer = document.querySelector('#popupLayerAlert')
    if (!layer) return ''

    const style = window.getComputedStyle(layer)
    const visible = style.display !== 'none' && style.visibility !== 'hidden'
    if (!visible) return ''

    const message = layer.querySelector('.layer-message')?.textContent?.trim() || ''
    const closeButton = layer.querySelector('input[type="button"], button, a.close')
    if (closeButton instanceof HTMLElement) {
      closeButton.click()
    }

    return message
  })
}

function classifyPurchaseBlock(message) {
  const normalized = String(message || '').replace(/\s+/g, '')
  if (!normalized) return ''

  if (
    normalized.includes('구매한도') ||
    normalized.includes('모두채우셨습니다') ||
    (normalized.includes('한도') && normalized.includes('구매'))
  ) {
    return 'limit-exceeded'
  }

  if (normalized.includes('예치금') && (normalized.includes('부족') || normalized.includes('없'))) {
    return 'insufficient-balance'
  }

  if (normalized.includes('판매') && (normalized.includes('마감') || normalized.includes('종료') || normalized.includes('불가'))) {
    return 'sale-closed'
  }

  return 'blocked'
}

async function readPurchaseBlocker(frame) {
  return frame.evaluate(() => {
    const visible = element => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    const closeLayer = root => {
      if (!(root instanceof HTMLElement)) return
      const close = root.querySelector('input[type="button"], button, a.close')
      if (close instanceof HTMLElement) close.click()
    }

    const alertLayer = document.querySelector('#popupLayerAlert')
    if (visible(alertLayer)) {
      const message = alertLayer?.querySelector('.layer-message')?.textContent?.trim() || ''
      closeLayer(alertLayer)
      if (message) return { message, source: 'popupLayerAlert' }
    }

    const recommendLayer = document.querySelector('#recommend720Plus')
    if (visible(recommendLayer)) {
      const message =
        recommendLayer?.querySelector('.cont1')?.textContent?.trim() ||
        recommendLayer?.querySelector('.status')?.textContent?.trim() ||
        recommendLayer?.textContent?.trim() ||
        ''
      closeLayer(recommendLayer)
      if (message) return { message, source: 'recommend720Plus' }
    }

    return { message: '', source: '' }
  })
}

async function selectManualMode(frame) {
  return frame.evaluate(() => {
    const manualTab = document.querySelector('#num1')
    if (manualTab instanceof HTMLElement) {
      manualTab.click()
      return true
    }

    const byText = Array.from(document.querySelectorAll('button,a,label,span,div')).find(node => {
      const text = String(node.textContent || '').replace(/\s+/g, '').trim()
      return text.includes('혼합선택') || text === '수동선택' || text === '수동'
    })

    if (byText) {
      byText.click()
      return true
    }

    return false
  })
}

async function readReportRows(frame) {
  return frame.evaluate(() => {
    return Array.from(document.querySelectorAll('#reportRow li'))
      .map(item => {
        const numbers = Array.from(item.querySelectorAll('div.nums span'))
          .map(span => span.textContent?.trim() || '')
          .filter(Boolean)
        return numbers
      })
      .filter(game => game.length > 0)
  })
}

async function captureScreenshot(page, requestId, stage) {
  const filepath = path.join(os.tmpdir(), `lotto-${requestId}-${stage}.png`)
  await page.screenshot({ path: filepath, fullPage: true })
  return filepath
}

async function loginToDhlottery(page, trace) {
  logStep(trace, `login:start ${dhlLoginUrl}`)
  await page.goto(dhlLoginUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs })

  await page.waitForSelector('#inpUserId', { timeout: navigationTimeoutMs })
  await page.$eval('#inpUserId', element => {
    element.value = ''
  })
  await page.$eval('#inpUserPswdEncn', element => {
    element.value = ''
  })

  await page.type('#inpUserId', dhlUserId, { delay: 30 })
  await page.type('#inpUserPswdEncn', dhlUserPassword, { delay: 30 })

  const waitNavigation = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs })
    .catch(() => null)

  await page.click('#btnLogin')
  await waitNavigation
  await sleep(900)

  const stillOnLogin = await page.$('#inpUserId')
  if (stillOnLogin) {
    const maybeMessage = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('.layer-message,.ui-dialog-content,.error,.alert-msg,.login-error,.message')
      )
      const first = candidates
        .map(element => {
          const style = window.getComputedStyle(element)
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          if (!visible) return ''

          const text = element.textContent?.trim() || ''
          if (text.toLowerCase().includes('caps lock')) return ''

          return text
        })
        .find(text => text.length > 0)
      return first || ''
    })

    throw new Error(maybeMessage || 'Login failed (still on login page)')
  }

  logStep(trace, `login:ok ${page.url()}`)
}

async function openGameFrame(page, trace) {
  logStep(trace, `game:start ${dhlGameUrl}`)
  await page.goto(dhlGameUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs })

  await page.waitForSelector('#ifrm_tab', { timeout: navigationTimeoutMs })
  const iframe = await page.$('#ifrm_tab')
  if (!iframe) {
    throw new Error('Game iframe #ifrm_tab was not found')
  }

  const frame = await iframe.contentFrame()
  if (!frame) {
    throw new Error('Unable to access game iframe content')
  }

  await frame.waitForSelector('body', { timeout: navigationTimeoutMs })
  await sleep(1200)

  const alertMessage = await readVisibleAlert(frame)
  if (alertMessage) {
    logStep(trace, `game:alert ${alertMessage}`)
  }

  if (alertMessage.includes('세션이 해제') || alertMessage.includes('로그인')) {
    throw new Error(alertMessage)
  }

  logStep(trace, 'game:iframe-ready')
  return frame
}

async function addOneGame(frame, numbers, index, trace) {
  const beforeRows = await readReportRows(frame)

  await frame.evaluate(() => {
    if (typeof resetNumber645 === 'function') {
      resetNumber645()
    }
    const auto = document.querySelector('#checkAutoSelect')
    if (auto instanceof HTMLInputElement) {
      auto.checked = false
    }
  })
  await selectManualMode(frame)

  for (const number of numbers) {
    let clicked = await clickNumber(frame, number)
    if (!clicked.ok) {
      // Retry once for transient UI race.
      await sleep(80)
      clicked = await clickNumber(frame, number)
    }

    if (!clicked.ok) {
      const selectedValues = await frame.evaluate(() => {
        return Array.from(document.querySelectorAll('input[name="check645num"]:checked'))
          .map(element => (element instanceof HTMLInputElement ? element.value : ''))
          .filter(Boolean)
      })
      throw new Error(
        `Failed to click number ${number} in game line ${index + 1} (selected=${selectedValues.join(',')})`
      )
    }

    const selectionMeta =
      typeof clicked.selectedBefore === 'number' && typeof clicked.selectedAfter === 'number'
        ? ` ${clicked.selectedBefore}->${clicked.selectedAfter}`
        : ''
    logStep(trace, `game:${index + 1}:pick:${number} via ${clicked.method}${selectionMeta}`)
    await sleep(actionDelayMs)
  }

  const checkedCount = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('input[name="check645num"]:checked')).length
  })
  if (checkedCount !== 6) {
    throw new Error(`Expected 6 selected numbers before confirm, got ${checkedCount}`)
  }

  const confirmSelector = await clickFirst(frame, ['#btnSelectNum', 'input#btnSelectNum', 'button#btnSelectNum'])
  if (!confirmSelector) {
    const confirmText = await clickByText(frame, ['확인', '번호확정', '선택완료', '등록'])
    if (!confirmText) {
      throw new Error(`Failed to confirm selected numbers for game line ${index + 1}`)
    }
    logStep(trace, `game:${index + 1}:confirm:text:${confirmText}`)
  } else {
    logStep(trace, `game:${index + 1}:confirm:${confirmSelector}`)
  }

  await sleep(600)

  const alertMessage = await readVisibleAlert(frame)
  if (alertMessage) {
    throw new Error(alertMessage)
  }

  const afterRows = await readReportRows(frame)
  logStep(trace, `game:${index + 1}:rows ${beforeRows.length} -> ${afterRows.length}`)
}

async function submitPurchase(frame, trace) {
  const buySelector = await clickFirst(frame, ['#btnBuy', 'button[name="btnBuy"]', 'input[name="btnBuy"]'])
  if (!buySelector) {
    const buyText = await clickByText(frame, ['구매하기', '구매'])
    if (!buyText) {
      throw new Error('Failed to find purchase button')
    }
    logStep(trace, `buy:clicked:text:${buyText}`)
  } else {
    logStep(trace, `buy:clicked:${buySelector}`)
  }

  await sleep(900)

  const blocker = await readPurchaseBlocker(frame)
  if (blocker.message) {
    const status = classifyPurchaseBlock(blocker.message)
    logStep(trace, `buy:blocked:${status}:${blocker.source}:${blocker.message}`)
    return {
      status,
      note: blocker.message,
      blockerSource: blocker.source
    }
  }

  if (!confirmPurchase) {
    return {
      status: 'ready-for-final-confirm',
      note: 'CONFIRM_PURCHASE=false. Purchase confirmation was not executed.'
    }
  }

  const scriptConfirmed = await frame.evaluate(() => {
    if (typeof closepopupLayerConfirm === 'function') {
      closepopupLayerConfirm(true)
      return true
    }
    return false
  })

  if (scriptConfirmed) {
    logStep(trace, 'buy:confirmed:script')
  } else {
    const confirmSelector = await clickFirst(frame, [
      '#popupLayerConfirm .btns input:first-child',
      '#popupLayerConfirm input[type="button"]:first-child'
    ])

    if (!confirmSelector) {
      const confirmText = await clickByText(frame, ['확인'])
      if (!confirmText) {
        throw new Error('Failed to confirm purchase popup')
      }
      logStep(trace, `buy:confirmed:text:${confirmText}`)
    } else {
      logStep(trace, `buy:confirmed:${confirmSelector}`)
    }
  }

  await sleep(1800)
  const postConfirmBlocker = await readPurchaseBlocker(frame)
  if (postConfirmBlocker.message) {
    const status = classifyPurchaseBlock(postConfirmBlocker.message)
    logStep(trace, `buy:post-confirm-blocked:${status}:${postConfirmBlocker.source}:${postConfirmBlocker.message}`)
    return {
      status,
      note: postConfirmBlocker.message,
      blockerSource: postConfirmBlocker.source
    }
  }

  await clickFirst(frame, ['#closeLayer', 'button#closeLayer', 'a#closeLayer'])

  return {
    status: 'purchase-submitted',
    note: 'Purchase confirmation was executed.'
  }
}

async function runDrySimulation(payload) {
  const now = new Date().toISOString()

  return {
    status: 'dry-run-complete',
    executedAt: now,
    drawNo: payload.drawNo,
    gameCount: payload.games.length,
    games: formatGames(payload.games),
    note: 'No real purchase was executed. This only validates the end-to-end queue pipeline.'
  }
}

async function runRealPurchase(payload) {
  if (!enableRealPurchase) {
    return {
      status: 'skipped',
      note: 'ENABLE_REAL_PURCHASE is false. Real purchase is blocked by safety guard.'
    }
  }

  if (!dhlUserId || !dhlUserPassword) {
    return {
      status: 'failed',
      retryRecommended: false,
      error: 'DHL_USER_ID or DHL_USER_PASSWORD is missing'
    }
  }

  const trace = []
  let browser = null
  let screenshotPath = ''

  try {
    browser = await puppeteer.launch({
      headless: browserHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1365,900'
      ],
      defaultViewport: { width: 1365, height: 900 }
    })

    const page = await browser.newPage()
    page.setDefaultTimeout(navigationTimeoutMs)
    page.setDefaultNavigationTimeout(navigationTimeoutMs)

    await page.evaluateOnNewDocument(platform => {
      try {
        Object.defineProperty(window.navigator, 'platform', {
          configurable: true,
          get: () => platform
        })
      } catch {
        // noop
      }

      try {
        Object.defineProperty(window.navigator, 'webdriver', {
          configurable: true,
          get: () => false
        })
      } catch {
        // noop
      }
    }, browserPlatformSpoof)

    page.on('dialog', async dialog => {
      logStep(trace, `dialog:${dialog.type()}:${dialog.message()}`)
      try {
        await dialog.accept()
      } catch {
        // noop
      }
    })

    await loginToDhlottery(page, trace)
    const frame = await openGameFrame(page, trace)

    const games = payload.games.slice(0, maxGameCount)
    for (let index = 0; index < games.length; index += 1) {
      await addOneGame(frame, games[index], index, trace)
    }

    const submitResult = await submitPurchase(frame, trace)
    const reportRows = await readReportRows(frame)
    if (captureScreenshotEnabled) {
      screenshotPath = await captureScreenshot(page, payload.requestId, submitResult.status)
    }

    return {
      status: submitResult.status,
      executedAt: new Date().toISOString(),
      drawNo: payload.drawNo,
      gameCount: games.length,
      games: formatGames(games),
      reportRows,
      screenshotCaptured: Boolean(screenshotPath),
      confirmPurchase,
      trace,
      note: submitResult.note
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown purchase worker error'

    return {
      status: 'failed',
      retryRecommended: false,
      executedAt: new Date().toISOString(),
      drawNo: payload.drawNo,
      gameCount: payload.games.length,
      games: formatGames(payload.games),
      error: message,
      screenshotCaptured: Boolean(screenshotPath),
      trace
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    if (screenshotPath) {
      await fs.unlink(screenshotPath).catch(() => undefined)
    }
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'lotto-purchase-worker',
    revision: process.env.K_REVISION || 'local'
  })
})

app.post('/tasks/purchase', async (req, res) => {
  const parsed = parsePayload(req.body)
  if (!parsed.ok) {
    // Return 200 to acknowledge bad payload and prevent endless task retries.
    return res.status(200).json({ ok: false, acknowledged: true, error: parsed.error })
  }

  const payload = parsed.payload

  if (payload.actor !== allowedEmail) {
    return res.status(200).json({
      ok: false,
      acknowledged: true,
      requestId: payload.requestId,
      error: 'Actor is not allowed'
    })
  }

  try {
    const result = payload.dryRun ? await runDrySimulation(payload) : await runRealPurchase(payload)

    return res.status(200).json({
      ok: true,
      acknowledged: true,
      requestId: payload.requestId,
      actor: payload.actor,
      dryRun: payload.dryRun,
      result
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Worker failed unexpectedly'

    // Return non-2xx on truly unexpected worker crash so Cloud Tasks can retry.
    return res.status(500).json({
      ok: false,
      acknowledged: false,
      requestId: payload.requestId,
      error: message
    })
  }
})

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' })
})

const port = Number(process.env.PORT || 8080)
app.listen(port, () => {
  console.log(`lotto-purchase-worker listening on ${port}`)
})
