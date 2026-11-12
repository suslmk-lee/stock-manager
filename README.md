# Stock Manager - 배당금 & 주식 자산 관리

Wails(Go + React) 기반 배당금 및 주식 자산 관리 애플리케이션. 데스크톱(Wails)과 모바일/웹(Fly.io API) 두 가지 환경을 지원합니다.

---

## 시스템 구성도

```
┌─────────────────────────────────────────────────────┐
│                    Supabase PostgreSQL               │
│                   (클라우드 데이터베이스)                │
└────────────────┬──────────────────┬──────────────────┘
                 │                  │
        ┌────────┴────────┐  ┌─────┴──────────────┐
        │  로컬 실행환경    │  │  클라우드 실행환경    │
        │  (데스크톱 PC)   │  │  (Fly.io)          │
        │                 │  │                    │
        │  Wails 앱       │  │  Go API 서버       │
        │  ┌───────────┐  │  │  (cmd/server/)     │
        │  │ Go 백엔드  │  │  │  - API Key 인증    │
        │  │ React 프론트│  │  │  - CORS 제어       │
        │  └───────────┘  │  └─────┬──────────────┘
        └─────────────────┘        │
                              ┌────┴────────────┐
                              │ 모바일/웹 브라우저 │
                              │ (React 프론트엔드) │
                              └─────────────────┘
```

| 구성요소 | 기술 스택 | 호스팅 | 비용 |
| --- | --- | --- | --- |
| **프론트엔드** | React 18, TailwindCSS, Recharts | 로컬 (Wails 내장 / Vite dev) | $0 |
| **백엔드** | Go 1.25, Gin, GORM | 로컬 (Wails 내장) / Fly.io | $0 (무료 티어) |
| **데이터베이스** | PostgreSQL 15 | Supabase | $0 (무료 티어) |

---

## 프로젝트 구조

```
stock-manager/
├── main.go                 # Wails 데스크톱 앱 진입점
├── app.go                  # App 구조체 및 서비스 래퍼 메서드
├── server.go               # Gin REST API 서버 (Wails 내장용)
├── utils.go                # 유틸리티 함수
├── cmd/
│   ├── server/main.go      # 클라우드 독립 API 서버 (Fly.io용)
│   └── migrate/main.go     # SQLite → Supabase 데이터 마이그레이션
├── database/
│   └── db.go               # DB 연결 (SQLite / PostgreSQL 자동 전환)
├── models/                 # GORM 데이터 모델
│   ├── account.go
│   ├── asset.go
│   ├── holding.go
│   ├── transaction.go
│   └── dividend.go
├── services/               # 비즈니스 로직 계층
│   ├── account_service.go
│   ├── asset_service.go
│   ├── holding_service.go
│   ├── transaction_service.go
│   ├── dividend_service.go
│   ├── ticker_service.go
│   └── exchange_rate_service.go
├── frontend/               # React 프론트엔드
│   ├── src/
│   │   ├── api/client.ts   # API 클라이언트 (Wails/HTTP 자동 전환)
│   │   ├── components/     # UI 컴포넌트
│   │   ├── pages/          # 페이지 컴포넌트
│   │   └── types/          # TypeScript 타입 정의
│   ├── .env                # 프론트엔드 환경변수 (VITE_API_URL, VITE_API_KEY)
│   ├── .env.example        # 프론트엔드 환경변수 템플릿
│   └── package.json
├── Dockerfile              # 클라우드 배포용 Docker 이미지
├── fly.toml                # Fly.io 배포 설정
├── .env                    # DB 연결 정보 (gitignored)
└── .env.example            # .env 템플릿
```

---

## 사전 요구사항

