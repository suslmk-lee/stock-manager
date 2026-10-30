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
- **설명**: "기본" 전략 프로필의 규칙(예전 평면 SignalRule 모양, `asset_id=0`, `rule_version=3`)을 `default` 로, 종목별 오버라이드를 `overrides` 로 반환합니다. (전역 기본 규칙 행은 보존되지만 평가에는 쓰이지 않고, 최초 조회 시 "기본" 프로필로 복사됩니다.) 규칙 적용 우선순위는 종목 오버라이드 > 배정된 프로필 > 기본 프로필입니다. 자세한 내용은 §10.
- **Response**: `{ "default": SignalRule, "overrides": [SignalRule] }`
- **Wails**: `GetSignalRules()`

### 8.2 기본 규칙 저장
- **Method/Path**: `PUT /signal-rules/default` (body: SignalRule) - "기본" 전략 프로필의 규칙을 갱신합니다 (구버전 클라이언트가 `crash_pct` 를 보내지 않으면 0 -> -40 으로 정규화).
- **Wails**: `SaveDefaultSignalRule(rule)`

### 8.3 종목별 규칙 저장/삭제
- **Method/Path**: `PUT /signal-rules/asset/:assetId` (body: SignalRule, 업서트) / `DELETE /signal-rules/asset/:assetId` -> `{"status":"success"}`
- **Wails**: `SaveAssetSignalRule(assetID, rule)`, `DeleteAssetSignalRule(assetID)`

SignalRule 필드: `id, asset_id(0=기본), take_profit_enabled, take_profit_pct, stop_loss_enabled, stop_loss_pct(<=0), weight_enabled, target_weight_pct, weight_band_pct(>=0), dividend_payback_enabled, dividend_payback_pct, dividend_payback_min_return_pct, low_yield_enabled, low_yield_pct, buy_dip_enabled, buy_dip_pct(<=0), high_yield_enabled, high_yield_pct, sell_mode("any"|"all"), buy_mode("any"|"all"), created_at, updated_at`

2단계 추가 필드: `from_high_enabled, from_high_pct(<=0, 기본 -20), below_ma_enabled, below_ma_pct(<=0, 기본 -5, 200일 이평 대비), above_ma_enabled, above_ma_pct(>=0, 기본 25), dividend_cut_enabled, dividend_cut_pct(>=0, 기본 10), tax_harvest_enabled(기본 true), tax_harvest_from_month(1~12, 기본 11, 0은 11로 저장), fx_historical(기본 true), rule_version(현재 3)`. 신규 4개 시세/배당 규칙은 기본 비활성입니다. `rule_version < 2`인 1단계 규칙은 조회 시 한 번만 새 기본값(`fx_historical`·`tax_harvest_enabled`=true, 월=11, 0인 퍼센트는 기본값)으로 보정되어 저장되며, 이후 저장 시 `rule_version`은 항상 최신(3)으로 기록됩니다.

3단계 추가 필드: `crash_enabled`(기본 false), `crash_pct`(<=0, 기본 -40, "큰 폭락 경고"). `rule_version < 3` 행은 한 번만 `crash_pct=-40`(0일 때), `crash_enabled=false` 로 보정됩니다. 규칙 필드는 DB/JSON 모두 평면이며, 내부적으로는 `SignalRuleConfig` 로 묶여 전략 프로필과 공유됩니다.

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
      "action": "SELL", "rule_source": "default", "profile_id": 1, "profile_key": "default", "profile_name": "기본", "profile_kind": "standard", "sell_disabled": false, "restricted_only": false,
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
- `rule_source`: `"asset"`(종목 오버라이드) | `"profile"`(배정된 프로필) | `"default"`(배정 없음 = 기본 프로필). `profile_*` 는 종목이 속한 프로필(오버라이드가 있어도 동일)이며, `sell_disabled=true` 는 적용된 규칙에 켜진 매도 체크가 없다는 뜻입니다.
- 체크 코드: 매도 `take_profit`, `stop_loss`, `weight_over`, `dividend_payback`, `low_yield` / 매수 `buy_dip`, `weight_under`, `high_yield`. 활성화된 규칙만 포함됩니다.
- 시세가 없으면 `action: "NO_PRICE"`, 체크는 빈 배열이며 비중 계산에서 제외됩니다.
- 3단계 체크 코드: 매도 `crash`(큰 폭락 경고: 수익률 기준 반환 값 <= `crash_pct`)
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

---

## 9. 신호 알림 (Signal Alerts)

신호 계산(`GET /api/signals`, `POST /api/signals/check`) 때마다 종목별 신호 상태를 이전 상태와 비교해 변화 이력(이벤트)을 기록합니다. 신호 상태 테이블이 비어 있는 최초 실행에서는 기준선만 저장하고 이벤트를 만들지 않으며, `NO_PRICE` 종목은 무시합니다. 이벤트는 최대 500개까지 보관합니다.

