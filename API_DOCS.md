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

2단계 추가 필드: `from_high_enabled, from_high_pct(<=0, 기본 -20), below_ma_enabled, below_ma_pct(<=0, 기본 -5, 200일 이평 대비), above_ma_enabled, above_ma_pct(>=0, 기본 25), dividend_cut_enabled, dividend_cut_pct(>=0, 기본 10), tax_harvest_enabled(기본 true), tax_harvest_from_month(1~12, 기본 11, 0은 11로 저장), fx_historical(기본 true), rule_version(현재 2)`. 신규 4개 시세/배당 규칙은 기본 비활성입니다. `rule_version < 2`인 1단계 규칙은 조회 시 한 번만 새 기본값(`fx_historical`·`tax_harvest_enabled`=true, 월=11, 0인 퍼센트는 기본값)으로 보정되어 저장되며, 이후 저장 시 `rule_version`은 항상 2로 기록됩니다.

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
- 2단계 체크 코드: 매도 `above_ma`(장기 이평 과열), `dividend_cut`(배당 삭감) / 매수 `from_high`(52주 고점 대비 하락), `below_ma`(장기 이평 하회). 규칙이 활성화되어 있으면 항상 목록에 포함되며, 데이터가 없으면 `met=false`, `value=0`입니다.
- 수익률 기반 체크(`take_profit`, `stop_loss`, `dividend_payback`의 최소 수익률)는 `return_basis=="fx"`이면 `total_return_pct_fx`, 아니면 `total_return_pct`로 평가하며 `value`도 같은 기준입니다.

#### 8.4.1 2단계 추가 응답 필드

SignalItem 추가 필드:
- 시세 추세(종목 통화, 0=없음): `high_52w`, `low_52w`, `ma200`, `from_high_pct`((현재가/52주고점-1)x100), `from_low_pct`, `vs_ma200_pct`((현재가/MA200-1)x100), `price_history_ok`(52주 고점 존재 && 일봉 20개 이상). 일봉 이력이 없거나 20개 미만이면 `from_*`/`vs_ma200_pct`는 0입니다.
- 배당 추세(전 계좌 세전 배당, 당시 계좌별 보유 수량으로 주당 환산): `dps_12m`, `dps_prev_12m`, `dividend_change_pct`, `dividend_trend_ok`(최근/직전 12개월 모두 지급 이력이 있을 때 true).
- 매수 시점 환율 기준 수익: `cost_krw_fx`, `total_return_pct_fx`, `fx_effect_krw`(= fx 기준 총수익 - 현재 환율 기준 `total_return_krw`), `fx_coverage_pct`(거래 이력으로 복원된 수량 / 보유 수량 x100), `return_basis`(`"fx"` | `"current"`).
  - 보유분 원가: 계좌별 이동평균 재생(매수일 환율, 이력에 없는 수량은 현재 환율·평단으로 보정). 매도분 원가: `buy_avg_price x 수량 x 매도일 환율`. 실현손익은 `profit x 매도일 환율`, 배당은 `(세전-세금) x 지급일 환율`.
  - `return_basis`가 `"fx"`인 조건: 규칙의 `fx_historical=true` && USD 시세 종목 && 환율 이력 로드 성공. 그 외에는 `"current"`이며, KRW 종목이거나 환율 이력이 없으면 fx 필드는 현재 환율 기준 값과 같습니다(`fx_coverage_pct`는 KRW 종목 100, 환율 이력 없는 USD 종목 0).
- `tax_hint`: `{ "kind": "harvest_gain" | "harvest_loss", "amount_krw": number, "message": string }` 또는 `null`. 규칙의 `tax_harvest_enabled`가 true, USD 상장 종목, 기본 규칙의 `tax_harvest_from_month` 이후 달, 일반계좌 평가손익 조건을 만족할 때만 표시됩니다.

리포트 최상위 `tax`: 올해(KST) 일반계좌 해외주식(USD) 실현손익 기준 양도세 요약 (모든 종목 포함, 환율은 일별 이력 사용, 이력 실패 시 현재 환율).
```json
"tax": { "year": 2026, "realized_gain_krw": 0, "realized_loss_krw": 0, "net_krw": 0, "exemption_krw": 2500000, "remaining_krw": 2500000, "estimated_tax_krw": 0, "harvest_window": false, "count": 0 }
```