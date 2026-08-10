# lotto-purchase-worker

Cloud Run worker that receives Cloud Tasks jobs and executes dhlottery purchase automation.

## Endpoints

- `GET /health`
- `POST /tasks/purchase`

`POST /tasks/purchase` is designed for Cloud Tasks + OIDC calls.

## Safety model

- `ENABLE_REAL_PURCHASE=false` (default): blocks real purchase execution.
- `ENABLE_REAL_PURCHASE=true` + `CONFIRM_PURCHASE=false`: 로그인, 회차 및 구매 대기 상태를 검증한 뒤 최종 구매 요청 전에 멈춥니다.
- `ENABLE_REAL_PURCHASE=true` + `CONFIRM_PURCHASE=true`: 최종 구매 요청을 실행하고 성공 응답을 검증합니다.

## Required env vars for real purchase

- `DHL_USER_ID` or `DHL_USER_ID_SECRET`
- `DHL_USER_PASSWORD` or `DHL_USER_PASSWORD_SECRET`

## Main env vars

- `ALLOWED_EMAIL`: allowed actor email (required)
- `ENABLE_REAL_PURCHASE`: `true|false` (default: `false`)
- `CONFIRM_PURCHASE`: `true|false` (default: `false`)
- `PURCHASE_TRANSPORT`: `http|browser` (default: `http`; Cloud Run에서는 빠르고 안정적인 HTTP 세션 방식을 사용)
- `DHL_LOGIN_URL`: login page URL (default: `https://www.dhlottery.co.kr/login`)
- `DHL_GAME_URL`: game page URL (default: `https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40`)
- `DHL_DIRECT_GAME_URL`: direct Lotto 6/45 page used when the wrapper does not expose game controls
- `DHL_USER_ID_SECRET`: Secret Manager secret name for user ID
- `DHL_USER_PASSWORD_SECRET`: Secret Manager secret name for password
- `BROWSER_HEADLESS`: `true|false` (default: `true`)
- `BROWSER_PLATFORM_SPOOF`: navigator platform override (default: `Win32`)
- `BROWSER_NAVIGATION_TIMEOUT_MS`: navigation timeout (default: `60000`)
- `BROWSER_ACTION_DELAY_MS`: click delay between number picks (default: `120`)
- `PURCHASE_MAX_GAMES`: max games per request (default: `5`)
- `PUPPETEER_CACHE_DIR`: browser cache path used at build/runtime (default: `/workspace/.cache/puppeteer`)
- `CAPTURE_SCREENSHOT`: `true|false` (default: `false`, screenshot file is removed after response)

## Run locally

```bash
npm install
ENABLE_REAL_PURCHASE=false npm start
```

## Deploy

This worker now uses `Dockerfile` (instead of default Buildpacks) so Chromium runtime libraries are included.

운영 웹 요청은 Cloud Run 서비스 출구 연결 제한을 피하기 위해 `Dockerfile.job`의 경량 HTTP 작업으로 실행됩니다. API는 일회용 콜백 토큰으로 작업 결과를 기다리므로 별도 PC나 프록시가 필요하지 않습니다.

Dry/safe deploy:

```bash
ENABLE_REAL_PURCHASE=false \
CONFIRM_PURCHASE=false \
./deploy.sh
```

Real purchase deploy:

```bash
ENABLE_REAL_PURCHASE=true \
CONFIRM_PURCHASE=true \
DHL_USER_ID=your_id \
DHL_USER_PASSWORD=your_password \
./deploy.sh
```

Real purchase deploy with Secret Manager:

```bash
ENABLE_REAL_PURCHASE=true \
CONFIRM_PURCHASE=true \
DHL_USER_ID_SECRET=lotto-dhl-user-id \
DHL_USER_PASSWORD_SECRET=lotto-dhl-user-password \
./deploy.sh
```

Use dedicated runtime service account:

```bash
RUNTIME_SERVICE_ACCOUNT=lotto-worker-runtime@lotto-autobuy.iam.gserviceaccount.com \
ENABLE_REAL_PURCHASE=true \
CONFIRM_PURCHASE=true \
DHL_USER_ID_SECRET=lotto-dhl-user-id \
DHL_USER_PASSWORD_SECRET=lotto-dhl-user-password \
./deploy.sh
```
