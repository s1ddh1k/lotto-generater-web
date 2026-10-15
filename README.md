# lotto-generater-web

Google 로그인 → 랜덤 번호 생성 → 모바일 구매에 집중한 로또 6/45 서비스입니다.
번호 조합 하나를 생성하고, 선택한 **동일 번호로 5게임(5,000원)**을 구매 API에 요청합니다.
QR 스캔, 번호 제외 설정, 구매 상세 로그 화면은 제거했습니다.

## Active architecture

```text
Netlify 웹 → Google 인증을 검증하는 Cloud Run API → 일회성 Cloud Run 구매 Job → 동행복권
```

- `lotto-autobuy-api`: Google 로그인 검증과 서명된 Job 결과 수신
- `lotto-purchase-job`: 구매할 때만 실행되는 HTTP 세션 작업
- Node.js 24 LTS, API 의존성 Express 4와 Google Auth Library 11
- 최소 인스턴스 0, API 최대 인스턴스 1, Job 자동 재시도 0회
- 기존 `lotto-purchase-worker` 서비스, Cloud Tasks 큐, 큐 전용 계정·권한, Chromium/Puppeteer 경로를 제거했습니다.
- `lotto-worker-runtime` 계정은 구매 Job이 사용하며, 동행복권 Secret도 계속 필요합니다.

## Frontend development

```bash
npm install
VITE_ENABLE_AUTOBUY=true \
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
npm run dev
```

- `VITE_GOOGLE_CLIENT_ID`: Google Identity Services 웹 클라이언트 ID. 로컬 로그인에는 Google 설정에 개발 서버 origin도 등록해야 합니다.
- `VITE_ENABLE_AUTOBUY=true`: 로그인 후 구매 버튼을 활성화합니다.
- `VITE_AUTOBUY_API_BASE`: 기본 `/autobuy`. 개발 서버 프록시는 `http://127.0.0.1:8787`을 가리킵니다. 로컬 구매 흐름은 아래 모의 브라우저 테스트로 검증합니다. 운영 Job의 콜백에는 외부에서 접근 가능한 API 주소가 필요합니다.

상단과 메인 버튼은 같은 로그인 창을 엽니다. 로그인 성공 시 번호가 생성되고 `다시 뽑기`로 새 조합을 만듭니다. 인증 토큰과 구매 결과는 메모리에만 유지합니다.

구매 중에는 번호 변경·로그아웃·중복 요청을 막습니다. 완료 또는 확인 대기 상태에서는 현재 번호의 구매 버튼을 잠급니다. 통신 오류, 서버 오류, 읽을 수 없는 응답은 구매 완료나 확정된 실패로 처리하지 않으며 동행복권 구매 내역 확인을 안내합니다. API의 240초 대기보다 긴 260초를 기다린 뒤 확인 필요 상태로 전환합니다. 재로그인만으로 구매를 자동 재시도하지 않습니다.

## Validation

```bash
npm ci
npm ci --prefix backend/autobuy-api
npm run build
npm test
npm --prefix backend/purchase-job run self-test
npx playwright install chromium
npm run test:e2e
npm run test:e2e:report
npm audit
npm audit --prefix backend/autobuy-api
```

단위 테스트는 번호 생성, 구매 결과 해석, 판매 시간, Google 계정 검증, 잘못된 구매 입력 차단, Job 호출과 서명된 콜백, 지연·실패 처리, 드라이런과 콜백 재전송 시 중복 구매 방지를 확인합니다.

브라우저 테스트는 320 / 375 / 414 / 768 / 1440px에서 로그인 전후 화면, 로그인 창과 키보드 포커스, 번호 재생성, 구매 요청 내용, 중복 클릭, 세션 만료·권한 오류, 서버·통신 오류, 응답 지연, 로그아웃을 검증합니다. Google 로그인과 구매 응답은 가로채므로 실제 계정 인증이나 결제가 발생하지 않습니다.

HTML 리포트는 `playwright-report/index.html`입니다. 화면 스크린샷을 각 크기별 테스트에 첨부하며 실패 시 `test-results/`에 스크린샷과 trace를 남깁니다. 기존 Chromium은 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 지정할 수 있습니다.

## Cloud maintenance and deployment

```bash
python3 backend/deploy.py
python3 backend/deploy.py --apply
python3 backend/deploy.py --apply --cleanup-legacy
```

1. 현재 API·Job 설정과 IAM을 사용자 전용 `~/.local/state/lotto-generator-web/cloud-maintenance/<timestamp>/`에 저장합니다. 계정 정보가 포함될 수 있어 Git에 넣지 않습니다.
2. 기존 `lotto-autobuy_cloudbuild` 소스 버킷과 기본 빌드 로그 저장소를 재사용하고, 한 번의 Cloud Build에서 API와 Job 이미지를 함께 만듭니다. `backend/cloudbuild.yaml`은 새 `regular` 작업자 환경을 명시합니다.
3. Job을 새 이미지의 고정 digest로 교체하고, 실제 구매를 하지 않는 `--self-test` 실행을 확인합니다. 기존 Secret 참조와 실구매 확인 설정은 보존합니다.
4. API의 기존 Google 로그인 설정과 허용 origin을 보존하고 옛 워커·큐 환경변수를 제거합니다. 새 리비전의 `/health`, Node.js 24, 미인증 구매 요청의 401 응답을 확인합니다. API 검증 실패 시 기존 트래픽과 Job 이미지로 복구합니다.
5. `--cleanup-legacy`는 API에 옛 연결 설정이 없고 큐가 비었는지 확인한 뒤 옛 워커·빈 큐·큐 전용 서비스 계정과 enqueue 권한을 제거합니다. 검증된 새 이미지에 `latest` 태그를 연결하고 교체된 이전 Job 이미지를 정리합니다.
6. 같은 개인 디렉터리의 `report.json`에 빌드 ID, 검증된 리비전·런타임, 남은 서비스·큐를 기록합니다.

이 검증은 실제 결제를 실행하지 않습니다. 프론트엔드 배포는 별도의 Netlify 작업입니다.

- [API 구성](backend/autobuy-api/README.md)
- [구매 Job 구성](backend/purchase-job/README.md)
- [Cloud Build 출시 채널](https://docs.cloud.google.com/build/docs/release-channels)

## Netlify

`netlify.toml`의 `npm run build` + `dist` 설정과 기존 Google 인증·구매 API 주소를 사용합니다.

- Project URL: https://lottoforunluckypeople.netlify.app
- Admin URL: https://app.netlify.com/projects/lottoforunluckypeople