이벤트 종류: 관망에서 SELL/BUY/CONFLICT 로 전환("{라벨}로 전환 · {충족 조건}"), 같은 신호에서 새 조건 충족("새 조건 충족 · {새 조건}"), 신호 해제("신호 해제 · 관망", 항상 읽음 처리). 알림 설정에서 꺼진 종류(`notify_*`)이거나 `enabled=false` 이면 이력에는 남지만 읽음 상태로 저장됩니다.

이벤트 `kind`: `"signal"`(기본, 기존 행의 빈 값도 `signal` 로 취급) | `"suggestion"`(전략 프로필 추천, `to_action="SUGGEST"`, `suggested_profile_id`=추천 프로필 id, 없으면 0). 추천 이벤트는 알림 설정의 `enabled` 만 따르고 `notify_sell/buy/conflict` 필터는 무시합니다. 자세한 규칙은 §10.4.

### 9.1 이벤트 목록
`GET /api/signal-events?limit=50&unread_only=false`
```json
{ "events": [ { "id": 1, "asset_id": 3, "ticker": "AAPL", "name": "Apple", "from_action": "HOLD", "to_action": "SELL",
  "met_codes": "take_profit", "message": "매도 검토로 전환 · 목표 수익률", "total_return_pct": 40.1, "current_price": 210.5,
  "currency": "USD", "created_at": "2026-01-01T09:00:00Z", "read_at": null } ], "unread_count": 1 }
```
최신순. `limit` 기본 50, 최대 500.

### 9.2 읽음 처리
`POST /api/signal-events/read` — 본문 `{ "ids": [1, 2], "all": false }` (`all=true` 이면 전체) → `{ "unread_count": 0 }`

### 9.3 읽지 않은 개수
`GET /api/signal-events/unread-count` → `{ "unread_count": 2 }`

### 9.4 즉시 점검
`POST /api/signals/check` → `{ "new_events": [SignalEvent...], "unread_count": 3 }` (이번 점검에서 생긴 읽지 않은 이벤트만 `new_events`)

### 9.5 알림 설정
`GET /api/notification-settings`, `PUT /api/notification-settings`
```json
{ "enabled": true, "interval_minutes": 60, "os_notify": true, "notify_sell": true, "notify_buy": true, "notify_conflict": true, "updated_at": "..." }
```
`interval_minutes` 는 15, 30, 60, 180, 360 만 허용(그 외 400).

### 9.6 데스크톱 전용
- 데스크톱 알림: 추천 이벤트만 있으면 제목 "전략 프로필 추천", 본문 "{종목명}: {message}" (여러 건이면 "프로필 후보 N건 · {종목명} 외").
- Wails 바인딩: `GetSignalEvents(limit, unreadOnly)`, `MarkSignalEventsRead(ids, all)`, `GetUnreadSignalCount()`, `CheckSignals()`, `GetNotificationSettings()`, `SaveNotificationSettings(s)`.
- 데스크톱 앱은 시작 20초 후부터 `interval_minutes` 주기로 백그라운드 점검을 하며(설정 저장 시 즉시 재시작), 새 읽지 않은 이벤트가 있으면 Wails 이벤트 `signals:new`(payload: SignalEvent[])를 발생시키고 `os_notify` 이면 Windows 알림을 1회 표시합니다. 클라우드 서버(cmd/server)는 백그라운드 점검과 OS 알림이 없으며, 클라이언트가 `POST /api/signals/check` 를 호출할 때만 기록됩니다.

---

## 10. 전략 프로필 (Signal Profiles)

종목마다 다른 매매 신호 규칙 묶음(전략 프로필)을 적용합니다. 규칙 적용 우선순위: **종목 오버라이드(§8.3) > 배정된 프로필 > 기본 프로필**. 배정 행이 없는 종목은 "기본" 프로필입니다.

내장 프로필(최초 사용 시 멱등하게 생성, 삭제/이름·종류 변경 불가, 규칙은 수정 가능):
- `default` "기본"(kind `standard`): 기존 전역 기본 규칙 행(asset_id=0)이 있으면 그 사본, 없으면 기본값. 기존 행은 삭제하지 않지만 이후 평가에는 쓰지 않습니다.
- `dividend` "배당 장기보유"(kind `dividend`): 익절 off(30), 손절 off(-20), **큰 폭락 경고 on(-40)**, 비중/배당회수/저배당/과열/하회 off, 배당 삭감 on(10), 매수 하락 on(-10), 고배당 on(4), 52주 고점 대비 on(-20), 양도세 on(11월), 환율 기준 on, 모드 any.

사용자 정의 프로필은 `key="custom-<랜덤>"`, `built_in=false`.

SignalProfile: `{ id, key, name, description, kind("standard"|"dividend"), built_in, sort_order, asset_count, rule, created_at, updated_at }`. `rule` 은 §8 SignalRule 의 평면 규칙 필드 전체(`take_profit_*` ... `sell_mode`, `buy_mode`, `crash_enabled`, `crash_pct`; id/asset_id/rule_version 제외). `asset_count` 는 계산 값(보유 종목 기준, 배정 없는 종목은 기본 프로필에 집계).

