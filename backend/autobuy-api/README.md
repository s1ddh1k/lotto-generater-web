# lotto-autobuy-api

Node.js 24 LTS에서 Google ID 토큰을 검증하고 `lotto-purchase-job`을 실행하는 Cloud Run API입니다. Cloud Tasks, 상시 구매 워커, 로컬 인증 우회 모드는 제거했습니다.

- `GET /health`: 현재 리비전, Node.js 버전, `cloud-run-job` 전송 방식 확인
- `POST /purchase`: 허용된 Google 계정의 Bearer ID 토큰 필요. 1~5게임, 게임당 1~45 사이 중복 없는 6개 번호를 검증합니다. `dryRun`은 기본 `true`이며 실제 구매는 명시적인 `false`가 필요합니다.
- `POST /internal/purchase-job-result/:requestId`: 일회용 256비트 토큰과 요청 ID가 일치하는 Job 콜백만 수신합니다.

구매 요청 하나당 Job 하나를 실행합니다. 실행 요청 자체를 자동 재시도하지 않습니다. 콜백 대기 제한은 240초이고 결과가 불명확하면 구매 내역 확인 후 재시도해야 합니다. 응답의 `worker` 필드와 `completed-direct` 상태 이름은 기존 프론트엔드 호환성을 위해 유지합니다.

## Configuration

- `ALLOWED_EMAIL`: 구매를 허용할 Google 계정
- `GOOGLE_OAUTH_CLIENT_ID`: 웹 Google ID 토큰의 대상 클라이언트 ID
- `PURCHASE_JOB_NAME`: `projects/lotto-autobuy/locations/asia-northeast3/jobs/lotto-purchase-job`
- `PURCHASE_CALLBACK_URL`: API의 `/internal/purchase-job-result` 주소
- `PURCHASE_REQUEST_TIMEOUT_MS`: 기본 `240000`
- `ALLOWED_ORIGINS`: 허용할 웹 origin 목록

실제 서비스 설정은 배포할 때 읽어 보존합니다. 구매 워커 URL, Cloud Tasks 큐와 OIDC 계정 설정은 필요하지 않습니다.

## Deploy

저장소 루트에서 실행합니다.

```bash
python3 backend/deploy.py                          # 설정과 복구 파일 확인
python3 backend/deploy.py --apply                  # API + Job 빌드, 검증, 배포
python3 backend/deploy.py --apply --cleanup-legacy # 배포 검증 후 옛 리소스 정리
```

`deploy.sh`도 같은 명령으로 연결됩니다. 배포 절차와 검증 범위는 [루트 README](../../README.md)를 참고하세요.
