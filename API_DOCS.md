# Stock Manager API 명세서 (모바일용)

**Base URL**: `http://<서버IP>:8080/api`
**Content-Type**: `application/json`

`API_KEY`가 서버에 설정된 경우 인증 헤더가 필요합니다:

```http
Authorization: Bearer <API_KEY>
# 또는
X-API-Key: <API_KEY>
```

---

## 1. 계좌 관리 (Accounts)

### 1.1 계좌 목록 조회
- **Method**: `GET`
- **Path**: `/accounts`
- **Response**:
```json
[
  {
    "id": 1,
    "name": "미국 배당주",
    "broker": "토스증권",
    "account_number": "123-45-67890",
    "market_type": "International", // "Domestic" | "International"
    "currency": "USD",
    "account_type": "General" // 아래 계좌 유형 참고
  }
]
```

### 1.2 계좌 생성
- **Method**: `POST`
- **Path**: `/accounts`
- **Request Body**:
```json
{
  "name": "미국 배당주",
  "broker": "토스증권",
  "account_number": "123-45-67890",
  "market_type": "International",
  "currency": "USD",
  "description": "설명",
  "account_type": "General" // 선택, 생략 시 "General"
}
```

**계좌 유형 (`account_type`)**

| 값 | 의미 | 인출 제한 |
|----|------|-----------|
| `General` | 일반 계좌 | 없음 |
| `ISA` | ISA 계좌 | 없음 |
| `Pension` | 연금저축 | 있음 |
| `IRP` | 개인형 퇴직연금(IRP) | 있음 |
| `DC` | 확정기여형 퇴직연금(DC) | 있음 |

허용되지 않은 값은 `invalid account type: X` 오류를 반환합니다. 수정(PUT) 시 생략하면 기존 값을 유지합니다.
기존 계좌는 마이그레이션 시 이름/설명으로 자동 분류됩니다.

### 1.3 계좌 수정
- **Method**: `PUT`
- **Path**: `/accounts/:id`

### 1.4 계좌 삭제
- **Method**: `DELETE`
- **Path**: `/accounts/:id`

### 1.5 특정 계좌의 배당금 목록 조회
- **Method**: `GET`
- **Path**: `/accounts/:id/dividends`

### 1.6 특정 계좌의 보유 자산 목록 조회
- **Method**: `GET`
- **Path**: `/accounts/:id/holdings`

---

## 2. 자산 관리 (Assets)

### 2.1 전체 자산 목록 조회
- **Method**: `GET`
- **Path**: `/assets`
- **Response**:
```json
[
  {
    "id": 1,
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "type": "Stock", // "Stock" | "ETF"
    "sector": "Technology",
    "holdings": [
      {
        "id": 1,
        "account_id": 1,
        "quantity": 10.5,
        "average_price": 150.0
      }
    ]
  }
]
```

### 2.2 티커로 자산 조회
- **Method**: `GET`
- **Path**: `/assets/ticker/:ticker`

### 2.3 자산 생성
- **Method**: `POST`
- **Path**: `/assets`
- **Request Body**:
```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "type": "Stock",
  "sector": "Technology",
  "account_id": 1, // 최초 생성 시 연결할 계좌 ID (선택)
  "quantity": 10.5,
  "average_price": 150.0
}
```

### 2.4 자산 수정
- **Method**: `PUT`
- **Path**: `/assets/:id`
- **Request Body**: `{"name": "...", "type": "...", "sector": "..."}`

### 2.5 자산 삭제
- **Method**: `DELETE`
- **Path**: `/assets/:id`

---

## 3. 보유 현황 (Holdings)

### 3.1 보유 자산 생성 (특정 계좌에 특정 자산 추가)
- **Method**: `POST`
- **Path**: `/holdings`
- **Request Body**:
```json
{
  "account_id": 1,
  "asset_id": 1,
  "quantity": 10.5,
  "average_price": 150.0
}
```

### 3.2 보유 수량/단가 수정
- **Method**: `PUT`
- **Path**: `/holdings/:id`
- **Request Body**: `{"quantity": 15.0, "average_price": 145.0}`

