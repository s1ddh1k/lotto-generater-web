import crypto from 'node:crypto'

class PurchaseHttpError extends Error {
  constructor(status, message, blockerSource = '') {
    super(message)
    this.status = status
    this.blockerSource = blockerSource
  }
}

class HttpSession {
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs
    this.cookies = new Map()
  }

  async request(url, options = {}, redirects = 5) {
    const { retryNetworkErrors = true, ...fetchOptions } = options
    const headers = new Headers(options.headers || {})
    headers.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36'
    )
    if (this.cookies.size > 0) {
      headers.set('Cookie', Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; '))
    }

    let response
    try {
      response = await fetch(url, {
        ...fetchOptions,
        headers,
        redirect: 'manual',
        signal: fetchOptions.signal || AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      if (!retryNetworkErrors) throw error
      await new Promise(resolve => setTimeout(resolve, 250))
      response = await fetch(url, {
        ...fetchOptions,
        headers,
        redirect: 'manual',
        signal: fetchOptions.signal || AbortSignal.timeout(this.timeoutMs)
      })
    }

    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const separator = pair.indexOf('=')
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }

    const location = response.headers.get('location')
    if (redirects > 0 && location && response.status >= 300 && response.status < 400) {
      const preserveMethod = response.status === 307 || response.status === 308
      return this.request(
        new URL(location, url).href,
        preserveMethod ? options : { method: 'GET', retryNetworkErrors },
        redirects - 1
      )
    }

    return response
  }
}

function hexToBuffer(value) {
  return Buffer.from(value.length % 2 === 0 ? value : `0${value}`, 'hex')
}

function rsaEncrypt(value, modulus, exponent) {
  const key = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: hexToBuffer(modulus).toString('base64url'),
      e: hexToBuffer(exponent).toString('base64url')
    },
    format: 'jwk'
  })

  return crypto
    .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(value))
    .toString('hex')
}

function extractInputValue(html, id) {
  return html.match(new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)`, 'i'))?.[1] || ''
}

function extractElementText(html, id) {
  return html.match(new RegExp(`id=["']${id}["'][^>]*>([^<]*)`, 'i'))?.[1]?.trim() || ''
}

async function responseJson(response, label) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`${label} returned a non-JSON response (HTTP ${response.status})`)
  }
}

function logStep(trace, message) {
  trace.push(`${new Date().toISOString()} ${message}`)
}

export function getLottoSaleWindow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  )
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const closeHour = parts.weekday === 'Sat' ? 20 : 24

  return {
    open: hour >= 6 && hour < closeHour,
    weekday: parts.weekday,
    minutesSinceMidnight: hour * 60 + minute,
    opensAtHour: 6,
    closesAtHour: closeHour
  }
}