오류: 잘못된 입력 `400 {"error"}`, 대상 없음 `404`, 그 외 `500`.

### 10.1 목록
- `GET /api/signal-profiles` -> `{ "profiles": [SignalProfile], "assignments": [ { "asset_id": 1, "profile_id": 2 } ] }` (`sort_order`, 내장 우선). Wails: `GetSignalProfiles()`

### 10.2 생성/수정/삭제/초기화
- `POST /api/signal-profiles` body `{ name, description?, kind, copy_from_profile_id? }` -> SignalProfile (규칙은 지정 프로필 또는 기본 프로필에서 복사). Wails: `CreateSignalProfile(req)`
- `PUT /api/signal-profiles/:id` body `{ name?, description?, kind?, rule? }` -> SignalProfile. 내장 프로필의 name/kind 를 다른 값으로 바꾸면 400, `rule` 은 수정 가능. 규칙 검증은 §8 과 같고 `crash_pct <= 0`(0 은 -40 으로 저장). Wails: `UpdateSignalProfile(id, req)`
- `DELETE /api/signal-profiles/:id` -> `{"status":"success"}`. 내장은 400. 커스텀은 배정을 지워 해당 종목이 기본 프로필로 돌아간 뒤 삭제. Wails: `DeleteSignalProfile(id)`
- `POST /api/signal-profiles/:id/reset` -> SignalProfile. 내장 프로필만(공장 규칙 복원), 그 외 400. Wails: `ResetSignalProfile(id)`

### 10.3 종목 배정
- `PUT /api/signal-profiles/:id/assets` body `{ "asset_ids": [1, 2] }` -> `{ "assignments": [...] }` (전체 배정 목록). 종목을 해당 프로필로 이동하며, 기본 프로필이면 배정을 삭제합니다. 존재하지 않는 종목은 400. 기본 외 프로필에 배정하면 해당 종목의 추천 상태가 `accepted` 가 됩니다. Wails: `AssignSignalProfile(id, assetIDs)` -> `{ assignments }`

### 10.4 배당 장기보유 후보 / 추천
`GET /api/signal-profiles/candidates` -> `{ "candidates": [ { asset_id, ticker, name, score, max_score(6), is_candidate, reasons: [ { code, label, met, detail } ], profile_id, profile_name, has_override } ] }` (보유 종목 전체, 점수 내림차순). Wails: `GetProfileCandidates()` -> 같은 모양.

기준(각 1점): `yield` 배당수익률 3% 이상 / `frequency` 최근 365일 서로 다른 지급일(KST) 4회 이상(detail "분기 4회", 10회 이상은 "월 12회" 형식) / `growth` 주당배당금 증가(추세 OK && 변화 > 0) / `keyword` 배당형 종목명(배당, 고배당, dividend, div, income, 인컴, 커버드콜, covered call, 리츠, reit 포함 또는 SCHD, JEPI, JEPQ, VYM, DGRO, HDV, SPYD, DIVO, NOBL, SDY, VIG, O, QYLD, XYLD) / `sector` 배당 섹터(real estate, 부동산, reit, utilities, 유틸리티) / `pattern` 적립식 장기보유(매수 3건 이상 && 매도 수량 <= 매수 수량의 10%). `is_candidate` = 점수 3 이상 AND (12개월 배당 > 0 OR keyword).

추천 알림(신호 기록과 같은 뮤텍스/트랜잭션에서 처리): 시세가 있고 프로필 배정과 오버라이드가 없는 후보 종목에 대해
- 추천 테이블이 비어 있는 최초 실행이면 현재 후보를 `baseline` 으로만 기록(이벤트 없음).
- 그 외에 추천 행이 없는 후보는 `kind="suggestion"` 이벤트(`to_action="SUGGEST"`, `from_action`=현재 액션, `suggested_profile_id`=dividend 프로필, `met_codes`=충족 기준 코드, `message`="배당 장기보유 프로필 후보 · {충족 라벨, ...}")를 한 번 만들고 `suggested` 로 기록. 자동 배정은 하지 않습니다.
- `suggested/dismissed/accepted/baseline` 인 종목은 다시 제안하지 않습니다.
- `POST /api/signal-profiles/suggestions/:assetId/dismiss` -> `{"status":"success"}`: `dismissed` 로 기록하고 해당 종목의 읽지 않은 추천 이벤트를 읽음 처리(종목 없으면 404). Wails: `DismissProfileSuggestion(assetID)`

### 10.5 마이그레이션 (추가 전용)
새 테이블 `signal_profiles`(규칙 컬럼은 `rule_` 접두사), `asset_signal_profiles`, `profile_suggestions`; 기존 테이블에는 `signal_rules.crash_enabled/crash_pct`, `signal_events.kind/suggested_profile_id` 컬럼만 추가됩니다 (삭제/변경 없음).
