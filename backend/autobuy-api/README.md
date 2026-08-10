# lotto-autobuy-api

Backend API for lotto auto-buy flow.

## Endpoints

- `GET /health`
- `POST /purchase`

`/purchase` requires a Google ID token in `Authorization: Bearer <id_token>`.
Only the account configured through `ALLOWED_EMAIL` is accepted.

When `LOCAL_MODE=true`, Google token verification is bypassed.
When `DIRECT_WORKER_MODE=true`, request is sent directly to purchase-worker (no Cloud Tasks).
When `PURCHASE_JOB_NAME` is set, the API runs the one-shot Cloud Run purchase job and waits for its signed callback. This is the production path.

## Required env vars

- `GOOGLE_OAUTH_CLIENT_ID`: OAuth client ID used to validate ID token audience
- `ALLOWED_EMAIL` (optional): single allowed email address
- `CLOUD_TASKS_LOCATION`: Cloud Tasks queue location (default: `asia-northeast3`)
- `CLOUD_TASKS_QUEUE`: Cloud Tasks queue name (default: `lotto-purchase-queue`)
- `CLOUD_TASKS_PROJECT_ID` (optional): queue project ID (default: `lotto-autobuy`)
- `PURCHASE_WORKER_URL`: Cloud Run purchase worker base URL
- `TASK_OIDC_SERVICE_ACCOUNT`: service account used by Cloud Tasks OIDC call
- `LOCAL_MODE` (optional): `true|false` (default: `false`)
- `LOCAL_ACTOR_EMAIL` (optional): actor email used in local mode
- `DIRECT_WORKER_MODE` (optional): `true|false` (default: `false`)
- `WORKER_REQUEST_TIMEOUT_MS` (optional): direct worker call timeout in ms (default: `120000`)
- `ALLOWED_ORIGINS` (optional): comma-separated browser origins allowed to call the API directly
- `PURCHASE_JOB_NAME` (optional): full Cloud Run Job resource name
- `PURCHASE_CALLBACK_URL` (required with `PURCHASE_JOB_NAME`): API callback URL ending in `/internal/purchase-job-result`
- `RUNTIME_SERVICE_ACCOUNT` (deploy.sh option): Cloud Run runtime service account email

## Run locally

```bash
npm install
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com npm start
```

Local direct mode (Google auth enabled):

```bash
npm install
PORT=8787 \
LOCAL_MODE=false \
DIRECT_WORKER_MODE=true \
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com \
ALLOWED_EMAIL=user@example.com \
PURCHASE_WORKER_URL=http://127.0.0.1:8080 \
npm start
```

## Deploy to Cloud Run

```bash
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com \
PURCHASE_WORKER_URL=https://lotto-purchase-worker-xxxxx.a.run.app \
TASK_OIDC_SERVICE_ACCOUNT=cloud-tasks-invoker@lotto-autobuy.iam.gserviceaccount.com \
RUNTIME_SERVICE_ACCOUNT=lotto-api-runtime@lotto-autobuy.iam.gserviceaccount.com \
PURCHASE_JOB_NAME=projects/lotto-autobuy/locations/asia-northeast3/jobs/lotto-purchase-job \
PURCHASE_CALLBACK_URL=https://your-api.run.app/internal/purchase-job-result \
./deploy.sh
```
