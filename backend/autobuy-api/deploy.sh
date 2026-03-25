#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lotto-autobuy}"
REGION="${REGION:-asia-northeast3}"
SERVICE_NAME="${SERVICE_NAME:-lotto-autobuy-api}"
ALLOWED_EMAIL="${ALLOWED_EMAIL:-joogwankim@gmail.com}"
GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}"
CLOUD_TASKS_LOCATION="${CLOUD_TASKS_LOCATION:-asia-northeast3}"
CLOUD_TASKS_QUEUE="${CLOUD_TASKS_QUEUE:-lotto-purchase-queue}"
CLOUD_TASKS_PROJECT_ID="${CLOUD_TASKS_PROJECT_ID:-$PROJECT_ID}"
PURCHASE_WORKER_URL="${PURCHASE_WORKER_URL:-}"
TASK_OIDC_SERVICE_ACCOUNT="${TASK_OIDC_SERVICE_ACCOUNT:-}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-}"

if [[ -z "${GOOGLE_OAUTH_CLIENT_ID}" ]]; then
  echo "GOOGLE_OAUTH_CLIENT_ID is required"
  echo "Example: GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com ./deploy.sh"
  exit 1
fi

if [[ -z "${PURCHASE_WORKER_URL}" ]]; then
  echo "PURCHASE_WORKER_URL is required"
  echo "Example: PURCHASE_WORKER_URL=https://lotto-purchase-worker-xxxxx.a.run.app ./deploy.sh"
  exit 1
fi

if [[ -z "${TASK_OIDC_SERVICE_ACCOUNT}" ]]; then
  echo "TASK_OIDC_SERVICE_ACCOUNT is required"
  echo "Example: TASK_OIDC_SERVICE_ACCOUNT=cloud-tasks-invoker@lotto-autobuy.iam.gserviceaccount.com ./deploy.sh"
  exit 1
fi

deploy_cmd=(
  gcloud run deploy "${SERVICE_NAME}"
  --project="${PROJECT_ID}"
  --region="${REGION}"
  --platform=managed
  --source=.
  --allow-unauthenticated
  --min-instances=0
  --max-instances=1
  --cpu=1
  --memory=512Mi
  --concurrency=1
  --timeout=300
  --set-env-vars="ALLOWED_EMAIL=${ALLOWED_EMAIL},GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID},CLOUD_TASKS_PROJECT_ID=${CLOUD_TASKS_PROJECT_ID},CLOUD_TASKS_LOCATION=${CLOUD_TASKS_LOCATION},CLOUD_TASKS_QUEUE=${CLOUD_TASKS_QUEUE},PURCHASE_WORKER_URL=${PURCHASE_WORKER_URL},TASK_OIDC_SERVICE_ACCOUNT=${TASK_OIDC_SERVICE_ACCOUNT}"
)

if [[ -n "${RUNTIME_SERVICE_ACCOUNT}" ]]; then
  deploy_cmd+=(--service-account="${RUNTIME_SERVICE_ACCOUNT}")
fi

"${deploy_cmd[@]}"

gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)'
