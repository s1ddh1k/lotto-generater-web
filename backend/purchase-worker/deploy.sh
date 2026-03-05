#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lotto-autobuy}"
REGION="${REGION:-asia-northeast3}"
SERVICE_NAME="${SERVICE_NAME:-lotto-purchase-worker}"
ALLOWED_EMAIL="${ALLOWED_EMAIL:-joogwankim@gmail.com}"
ENABLE_REAL_PURCHASE="${ENABLE_REAL_PURCHASE:-false}"
CONFIRM_PURCHASE="${CONFIRM_PURCHASE:-false}"

DHL_USER_ID="${DHL_USER_ID:-}"
DHL_USER_PASSWORD="${DHL_USER_PASSWORD:-}"
DHL_USER_ID_SECRET="${DHL_USER_ID_SECRET:-}"
DHL_USER_PASSWORD_SECRET="${DHL_USER_PASSWORD_SECRET:-}"
DHL_LOGIN_URL="${DHL_LOGIN_URL:-https://www.dhlottery.co.kr/login}"
DHL_GAME_URL="${DHL_GAME_URL:-https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40}"

BROWSER_HEADLESS="${BROWSER_HEADLESS:-true}"
BROWSER_PLATFORM_SPOOF="${BROWSER_PLATFORM_SPOOF:-Win32}"
BROWSER_NAVIGATION_TIMEOUT_MS="${BROWSER_NAVIGATION_TIMEOUT_MS:-60000}"
BROWSER_ACTION_DELAY_MS="${BROWSER_ACTION_DELAY_MS:-120}"
PURCHASE_MAX_GAMES="${PURCHASE_MAX_GAMES:-5}"
PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR:-/workspace/.cache/puppeteer}"
CAPTURE_SCREENSHOT="${CAPTURE_SCREENSHOT:-false}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-}"

if [[ "${ENABLE_REAL_PURCHASE}" == "true" ]]; then
  if [[ -z "${DHL_USER_ID}" && -z "${DHL_USER_ID_SECRET}" ]]; then
    echo "DHL_USER_ID or DHL_USER_ID_SECRET is required when ENABLE_REAL_PURCHASE=true"
    exit 1
  fi
  if [[ -z "${DHL_USER_PASSWORD}" && -z "${DHL_USER_PASSWORD_SECRET}" ]]; then
    echo "DHL_USER_PASSWORD or DHL_USER_PASSWORD_SECRET is required when ENABLE_REAL_PURCHASE=true"
    exit 1
  fi
fi

ENV_VARS="ALLOWED_EMAIL=${ALLOWED_EMAIL},ENABLE_REAL_PURCHASE=${ENABLE_REAL_PURCHASE},CONFIRM_PURCHASE=${CONFIRM_PURCHASE},DHL_LOGIN_URL=${DHL_LOGIN_URL},DHL_GAME_URL=${DHL_GAME_URL},BROWSER_HEADLESS=${BROWSER_HEADLESS},BROWSER_PLATFORM_SPOOF=${BROWSER_PLATFORM_SPOOF},BROWSER_NAVIGATION_TIMEOUT_MS=${BROWSER_NAVIGATION_TIMEOUT_MS},BROWSER_ACTION_DELAY_MS=${BROWSER_ACTION_DELAY_MS},PURCHASE_MAX_GAMES=${PURCHASE_MAX_GAMES},PUPPETEER_CACHE_DIR=${PUPPETEER_CACHE_DIR},CAPTURE_SCREENSHOT=${CAPTURE_SCREENSHOT}"

if [[ -n "${DHL_USER_ID}" && -z "${DHL_USER_ID_SECRET}" ]]; then
  ENV_VARS="${ENV_VARS},DHL_USER_ID=${DHL_USER_ID}"
fi
if [[ -n "${DHL_USER_PASSWORD}" && -z "${DHL_USER_PASSWORD_SECRET}" ]]; then
  ENV_VARS="${ENV_VARS},DHL_USER_PASSWORD=${DHL_USER_PASSWORD}"
fi

SECRETS=()
if [[ -n "${DHL_USER_ID_SECRET}" ]]; then
  SECRETS+=("DHL_USER_ID=${DHL_USER_ID_SECRET}:latest")
fi
if [[ -n "${DHL_USER_PASSWORD_SECRET}" ]]; then
  SECRETS+=("DHL_USER_PASSWORD=${DHL_USER_PASSWORD_SECRET}:latest")
fi

SECRET_ARG=""
if [[ "${#SECRETS[@]}" -gt 0 ]]; then
  SECRET_ARG="$(IFS=,; echo "${SECRETS[*]}")"
fi

deploy_cmd=(
  gcloud run deploy "${SERVICE_NAME}"
  --project="${PROJECT_ID}"
  --region="${REGION}"
  --platform=managed
  --source=.
  --clear-base-image
  --no-allow-unauthenticated
  --min-instances=0
  --max-instances=1
  --cpu=1
  --memory=1Gi
  --concurrency=1
  --timeout=900
  --set-env-vars="${ENV_VARS}"
)

if [[ -n "${SECRET_ARG}" ]]; then
  deploy_cmd+=(--set-secrets="${SECRET_ARG}")
fi

if [[ -n "${RUNTIME_SERVICE_ACCOUNT}" ]]; then
  deploy_cmd+=(--service-account="${RUNTIME_SERVICE_ACCOUNT}")
fi

"${deploy_cmd[@]}"

gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)'
