package database

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB() error {
	// .env 파일을 여러 경로에서 탐색 (현재 디렉토리, 실행파일 경로, 사용자 설정 디렉토리)
	loaded := false
	envPaths := []string{}

	// 1. 현재 작업 디렉토리
	envPaths = append(envPaths, ".env")

	// 2. 실행파일이 위치한 디렉토리
	if execPath, err := os.Executable(); err == nil {
		envPaths = append(envPaths, filepath.Join(filepath.Dir(execPath), ".env"))
	}

	// 3. 사용자 설정 디렉토리 (AppData/StockManager)
	if configDir, err := os.UserConfigDir(); err == nil {
		envPaths = append(envPaths, filepath.Join(configDir, "StockManager", ".env"))
	}

	for _, p := range envPaths {
		if err := godotenv.Load(p); err == nil {
			log.Printf("Loaded .env from: %s", p)
			loaded = true
			break
		}
	}
	if !loaded {
		log.Println("No .env file found, using system environment variables")
	}

	dbType := os.Getenv("DB_TYPE")

	var db *gorm.DB
	var err error

	switch dbType {
	case "postgres":
		db, err = connectPostgres()
	default:
		db, err = connectSQLite()
	}

	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	DB = db

	if err := runMigrations(); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

func connectPostgres() (*gorm.DB, error) {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	dbname := os.Getenv("DB_NAME")
	sslmode := os.Getenv("DB_SSLMODE")

	if host == "" || password == "" {
		return nil, fmt.Errorf("DB_HOST and DB_PASSWORD environment variables are required for postgres")
	}
	if port == "" {
		port = "5432"
	}
	if user == "" {
		user = "postgres"
	}
	if dbname == "" {
		dbname = "postgres"
	}
	if sslmode == "" {
		sslmode = "require"
	}

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		host, user, password, dbname, port, sslmode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: newGormLogger(),
	})
	if err != nil {
		return nil, err
	}
	if err := configureConnectionPool(db, true); err != nil {
		return nil, err
	}
	return db, nil
}

func connectSQLite() (*gorm.DB, error) {
	dbPath, err := getDBPath()
	if err != nil {
		return nil, fmt.Errorf("failed to get database path: %w", err)
	}

	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: newGormLogger(),
	})
	if err != nil {
		return nil, err
	}
	if err := configureConnectionPool(db, false); err != nil {
		return nil, err
	}
	return db, nil
}

func configureConnectionPool(db *gorm.DB, isPostgres bool) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	maxOpen := getEnvInt("DB_MAX_OPEN_CONNS", 8)
	maxIdle := getEnvInt("DB_MAX_IDLE_CONNS", 4)
	maxLifetimeMin := getEnvInt("DB_CONN_MAX_LIFETIME_MIN", 30)
	maxIdleTimeMin := getEnvInt("DB_CONN_MAX_IDLE_TIME_MIN", 10)

	if !isPostgres {
		// SQLite는 단일 프로세스/파일락 특성상 connection을 작게 유지
		maxOpen = 1
		maxIdle = 1
	}
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}

	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(time.Duration(maxLifetimeMin) * time.Minute)
	sqlDB.SetConnMaxIdleTime(time.Duration(maxIdleTimeMin) * time.Minute)

	log.Printf(
		"DB pool configured: max_open=%d max_idle=%d conn_lifetime=%dm conn_idle_time=%dm",
		maxOpen, maxIdle, maxLifetimeMin, maxIdleTimeMin,
	)
	return nil
}

func getEnvInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}

func newGormLogger() logger.Interface {
	return logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             getGormSlowThreshold(),
			LogLevel:                  getGormLogMode(),
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)
}

func getGormLogMode() logger.LogLevel {
	switch os.Getenv("DB_LOG_LEVEL") {
	case "silent":
		return logger.Silent
	case "error":
		return logger.Error
	case "warn":
		return logger.Warn
	case "info":
		return logger.Info
	default:
		return logger.Warn
	}
}

func getGormSlowThreshold() time.Duration {
	raw := os.Getenv("DB_SLOW_MS")
	if raw == "" {
		return 1000 * time.Millisecond
	}

	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return 1000 * time.Millisecond
	}

	return time.Duration(ms) * time.Millisecond
}