### 3.3 보유 자산 삭제
- **Method**: `DELETE`
- **Path**: `/holdings/:id`

---

## 4. 거래 내역 (Transactions)

### 4.1 계좌별 거래 내역 조회
- **Method**: `GET`
- **Path**: `/accounts/:id/transactions`

### 4.2 자산별 거래 내역 조회
- **Method**: `GET`
- **Path**: `/assets/:id/transactions`

### 4.3 거래 기록 생성
- **Method**: `POST`
- **Path**: `/transactions`
- **Request Body**:
```json
{
  "account_id": 1,
  "asset_id": 1,
  "type": "Buy", // "Buy" | "Sell"
  "date": "2024-03-10",
  "price": 150.0,
  "quantity": 5.0,
  "fee": 1.5,
  "notes": "추가 매수"
}
```

---

## 5. 배당금 (Dividends)

### 5.1 배당금 기록 생성
- **Method**: `POST`
- **Path**: `/dividends`
- **Request Body**:
```json
{
  "account_id": 1,
  "asset_id": 1,
  "date": "2024-03-10",
  "amount": 15.50,
  "tax": 2.32,
  "currency": "USD",
  "is_received": true,
  "notes": "1분기 배당"
}
```

### 5.2 배당금 기록 수정
- **Method**: `PUT`
- **Path**: `/dividends/:id`

### 5.3 배당금 기록 삭제
- **Method**: `DELETE`
- **Path**: `/dividends/:id`

### 5.4 월별 배당금 통계 (차트용)
- **Method**: `GET`
- **Path**: `/dividends/monthly?startDate=2023-01-01&endDate=2024-03-10`

### 5.5 특정 계좌의 월별 배당금 통계
- **Method**: `GET`
- **Path**: `/dividends/monthly/account/:accountId?startDate=2023-01-01&endDate=2024-03-10`

### 5.6 배당금 요약 통계
- **Method**: `GET`
- **Path**: `/dividends/stats`
- **Response**:
```json
{
  "total_dividends_usd": 150.50,
  "total_dividends_krw": 0,
  "total_tax_usd": 22.57,
  "total_tax_krw": 0,
  "received_count": 12,
  "pending_count": 0
}
```

---

## 6. 유틸리티 (Utilities)

### 6.1 현재 환율 조회 (USD -> KRW)
- **Method**: `GET`
- **Path**: `/exchange-rate/usd-krw`
- **Response**: `1320.50` (Number)

### 6.2 티커 정보 검색 (Yahoo Finance)
- **Method**: `GET`
- **Path**: `/ticker/info?ticker=AAPL`
- **Response**:
```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "type": "Stock",
  "sector": "Technology"
}
```

### 6.3 현재가 조회
- **Method**: `GET`
- **Path**: `/ticker/price?ticker=AAPL`
- **Response**:
```json
{
  "price": 170.55,
  "currency": "USD",
  "change_percent": -1.2
}
```

## 7. 포트폴리오 스냅샷 (Snapshots)

### 7.1 월별 스냅샷 요약 (총자산 추이용)
- **Method**: `GET`
- **Path**: `/snapshots/monthly-summary`
- **Query**: `months` (선택, 기본 36, 1~60으로 보정, 잘못된 값은 기본값) - 현재 월로 끝나는 최근 N개월(KST 기준)
- **설명**: 월별/계좌별/통화별로 스냅샷 평가금액을 합산합니다. 연, 월, 계좌 ID 오름차순. 데이터가 없으면 `[]`. 스냅샷이 없는 달은 거래내역과 과거 월봉 시세로 추정해 `estimated: true`로 반환합니다(월초 수량 x 직전 달 종가, 통화는 종목 통화 그대로).
- **Response**:
```json
[
  {
    "year": 2026,
    "month": 9,
    "account_id": 1,
    "currency": "KRW",
    "total_value": 12500000,
    "asset_count": 4,
    "estimated": false
  }
]
```
- **Wails**: `GetMonthlySnapshotSummary(months)`

