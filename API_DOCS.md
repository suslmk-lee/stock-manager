# Stock Manager API 명세서 (모바일용)

**Base URL**: `http://<서버IP>:8080/api`
**Content-Type**: `application/json`

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
    "accountNumber": "123-45-67890",
    "market_type": "International", // "Domestic" | "International"
    "currency": "USD"
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
  "accountNumber": "123-45-67890",
  "marketType": "International",
  "currency": "USD",
  "description": "설명"
}
```

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
  "accountID": 1, // 최초 생성 시 연결할 계좌 ID (선택)
  "quantity": 10.5,
  "averagePrice": 150.0
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
  "accountID": 1,
  "assetID": 1,
  "quantity": 10.5,
  "averagePrice": 150.0
}
```

### 3.2 보유 수량/단가 수정
- **Method**: `PUT`
- **Path**: `/holdings/:id`
- **Request Body**: `{"quantity": 15.0, "averagePrice": 145.0}`

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
  "accountID": 1,
  "assetID": 1,
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
  "accountID": 1,
  "assetID": 1,
  "date": "2024-03-10",
  "amount": 15.50,
  "tax": 2.32,
  "currency": "USD",
  "isReceived": true,
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
