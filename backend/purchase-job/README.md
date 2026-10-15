# lotto-purchase-job

Node.js 24 LTS 표준 라이브러리만 사용하는 일회성 Cloud Run Job입니다. HTTP 세션으로 동행복권 구매 흐름을 실행한 뒤 서명된 콜백으로 API에 결과를 전달합니다. 상시 서버, Chromium, Puppeteer, Express 의존성이 없습니다.

## Execution

일반 실행에는 API가 일회용으로 주입하는 `PURCHASE_PAYLOAD_B64`, `PURCHASE_CALLBACK_URL`, `PURCHASE_CALLBACK_TOKEN`이 필요합니다.

- `ALLOWED_EMAIL`: 허용된 구매 요청자
- `CONFIRM_PURCHASE`: 명시적으로 `true`일 때만 최종 구매 요청을 실행합니다.
- `DHL_USER_ID`, `DHL_USER_PASSWORD`: 기존 Secret Manager 비밀 참조를 사용합니다.
- `DHL_LOGIN_URL`, `DHL_DIRECT_GAME_URL`: 기존 동행복권 주소
- `PURCHASE_HTTP_TIMEOUT_MS`: 기본 `60000`

Job은 1태스크·병렬 1개·자동 재시도 0회·120초 제한을 유지합니다. 구매 요청은 재시도하지 않고, 일시적인 결과 콜백 전송 실패만 최대 3회 재시도합니다. 현재 Job은 `lotto-worker-runtime` 서비스 계정을 계속 사용하므로 이 계정과 동행복권 Secret은 삭제 대상이 아닙니다.

## Purchase-free verification

```bash
npm --prefix backend/purchase-job run self-test
```

배포 스크립트도 컨테이너에 `--self-test` 인수만 주입해 확인합니다. 이 경로는 계정 비밀을 읽거나 동행복권에 접속하지 않고, 하드코딩된 드라이런 입력과 Node.js 버전을 검증합니다. 일반 실행 설정은 변경하지 않습니다.

실제 결제와 Google 계정 로그인이 포함된 전체 운영 구매는 이 검증에 포함되지 않습니다.