async function login(session, config, trace) {
  const portalOrigin = new URL(config.loginUrl).origin
  logStep(trace, `http-login:start ${config.loginUrl}`)
  await session.request(config.loginUrl)

  const rsaResponse = await session.request(`${portalOrigin}/login/selectRsaModulus.do`, {
    headers: { Referer: config.loginUrl }
  })
  const rsa = (await responseJson(rsaResponse, 'RSA key request')).data
  if (!rsa?.rsaModulus || !rsa?.publicExponent) throw new Error('Login encryption key was not returned')

  const body = new URLSearchParams({
    userId: rsaEncrypt(config.userId, rsa.rsaModulus, rsa.publicExponent),
    userPswdEncn: rsaEncrypt(config.password, rsa.rsaModulus, rsa.publicExponent)
  })
  const response = await session.request(`${portalOrigin}/login/securityLoginCheck.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: config.loginUrl
    },
    body
  })

  if (!response.url.includes('/login/loginSuccess.do') || !session.cookies.has('userId')) {
    throw new Error(`Login failed (final URL: ${response.url})`)
  }
  logStep(trace, 'http-login:ok')
}

function parsePurchasedGames(values) {
  if (!Array.isArray(values)) return []
  return values
    .map(value =>
      String(value)
        .slice(0, -1)
        .split('|')
        .map(token => Number.parseInt(token, 10))
        .filter(number => Number.isInteger(number) && number >= 1 && number <= 45)
        .slice(-6)
        .map(number => String(number).padStart(2, '0'))
    )
    .filter(game => game.length === 6)
}

function classifyFailure(result) {
  const message = String(result?.resultMsg || '')
  const normalized = message.replace(/\s+/g, '')
  if (String(result?.resultCode) === '-7' || normalized.includes('한도')) return 'limit-exceeded'
  if (normalized.includes('예치금') && normalized.includes('부족')) return 'insufficient-balance'
  if (normalized.includes('판매') || normalized.includes('구매시간')) return 'sale-closed'
  return 'failed'
}

export async function runHttpPurchase(payload, config) {
  const trace = []
  const requestedGames = payload.games.map(game => game.map(number => String(number).padStart(2, '0')))
  const session = new HttpSession(config.timeoutMs)
  const gameUrl = config.directGameUrl.replace('/olotto/game/game645.do', '/olotto/game_mobile/game645.do')
  const gameOrigin = new URL(gameUrl).origin

  try {
    const saleWindow = getLottoSaleWindow()
    if (!saleWindow.open) {
      throw new PurchaseHttpError(
        'sale-closed',
        '현재는 로또 인터넷 판매시간이 아닙니다. 일~금 06:00~24:00, 토요일 06:00~20:00에 구매할 수 있습니다.',
        'sale-hours'
      )
    }

    await login(session, config, trace)
    logStep(trace, `http-game:start ${gameUrl}`)
    const gameResponse = await session.request(gameUrl, {
      headers: { Referer: `${new URL(config.loginUrl).origin}/main` }
    })
    const gameHtml = await gameResponse.text()
    const round = extractElementText(gameHtml, 'curRound')
    const drawDate = extractInputValue(gameHtml, 'ROUND_DRAW_DATE')
    const payLimitDate = extractInputValue(gameHtml, 'WAMT_PAY_TLMT_END_DT')
    if (!round || !drawDate || !payLimitDate || !gameHtml.includes('/olotto/game/execBuy.do')) {
      throw new Error('Current Lotto game metadata was not found')
    }
    logStep(trace, `http-game:ready round=${round}`)

    const pageInfoResponse = await session.request(`${gameOrigin}/olotto/game/MoPageMngInfo.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: gameUrl },
      body: ''
    })
    const pageInfo = await responseJson(pageInfoResponse, 'Mobile page check')
    if (Number(pageInfo.moCnt || 0) > 0) {
      throw new PurchaseHttpError('blocked', '현재 모바일 구매 페이지를 사용할 수 없습니다.')
    }

    const readyResponse = await session.request(`${gameOrigin}/olotto/game/egovUserReadySocket.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', Referer: gameUrl },
      body: ''
    })
    const ready = await responseJson(readyResponse, 'Purchase queue check')
    if (Number(ready.ready_cnt || 0) > 0 || !ready.ready_ip) {
      throw new PurchaseHttpError(
        'blocked',
        `현재 구매 대기 인원이 있어 실행하지 않았습니다. (${Number(ready.ready_cnt || 0)}명)`
      )
    }
    logStep(trace, 'http-game:queue-ready')

    if (!config.confirmPurchase) {
      return {
        status: 'ready-for-final-confirm',
        executedAt: new Date().toISOString(),
        drawNo: payload.drawNo || round,
        gameCount: payload.games.length,
        games: requestedGames,
        submittedGames: requestedGames,
        confirmPurchase: false,
        trace,
        note: 'HTTP 구매 세션과 최종 요청 데이터를 검증했습니다. 최종 결제는 실행하지 않았습니다.'
      }
    }

    const alphabet = ['A', 'B', 'C', 'D', 'E']
    const params = payload.games.map((game, index) => ({
      arrGameChoiceNum: game.join(','),
      genType: '1',
      alpabet: alphabet[index]
    }))
    const body = new URLSearchParams({
      round,
      direct: String(ready.ready_ip),
      nBuyAmount: String(payload.games.length * 1000),
      param: JSON.stringify(params),
      ROUND_DRAW_DATE: drawDate,
      WAMT_PAY_TLMT_END_DT: payLimitDate,
      gameCnt: String(payload.games.length),
      saleMdaDcd: '20'
    })
    logStep(trace, 'http-buy:submit')
    const response = await session.request(`${gameOrigin}/olotto/game/execBuy.do`, {
      method: 'POST',
      retryNetworkErrors: false,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: gameOrigin,
        Referer: gameUrl,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body
    })
    const purchase = await responseJson(response, 'Purchase request')
    if (purchase.loginYn === 'N') throw new PurchaseHttpError('failed', '구매 세션이 만료되었습니다.')
    if (purchase.isAllowed === 'N') {
      throw new PurchaseHttpError('blocked', '동행복권에서 구매 요청을 허용하지 않았습니다.')
    }
    if (purchase.isGameManaged === 'Y' || purchase.checkOltSaleTime === false) {
      throw new PurchaseHttpError('sale-closed', purchase.errorMsg || '현재는 구매 가능한 시간이 아닙니다.')
    }

    const result = purchase.result || {}
    if (String(result.resultCode) !== '100') {
      throw new PurchaseHttpError(classifyFailure(result), result.resultMsg || '동행복권 구매 요청이 실패했습니다.')
    }

    const observedGames = parsePurchasedGames(result.arrGameChoiceNum)
    logStep(trace, 'http-buy:receipt-verified')
    return {
      status: 'purchase-submitted',
      executedAt: new Date().toISOString(),
      drawNo: payload.drawNo || result.buyRound || round,
      gameCount: payload.games.length,
      games: requestedGames,
      submittedGames: requestedGames,
      reportRows: observedGames,
      reportRowsAfterSubmit: observedGames,
      confirmPurchase: true,
      trace,
      note: '동행복권 구매 응답과 영수증 번호를 확인했습니다.',
      blockerSource: 'execBuy.do'
    }
  } catch (error) {
    const flowError = error instanceof PurchaseHttpError
    return {
      status: flowError ? error.status : 'failed',
      retryRecommended: false,
      executedAt: new Date().toISOString(),
      drawNo: payload.drawNo,
      gameCount: payload.games.length,
      games: requestedGames,
      submittedGames: requestedGames,
      note: flowError ? error.message : '',
      error: flowError ? '' : error instanceof Error ? error.message : 'Unknown HTTP purchase error',
      blockerSource: flowError ? error.blockerSource : '',
      trace
    }
  }
}