// migrationModels: AutoMigrate 로 맞추는 표 (여기에 넣거나 필드·태그를 바꾸면 지문이 바뀌어 다음 실행 때 표 구조를 다시 맞춘다)
func migrationModels() []interface{} {
	return []interface{}{
		&models.Account{},
		&models.Asset{},
		&models.Holding{},
		&models.Transaction{},
		&models.Dividend{},
		&models.PortfolioSnapshot{},
		&models.DailyAssetSnapshot{},
		&models.DailyPositionSnapshot{},
		&models.RealizedPnL{},
		&models.SignalRule{},
		&models.SignalState{},
		&models.SignalEvent{},
		&models.SignalProfile{},
		&models.AssetSignalProfile{},
		&models.ProfileSuggestion{},
		&models.NotificationSetting{},
		&models.FundamentalSnapshot{},
		&models.AccumulationPlan{},
		&models.CashEntry{},
		&models.DividendScoreSetting{},
		&models.DividendScoreSnapshot{},
		&models.ContributionPlan{},
		&models.ContributionItem{},
		&models.FundPrice{},
		&models.HoldingCheckAlert{},
		&models.PriceZone{},
		&models.TodaySnapshot{},
		&models.AppMeta{},
	}
}

// schemaMetaKey: 예전 방식 — 마지막으로 맞춘 지문 하나 (v1.1.54 까지). 이제 쓰지 않고, 이 값이 지금 지문과 같으면 맞춘 것으로 본다.
// 하나만 두면 버전이 다른 앱과 서버가 켜질 때마다 서로 덮어써 매번 표 구조를 다시 맞췄다 (원격 DB 에서 1분 넘게).
const schemaMetaKey = "schema_fingerprint"

// schemaAppliedPrefix: 지문마다 '이 구조로 맞춘 적 있음' 기록 (schema_fp:<지문>) — 버전마다 처음 한 번만 맞춘다
const schemaAppliedPrefix = "schema_fp:"

// schemaFingerprint: 표로 쓰는 모델들의 필드 이름·타입·gorm 태그로 만든 지문
func schemaFingerprint(ms []interface{}) string {
	var b strings.Builder
	var walk func(t reflect.Type, depth int)
	walk = func(t reflect.Type, depth int) {
		for t.Kind() == reflect.Pointer {
			t = t.Elem()
		}
		b.WriteString(t.PkgPath() + "." + t.Name() + "{")
		if t.Kind() == reflect.Struct {
			for i := 0; i < t.NumField(); i++ {
				f := t.Field(i)
				fmt.Fprintf(&b, "%s %s `%s`;", f.Name, f.Type.String(), f.Tag)
				if f.Anonymous && depth < 4 {
					walk(f.Type, depth+1) // gorm.Model 처럼 끼워 넣은 구조체
				}
			}
		}
		b.WriteString("}")
	}
	for _, m := range ms {
		walk(reflect.TypeOf(m), 0)
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:16])
}

// runMigrations: 표 구조를 맞춘다. 원격 DB 에서 AutoMigrate 는 표마다 구조를 하나씩 비교해 수십 초 걸려서,
// 이 지문(지금 버전의 표 구조)으로 맞춘 적이 있으면 건너뛴다 (앱이 켜질 때 창이 늦게 뜨던 원인).
// 지문마다 따로 기록하므로 버전이 다른 앱·서버가 번갈아 켜져도 서로 덮어쓰지 않는다 (AutoMigrate 는 칸을 지우지 않아 섞여도 안전).
func runMigrations() error {
	ms := migrationModels()
	fp := schemaFingerprint(ms)
	if schemaApplied(fp) {
		log.Printf("DB 표 구조가 그대로라 맞추기를 건너뜁니다")
	} else {
		start := time.Now()
		if err := DB.AutoMigrate(ms...); err != nil {
			return err
		}
		markSchemaApplied(fp)
		log.Printf("DB 표 구조를 맞췄습니다 (%.1fs)", time.Since(start).Seconds())
	}
	if err := backfillAccountTypes(); err != nil {
		return err
	}
	applyFxPresets(DB)
	return repairKoreanTickerPnLCurrency(DB)
}

// schemaApplied: 이 지문으로 맞춘 적이 있나 — 지문별 기록, 또는 예전 방식 기록이 지금 지문과 같으면 (그때는 지문별 기록을 남겨 둔다)
func schemaApplied(fp string) bool {
	var keys []string
	if err := DB.Raw("SELECT key FROM app_meta WHERE key = ?", schemaAppliedPrefix+fp).Scan(&keys).Error; err == nil && len(keys) == 1 {
		return true
	}
	var legacy []string
	if err := DB.Raw("SELECT value FROM app_meta WHERE key = ?", schemaMetaKey).Scan(&legacy).Error; err == nil && len(legacy) == 1 && legacy[0] == fp {
		markSchemaApplied(fp)
		return true
	}
	return false
}

