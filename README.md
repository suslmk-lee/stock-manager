# Dividend & Stock Asset Management

Wails 기반 배당금 및 주식 자산 관리 데스크톱 애플리케이션

## 데이터베이스 스키마

### 1. Account (계좌)
- 여러 개의 증권 계좌 관리
- 통화(Currency) 설정 가능
- 각 계좌별로 보유 종목, 거래 내역, 배당금 추적

### 2. Asset (자산)
- 주식(Stock) 또는 ETF 정보
- Ticker 심볼로 고유 식별
- 섹터(Sector) 분류

### 3. Holding (보유 종목)
- 계좌와 자산을 연결
- 보유 수량 및 평균 매수가 관리
- 거래 발생 시 자동 업데이트

### 4. Transaction (거래)
- 매수(Buy) / 매도(Sell) 기록
- 거래 일자, 가격, 수량, 수수료 추적
- 거래 발생 시 Holding 테이블 자동 업데이트

### 5. Dividend (배당금)
- 배당금 수령 내역
- 세금 정보 포함
- 수령 여부 추적

## 데이터베이스 파일 위치
- Windows: `%APPDATA%\StockManager\dividend_app.db`
- macOS: `~/Library/Application Support/StockManager/dividend_app.db`
- Linux: `~/.config/StockManager/dividend_app.db`

## 주요 관계
- Account 1:N Holding
- Asset 1:N Holding
- Account 1:N Transaction
- Asset 1:N Transaction
- Account 1:N Dividend
- Asset 1:N Dividend

## 인덱스 최적화
- Holding: `idx_account_asset` (AccountID, AssetID 복합 인덱스)
- Transaction: AccountID, AssetID, Date 인덱스
- Dividend: AccountID, AssetID, Date 인덱스