- **Go** 1.25+
- **Node.js** 18+
- **Wails CLI** v2 (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
- **Fly CLI** (클라우드 배포 시, `~/.fly/bin/flyctl.exe`)

---

## 환경변수 설정

프로젝트 루트에 `.env` 파일 생성 (`.env.example` 참고):

```env
# DB 연결 방식: "postgres" (Supabase) 또는 빈값 (로컬 SQLite)
DB_TYPE=postgres

# Supabase PostgreSQL 설정
DB_HOST=aws-0-ap-northeast-2.pooler.supabase.com
DB_PORT=5432
DB_USER=postgres.your-project-ref
DB_PASSWORD=YOUR_PASSWORD_HERE
DB_NAME=postgres
DB_SSLMODE=require
DB_LOG_LEVEL=warn
DB_SLOW_MS=1000
DB_MAX_OPEN_CONNS=8
DB_MAX_IDLE_CONNS=4
DB_CONN_MAX_LIFETIME_MIN=30
DB_CONN_MAX_IDLE_TIME_MIN=10

# Google Sheets 연동 (선택)
GOOGLE_SHEETS_ENABLED=false
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_WORKSHEET=2026
GOOGLE_SHEETS_CREDENTIALS_FILE=
# 또는 JSON 문자열 직접 입력
GOOGLE_SHEETS_CREDENTIALS_JSON=
# 성공 로그까지 보고 싶으면 true
GOOGLE_SHEETS_DEBUG=false
```

> `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다.

### Google Sheets 연동 설정

배당금 `생성/수정/삭제` 시 Google Sheet의 `1월~12월` 컬럼(`K~V`)만 자동 반영할 수 있습니다.

1. Google Cloud에서 `Google Sheets API` 활성화
2. 서비스 계정 생성 후 JSON 키 발급
3. 대상 시트를 서비스 계정 이메일에 `편집자`로 공유
4. `.env` 설정:
   - `GOOGLE_SHEETS_ENABLED=true`
   - `GOOGLE_SHEETS_SPREADSHEET_ID=<스프레드시트 ID>`
   - `GOOGLE_SHEETS_WORKSHEET=<탭 이름, 예: 2026>`
   - `GOOGLE_SHEETS_CREDENTIALS_FILE=<서비스계정 JSON 절대경로>`  
     (또는 `GOOGLE_SHEETS_CREDENTIALS_JSON` 사용)

주의:
- 연동 로직은 월 컬럼(`1월~12월`)만 업데이트합니다.
- 우측 합계/환산 컬럼은 시트 수식을 그대로 사용합니다.
- 로그 필터: 콘솔에서 `[GSYNC]`로 검색하면 연동 로그만 빠르게 확인할 수 있습니다.

### .env 파일 탐색 순서 (Wails 빌드 실행파일)

1. 현재 작업 디렉토리 (`./`)
2. 실행파일이 위치한 디렉토리
3. 사용자 설정 디렉토리 (`%APPDATA%\StockManager\`)

배포된 실행파일을 어디서든 실행하려면 `.env`를 `%APPDATA%\StockManager\`에 복사하세요:

```powershell
Copy-Item ".env" "$env:APPDATA\StockManager\.env"
```

---

## 실행 방법

### 1. 로컬 데스크톱 실행 (Wails)

```bash
# 개발 모드 (핫 리로드)
wails dev

# 프로덕션 빌드
wails build
# 실행파일: build/bin/stock-manager.exe (Windows) / build/bin/stock-manager.app (macOS)
```

#### macOS 설치 파일(DMG) 만들기

```bash
scripts/build-dmg.sh              # 이 맥의 아키텍처(Apple Silicon 등)로 빌드
scripts/build-dmg.sh --universal  # Apple Silicon + Intel 겸용
scripts/build-dmg.sh --skip-build # build/bin 의 .app 으로 DMG 만 다시 만들기
# 결과: build/bin/StockManager-<git 버전>-<아키텍처>.dmg
```

- DMG 를 열고 `Stock Manager` 를 `Applications` 로 끌어다 놓으면 설치됩니다.
- 설치한 앱은 `~/Library/Application Support/StockManager/.env` 에서 DB 설정을 읽습니다 (아래 `.env` 탐색 순서 참고).
- 서명은 Wails 의 자체(ad-hoc) 서명입니다. 다른 맥에서 내려받아 열면 "확인되지 않은 개발자" 경고가 뜨므로
  처음 한 번은 앱을 Control-클릭 → 열기 하거나 `xattr -dr com.apple.quarantine "/Applications/Stock Manager.app"` 를 실행하세요.
  경고 없이 배포하려면 Apple Developer ID 서명과 공증(notarization)이 필요합니다.

#### 릴리스와 앱 자동 업데이트

```bash
git tag v1.2.0 && git push origin v1.2.0
```

- 버전 태그(`v*.*.*`)를 올리면 GitHub Actions(`.github/workflows/release.yml`)가 Apple Silicon·Intel 겸용 DMG 를 만들어
  GitHub Release 에 올립니다. 바뀐 점(Release 본문)은 이전 태그 이후 커밋으로 자동 작성됩니다.
- 설치된 앱(macOS)은 켤 때와 3시간마다 최신 Release 를 확인하고, 새 버전이 있으면 사이드바에 **업데이트** 버튼을 띄웁니다.
  사이드바 맨 아래 **버전을 누르면** 바로 확인합니다.
- **지금 설치** 를 누르면 DMG 를 내려받아 서명을 확인한 뒤, 앱이 종료되면 지금 앱을 새 버전으로 바꾸고 다시 엽니다.
  응용 프로그램 폴더 등 쓰기 권한이 있는 곳에 설치된 앱이어야 합니다.
- 버전은 `scripts/build-dmg.sh` 가 `git describe`(또는 `APP_VERSION`)로 앱에 넣습니다. `wails dev`·`wails build` 로 직접 만든 빌드는
  버전이 `dev` 라 업데이트를 확인하지 않습니다.
- Windows 는 새 버전 알림만 하고, 설치는 릴리스 페이지에서 직접 받습니다.

**작동 방식:**

- Wails가 Go 백엔드와 React 프론트엔드를 하나의 데스크톱 앱으로 번들링
- 프론트엔드는 Wails 바인딩을 통해 Go 메서드를 직접 호출
- Go 백엔드가 `.env`의 `DB_TYPE`에 따라 Supabase 또는 SQLite에 연결
- 앱을 켜면 이 PC의 6자리 PIN을 묻는다 (PC마다 따로, 처음 실행 때 만든다). '이 PC 기억하기'를 켜면 해제할 때까지 묻지 않는다.
  기록은 `~/Library/Application Support/StockManager/lock.json`(Windows 는 `%APPDATA%\StockManager\lock.json`)에만 있다.
- 내장 REST API 서버(`127.0.0.1:8080`)는 기본으로 꺼져 있다. 웹 화면을 이 PC 데이터로 개발할 때만 `.env` 에
  `STOCK_MANAGER_LOCAL_API=1` 을 넣어 켠다 (인증이 없으므로 이 PC 안에서만 받는다). 모바일·웹은 Fly 서버에 붙는다.

### 2. 프론트엔드만 로컬 실행 (웹 브라우저)

Fly.io 클라우드 백엔드에 연결하여 브라우저에서 사용:

```bash
cd frontend
# .env 파일에 VITE_API_URL / VITE_API_KEY 설정 시 자동 적용
npm run dev
```

`frontend/.env`:

```env
VITE_API_URL=https://stock-manager-api-patient-cloud-8941.fly.dev/api
VITE_API_KEY=YOUR_API_KEY_HERE
```

**작동 방식:**

- Vite 개발 서버가 `localhost:3000`에서 React 앱 실행
- `window.go` 객체가 없으므로 자동으로 HTTP 모드 전환
- `VITE_API_URL`에 지정된 Fly.io API로 모든 요청 전송
- `VITE_API_KEY`가 있으면 `Authorization: Bearer <VITE_API_KEY>` 헤더 자동 첨부

---

## 클라우드 배포

### 백엔드 (Fly.io)

독립 API 서버(`cmd/server/main.go`)를 Docker 컨테이너로 Fly.io에 배포합니다.

#### 초기 배포

```powershell
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"

# 1. Fly.io 로그인
& $fly auth login

# 2. 앱 생성
& $fly launch --no-deploy

# 3. DB 시크릿 설정
& $fly secrets set `
  DB_HOST="aws-0-ap-northeast-2.pooler.supabase.com" `
  DB_PORT="5432" `
  DB_USER="postgres.your-project-ref" `
  DB_PASSWORD="YOUR_PASSWORD" `
  DB_NAME="postgres" `
  DB_SSLMODE="require"

# 4. API 인증 키 설정
& $fly secrets set API_KEY="YOUR_RANDOM_API_KEY"

# 5. 배포
& $fly deploy
```

#### 업데이트 배포

```powershell
git add . && git commit -m "update" && git push
& "$env:USERPROFILE\.fly\bin\flyctl.exe" deploy
```

#### 로컬에서 flyctl로 수동 배포 (macOS/Linux/WSL)

Fly 앱은 로컬 `.env` 파일을 자동으로 읽지 않습니다. 배포 환경 변수는 `fly secrets`로 등록해야 합니다.

```bash
# 0) 앱명 설정
APP="stock-manager-api-patient-cloud-8941"

# 1) 로그인
fly auth login

# 2) 필수 시크릿 설정 (예시)
fly secrets set \
  DB_HOST="aws-0-ap-northeast-2.pooler.supabase.com" \
  DB_PORT="5432" \
  DB_USER="postgres.your-project-ref" \
  DB_PASSWORD="YOUR_PASSWORD" \
  DB_NAME="postgres" \
  DB_SSLMODE="require" \
  API_KEY="YOUR_RANDOM_API_KEY" \
  -a "$APP"

# 3) Google Sheets 연동 시 (권장: JSON 문자열을 secret으로 저장)
# 서비스계정 JSON 파일을 1줄 JSON으로 변환
GS_JSON="$(python3 - <<'PY'
import json
print(json.dumps(json.load(open('/absolute/path/service-account.json', encoding='utf-8')), separators=(',', ':')))
PY
)"