## 8. 매매 신호 (Signals)

규칙 기반 매매 신호. 지표는 "실질손익"(평가손익 + 실현손익 + 세후배당) 기준이며 금액은 각 값의 통화별로 현재 USD/KRW 환율로 KRW 환산합니다.

### 8.1 규칙 조회
- **Method/Path**: `GET /signal-rules`
- **설명**: 전역 기본 규칙("균형")과 종목별 오버라이드를 반환합니다. 기본 규칙이 없으면 최초 조회 시 자동 생성됩니다.
- **Response**: `{ "default": SignalRule, "overrides": [SignalRule] }`
- **Wails**: `GetSignalRules()`

### 8.2 기본 규칙 저장
- **Method/Path**: `PUT /signal-rules/default` (body: SignalRule)
- **Wails**: `SaveDefaultSignalRule(rule)`

### 8.3 종목별 규칙 저장/삭제
- **Method/Path**: `PUT /signal-rules/asset/:assetId` (body: SignalRule, 업서트) / `DELETE /signal-rules/asset/:assetId` -> `{"status":"success"}`
- **Wails**: `SaveAssetSignalRule(assetID, rule)`, `DeleteAssetSignalRule(assetID)`

SignalRule 필드: `id, asset_id(0=기본), take_profit_enabled, take_profit_pct, stop_loss_enabled, stop_loss_pct(<=0), weight_enabled, target_weight_pct, weight_band_pct(>=0), dividend_payback_enabled, dividend_payback_pct, dividend_payback_min_return_pct, low_yield_enabled, low_yield_pct, buy_dip_enabled, buy_dip_pct(<=0), high_yield_enabled, high_yield_pct, sell_mode("any"|"all"), buy_mode("any"|"all"), created_at, updated_at`

검증 실패(모드 값 오류, NaN/Inf, 부호 위반 등)는 `400 {"error": "..."}`. 빈 모드는 `any`로 저장됩니다.

### 8.4 신호 리포트
- **Method/Path**: `GET /signals`
- **Wails**: `GetSignals()`
- **설명**: 현재 보유 수량이 있는 종목별 신호. 정렬: SELL, CONFLICT, BUY, HOLD, NO_PRICE 순, 같은 액션 내에서는 `market_value_krw` 내림차순.
- **Response**:
```json
{
  "generated_at": "2026-06-01T09:00:00+09:00",
  "usd_krw": 1380.5,
  "summary": { "sell": 1, "buy": 0, "hold": 3, "conflict": 0, "no_price": 0 },
  "items": [
    {
      "asset_id": 1, "ticker": "AAPL", "name": "Apple", "currency": "USD",
      "action": "SELL", "rule_source": "default", "restricted_only": false,
      "quantity": 20, "avg_price": 110, "current_price": 150,
      "market_value_krw": 4141500, "cost_krw": 3000000, "total_return_krw": 1200000,
      "dividends_krw": 12800, "dividends_12m_krw": 8500,
      "unrealized_pct": 36.3, "total_return_pct": 40, "dividend_payback_pct": 0.4,
      "current_yield_pct": 0.2, "yield_on_cost_pct": 0.3, "weight_pct": 35, "from_avg_pct": 36.3,
      "sell_checks": [ { "code": "take_profit", "label": "목표 수익률", "met": true, "value": 40, "threshold": 30, "unit": "%" } ],
      "buy_checks": [],
      "accounts": [ { "account_id": 1, "account_name": "메인", "broker": "토스", "account_type": "General", "restricted": false, "quantity": 20, "avg_price": 110, "market_value_krw": 4141500 } ]
    }
  ]
}
```
- 체크 코드: 매도 `take_profit`, `stop_loss`, `weight_over`, `dividend_payback`, `low_yield` / 매수 `buy_dip`, `weight_under`, `high_yield`. 활성화된 규칙만 포함됩니다.
- 시세가 없으면 `action: "NO_PRICE"`, 체크는 빈 배열이며 비중 계산에서 제외됩니다.