# lotto-generater-web

기존 Gatsby 기반 프로젝트를 Vite + React + TypeScript 스택으로 교체한 버전입니다.

## Tech Stack

- Vite
- React 18
- TypeScript
- Vitest
- @yudiel/react-qr-scanner

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Test

```bash
npm run test
```

## Netlify

현재 프로젝트는 `lottoforunluckypeople` 사이트에 링크되어 있습니다.
배포 설정은 `netlify.toml`을 기준으로 `npm run build` + `dist` publish를 사용합니다.

- Project URL: https://lottoforunluckypeople.netlify.app
- Admin URL: https://app.netlify.com/projects/lottoforunluckypeople

## Local Auto-Buy Chain

아래 3개를 각각 다른 터미널에서 실행하면 로컬 end-to-end가 됩니다.

1) purchase-worker 실행 (`:8080`)

```bash
cd backend/purchase-worker
npm install
ENABLE_REAL_PURCHASE=true \
CONFIRM_PURCHASE=false \
DHL_USER_ID="$(gcloud secrets versions access latest --secret=lotto-dhl-user-id --project=lotto-autobuy)" \
DHL_USER_PASSWORD="$(gcloud secrets versions access latest --secret=lotto-dhl-user-password --project=lotto-autobuy)" \
npm start
```

2) autobuy-api 실행 (`:8787`, Google 인증 + direct worker)

```bash
cd backend/autobuy-api
npm install
PORT=8787 \
LOCAL_MODE=false \
DIRECT_WORKER_MODE=true \
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com \
ALLOWED_EMAIL=joogwankim@gmail.com \
PURCHASE_WORKER_URL=http://127.0.0.1:8080 \
npm start
```

3) 프론트 실행 (`:5173`)

```bash
VITE_ENABLE_AUTOBUY=true \
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
npm run dev
```

프론트의 `자동구매 API 호출` 버튼은 `VITE_ENABLE_AUTOBUY=true`일 때만 표시됩니다.
프론트는 랜덤 번호를 1게임만 생성하고, 구매 API 호출 시 동일 번호를 5게임으로 전송합니다.