fly secrets set \
  GOOGLE_SHEETS_ENABLED=true \
  GOOGLE_SHEETS_SPREADSHEET_ID="YOUR_SPREADSHEET_ID" \
  GOOGLE_SHEETS_WORKSHEET="2026" \
  GOOGLE_SHEETS_CREDENTIALS_JSON="$GS_JSON" \
  -a "$APP"

# 4) 배포
fly deploy -a "$APP" --remote-only

# 5) 확인
fly releases -a "$APP"
fly logs -a "$APP"
curl -sS "https://$APP.fly.dev/health"
```

#### fly.toml 주요 설정

| 항목 | 값 | 설명 |
| --- | --- | --- |
| `GIN_MODE` | `release` | Gin 프로덕션 모드 |
| `DB_TYPE` | `postgres` | PostgreSQL 사용 |
| `DB_LOG_LEVEL` | `warn` | 운영 시 SQL 로그 최소화 |
| `DB_MAX_OPEN_CONNS` | `8` | DB 동시 연결 상한 (과도한 연결 방지) |
| `DB_MAX_IDLE_CONNS` | `4` | 유휴 연결 유지 수 |
| `PORT` | `8080` | API 서버 포트 |

#### 헬스체크

```
GET https://<app-name>.fly.dev/health
→ {"status": "ok"}
```

### 데이터베이스 (Supabase)

- **서비스**: [Supabase](https://supabase.com/) PostgreSQL
- **호스트**: Session Pooler (IPv4 호환) 사용
- **스키마 관리**: GORM AutoMigrate로 자동 생성/업데이트
- **데이터 마이그레이션**: `cmd/migrate/main.go`로 SQLite → PostgreSQL 이관

```bash
# SQLite → Supabase 데이터 마이그레이션 (최초 1회)
go run ./cmd/migrate/
```

---

## 보안

### API 인증 (Fly.io 백엔드)

클라우드 백엔드는 `API_KEY` 환경변수가 설정되면 모든 `/api/*` 요청에 인증을 요구합니다.

```
Authorization: Bearer <API_KEY>
# 또는
X-API-Key: <API_KEY>
```

- `API_KEY` 미설정 시: 인증 없이 공개 접근 (경고 로그 출력)
- `API_KEY` 설정 시: 키 없는 요청은 `401 Unauthorized` 반환
- `/health` 엔드포인트는 인증 불필요

### CORS 제어

```powershell
# 특정 도메인만 허용
& $fly secrets set CORS_ORIGINS="http://localhost:3000,https://your-domain.com"
```

미설정 시 모든 Origin 허용.

### 환경변수 관리

| 변수 | 관리 방식 | 설명 |
| --- | --- | --- |
| `DB_PASSWORD` | `.env` (로컬), Fly Secrets (클라우드) | DB 비밀번호 |
| `API_KEY` | Fly Secrets | API 인증 키 |
| `CORS_ORIGINS` | Fly Secrets | 허용 Origin 목록 |
| `VITE_API_KEY` | `frontend/.env` | 웹 프론트에서 API 호출 시 Authorization 헤더용 키 |
| `GOOGLE_SHEETS_CREDENTIALS_FILE` | 로컬 파일 경로 / 서버 파일 경로 | Google 서비스계정 JSON 파일 경로 |
| `GOOGLE_SHEETS_CREDENTIALS_JSON` | Fly Secrets 또는 서버 환경변수 | 서비스계정 JSON 문자열 |

---

## 데이터베이스 스키마

### Account (계좌)

- 여러 개의 증권 계좌 관리
- 통화(Currency), 시장구분(MarketType) 설정
- 각 계좌별로 보유 종목, 거래 내역, 배당금 추적

### Asset (자산)

- 주식(Stock) 또는 ETF 정보
- Ticker 심볼로 고유 식별, 섹터(Sector) 분류

### Holding (보유 종목)

- 계좌와 자산을 연결, 보유 수량 및 평균 매수가 관리

### Transaction (거래)

- 매수(Buy) / 매도(Sell) 기록
- 거래 일자, 가격, 수량, 수수료 추적

### Dividend (배당금)

- 배당금 수령 내역, 세금 정보, 수령 여부 추적

### 주요 관계

```
Account 1:N Holding
Asset   1:N Holding
Account 1:N Transaction
Asset   1:N Transaction
Account 1:N Dividend
Asset   1:N Dividend
```

### 인덱스 최적화

- **Holding**: `idx_account_asset` (AccountID, AssetID 복합 인덱스)
- **Transaction**: AccountID, AssetID, Date 인덱스
- **Dividend**: AccountID, AssetID, Date 인덱스

### 데이터베이스 파일 위치 (SQLite 모드)

- Windows: `%APPDATA%\StockManager\dividend_app.db`
- macOS: `~/Library/Application Support/StockManager/dividend_app.db`
- Linux: `~/.config/StockManager/dividend_app.db`

---

## API 엔드포인트

자세한 API 문서는 [API_DOCS.md](./API_DOCS.md)를 참고하세요.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 헬스체크 |
| GET | `/api/accounts` | 전체 계좌 조회 |
| POST | `/api/accounts` | 계좌 생성 |
| PUT | `/api/accounts/:id` | 계좌 수정 |
| DELETE | `/api/accounts/:id` | 계좌 삭제 |
| GET | `/api/assets` | 전체 자산 조회 |
| POST | `/api/assets` | 자산 생성 |
| GET | `/api/holdings` | 전체 보유종목 조회 |
| POST | `/api/transactions` | 거래 생성 |
| GET | `/api/accounts/:id/dividends` | 계좌별 배당금 조회 |
| POST | `/api/dividends` | 배당금 생성 |
| GET | `/api/dividends/stats` | 배당금 통계 |
| GET | `/api/dividends/monthly` | 월별 배당금 |
| GET | `/api/ticker/info?ticker=AAPL` | 종목 정보 조회 |
| GET | `/api/ticker/price?ticker=AAPL` | 현재가 조회 |
| GET | `/api/exchange-rate/usd-krw` | 환율 조회 |

---

## 트러블슈팅

### Supabase 연결 실패

- **DNS 오류**: Direct Connection 대신 **Session Pooler** 호스트 사용 (IPv4 호환)
- **비밀번호 특수문자**: `.env`에서 따옴표 없이 그대로 입력

### Wails 빌드 실행파일이 SQLite를 사용

- `.env` 파일이 실행 경로에 없을 수 있음
- `%APPDATA%\StockManager\.env`에 복사하면 해결

### Fly.io 배포 후 서버 미응답

- DB Secrets 설정 확인: `flyctl secrets list`
- 로그 확인: `flyctl logs --app <app-name>`

### flyctl 명령 미인식

- PATH 미등록 상태 → 전체 경로 사용: `& "$env:USERPROFILE\.fly\bin\flyctl.exe"`
