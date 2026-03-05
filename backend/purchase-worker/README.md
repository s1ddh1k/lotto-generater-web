# lotto-purchase-worker

Cloud Run worker that receives Cloud Tasks jobs and executes dhlottery purchase automation.

## Endpoints

- `GET /health`
- `POST /tasks/purchase`

`POST /tasks/purchase` is designed for Cloud Tasks + OIDC calls.

## Safety model

- `ENABLE_REAL_PURCHASE=false` (default): blocks real purchase execution.
- `ENABLE_REAL_PURCHASE=true` + `CONFIRM_PURCHASE=false`: runs browser flow but stops before final buy confirmation.
- `ENABLE_REAL_PURCHASE=true` + `CONFIRM_PURCHASE=true`: executes final confirmation click.

## Required env vars for real purchase

- `DHL_USER_ID` or `DHL_USER_ID_SECRET`
- `DHL_USER_PASSWORD` or `DHL_USER_PASSWORD_SECRET`

## Main env vars

- `ALLOWED_EMAIL`: allowed actor email (default: `joogwankim@gmail.com`)
- `ENABLE_REAL_PURCHASE`: `true|false` (default: `false`)
- `CONFIRM_PURCHASE`: `true|false` (default: `false`)
- `DHL_LOGIN_URL`: login page URL (default: `https://www.dhlottery.co.kr/login`)
- `DHL_GAME_URL`: game page URL (default: `https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40`)
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