// markSchemaApplied: 이 지문으로 맞췄다고 남긴다 (실패하면 다음에 다시 맞춘다)
func markSchemaApplied(fp string) {
	meta := models.AppMeta{Key: schemaAppliedPrefix + fp, Value: time.Now().UTC().Format(time.RFC3339)}
	if err := DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoNothing: true}).Create(&meta).Error; err != nil {
		log.Printf("표 구조 지문 저장 실패 (다음에 다시 맞춘다): %v", err)
	}
}

const fxPresetMetaKey = "fx_preset_v1"

// applyFxPresets: 직접 환전 수수료 칸이 생긴 뒤 처음 한 번, 비어 있는 계좌(원화·외화 따로)에 증권사 기준을 넣는다
// (토스증권 기본 1% · 정규 시간 95% 우대 · 그 외 50% 우대). 한 번 넣은 뒤에는 계좌 화면에서 고친 값을 건드리지 않는다.
func applyFxPresets(db *gorm.DB) {
	var done []string
	if err := db.Raw("SELECT value FROM app_meta WHERE key = ?", fxPresetMetaKey).Scan(&done).Error; err != nil || len(done) > 0 {
		return
	}
	n := int64(0)
	for broker, p := range models.FxPresets {
		res := db.Model(&models.Account{}).
			Where("broker = ? AND foreign_settle = ? AND fx_spread_pct = 0", broker, models.SettleUSD).
			UpdateColumns(map[string]interface{}{"fx_spread_pct": p.SpreadPct, "fx_day_disc_pct": p.DayDiscPct, "fx_off_disc_pct": p.OffDiscPct})
		if res.Error != nil {
			log.Printf("환전 수수료 기본값 넣기 실패 (다음에 다시): %v", res.Error)
			return
		}
		n += res.RowsAffected
	}
	meta := models.AppMeta{Key: fxPresetMetaKey, Value: "done"}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&meta).Error; err != nil {
		log.Printf("환전 수수료 기본값 기록 실패: %v", err)
	}
	if n > 0 {
		log.Printf("환전 수수료 기본값을 %d개 계좌에 넣었습니다", n)
	}
}

// repairKoreanTickerPnLCurrency 는 국내 상장(.KS/.KQ) 종목인데 원화가 아닌 통화로 저장된 실현손익을 원화로 고친다.
// 과거 해외 계좌에서 판 국내 상장 ETF 의 실현손익이 계좌 통화(USD)로 저장돼, 양도세·수익률 계산에서
// 원화 손익에 환율이 곱해졌다. 지금은 매도 시 티커로 통화를 정하므로 새 기록에는 생기지 않는다. 멱등.
func repairKoreanTickerPnLCurrency(db *gorm.DB) error {
	krAssets := db.Unscoped().Model(&models.Asset{}).Select("id").
		Where("UPPER(ticker) LIKE ? OR UPPER(ticker) LIKE ?", "%.KS", "%.KQ")
	res := db.Model(&models.RealizedPnL{}).
		Where("asset_id IN (?)", krAssets).
		Where("UPPER(currency) <> ?", "KRW").
		UpdateColumn("currency", "KRW")
	if res.Error != nil {
		return fmt.Errorf("failed to repair realized PnL currency: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		log.Printf("Repaired currency to KRW for %d realized PnL record(s) of Korean-listed tickers", res.RowsAffected)
	}
	return nil
}

// backfillAccountTypes account_type이 비어 있는 기존 계좌에 이름/설명 기반으로 유형을 채운다.
// 멱등이며 해당 컬럼만 갱신한다.
func backfillAccountTypes() error {
	var accounts []models.Account
	if err := DB.Where("account_type IS NULL OR account_type = ''").Find(&accounts).Error; err != nil {
		return fmt.Errorf("failed to load accounts for account_type backfill: %w", err)
	}
	for _, a := range accounts {
		t := models.InferAccountType(a.Name, a.Description)
		if err := DB.Model(&models.Account{}).Where("id = ?", a.ID).UpdateColumn("account_type", t).Error; err != nil {
			return fmt.Errorf("failed to backfill account_type for account %d: %w", a.ID, err)
		}
	}
	if len(accounts) > 0 {
		log.Printf("Backfilled account_type for %d account(s)", len(accounts))
	}
	return nil
}

func getDBPath() (string, error) {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	appDataDir := filepath.Join(userConfigDir, "StockManager")
	dbPath := filepath.Join(appDataDir, "dividend_app.db")

	return dbPath, nil
}

func GetDB() *gorm.DB {
	return DB
}

func IsPostgres() bool {
	return os.Getenv("DB_TYPE") == "postgres"
}

func CloseDB() error {
	if DB != nil {
		sqlDB, err := DB.DB()
		if err != nil {
			return err
		}
		return sqlDB.Close()
	}
	return nil
}
