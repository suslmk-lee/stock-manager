package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatal("Failed to load .env file:", err)
	}

	// 1. SQLite 연결 (소스)
	sqliteDB, err := connectSQLite()
	if err != nil {
		log.Fatal("Failed to connect to SQLite:", err)
	}
	log.Println("✅ SQLite 연결 성공")

	// 2. PostgreSQL 연결 (대상)
	pgDB, err := connectPostgres()
	if err != nil {
		log.Fatal("Failed to connect to PostgreSQL:", err)
	}
	log.Println("✅ PostgreSQL (Supabase) 연결 성공")

	// 3. PostgreSQL에 테이블 생성
	log.Println("📦 테이블 생성 중...")
	if err := pgDB.AutoMigrate(
		&models.Account{},
		&models.Asset{},
		&models.Holding{},
		&models.Transaction{},
		&models.Dividend{},
	); err != nil {
		log.Fatal("Failed to migrate tables:", err)
	}
	log.Println("✅ 테이블 생성 완료")

	// 4. 데이터 이관 (FK 의존성 순서: Account → Asset → Holding → Transaction → Dividend)
	if err := migrateAccounts(sqliteDB, pgDB); err != nil {
		log.Fatal("Failed to migrate accounts:", err)
	}

	if err := migrateAssets(sqliteDB, pgDB); err != nil {
		log.Fatal("Failed to migrate assets:", err)
	}

	if err := migrateHoldings(sqliteDB, pgDB); err != nil {
		log.Fatal("Failed to migrate holdings:", err)
	}

	if err := migrateTransactions(sqliteDB, pgDB); err != nil {
		log.Fatal("Failed to migrate transactions:", err)
	}

	if err := migrateDividends(sqliteDB, pgDB); err != nil {
		log.Fatal("Failed to migrate dividends:", err)
	}

	// 5. PostgreSQL 시퀀스 동기화 (auto-increment ID 보정)
	if err := syncSequences(pgDB); err != nil {
		log.Println("⚠️  시퀀스 동기화 실패 (수동 확인 필요):", err)
	}

	log.Println("🎉 데이터 마이그레이션 완료!")
}

func connectSQLite() (*gorm.DB, error) {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dbPath := filepath.Join(userConfigDir, "StockManager", "dividend_app.db")

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("SQLite database not found at: %s", dbPath)
	}

	log.Printf("📂 SQLite 경로: %s\n", dbPath)

	return gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
}

func connectPostgres() (*gorm.DB, error) {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	dbname := os.Getenv("DB_NAME")
	sslmode := os.Getenv("DB_SSLMODE")

	if host == "" || password == "" {
		return nil, fmt.Errorf("DB_HOST and DB_PASSWORD are required in .env")
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

	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
}

func migrateAccounts(src, dst *gorm.DB) error {
	var records []models.Account
	if err := src.Unscoped().Find(&records).Error; err != nil {
		return err
	}
	if len(records) == 0 {
		log.Println("  📋 Accounts: 0건 (스킵)")
		return nil
	}
	for _, r := range records {
		if err := dst.Create(&r).Error; err != nil {
			return fmt.Errorf("account ID=%d: %w", r.ID, err)
		}
	}
	log.Printf("  📋 Accounts: %d건 이관 완료\n", len(records))
	return nil
}

func migrateAssets(src, dst *gorm.DB) error {
	var records []models.Asset
	if err := src.Unscoped().Find(&records).Error; err != nil {
		return err
	}
	if len(records) == 0 {
		log.Println("  📋 Assets: 0건 (스킵)")
		return nil
	}
	for _, r := range records {
		if err := dst.Create(&r).Error; err != nil {
			return fmt.Errorf("asset ID=%d: %w", r.ID, err)
		}
	}
	log.Printf("  📋 Assets: %d건 이관 완료\n", len(records))
	return nil
}

func migrateHoldings(src, dst *gorm.DB) error {
	var records []models.Holding
	if err := src.Unscoped().Find(&records).Error; err != nil {
		return err
	}
	if len(records) == 0 {
		log.Println("  📋 Holdings: 0건 (스킵)")
		return nil
	}
	for _, r := range records {
		if err := dst.Create(&r).Error; err != nil {
			return fmt.Errorf("holding ID=%d: %w", r.ID, err)
		}
	}
	log.Printf("  📋 Holdings: %d건 이관 완료\n", len(records))
	return nil
}

func migrateTransactions(src, dst *gorm.DB) error {
	var records []models.Transaction
	if err := src.Unscoped().Find(&records).Error; err != nil {
		return err
	}
	if len(records) == 0 {
		log.Println("  📋 Transactions: 0건 (스킵)")
		return nil
	}
	for _, r := range records {
		if err := dst.Create(&r).Error; err != nil {
			return fmt.Errorf("transaction ID=%d: %w", r.ID, err)
		}
	}
	log.Printf("  📋 Transactions: %d건 이관 완료\n", len(records))
	return nil
}

func migrateDividends(src, dst *gorm.DB) error {
	var records []models.Dividend
	if err := src.Unscoped().Find(&records).Error; err != nil {
		return err
	}
	if len(records) == 0 {
		log.Println("  📋 Dividends: 0건 (스킵)")
		return nil
	}
	for _, r := range records {
		if err := dst.Create(&r).Error; err != nil {
			return fmt.Errorf("dividend ID=%d: %w", r.ID, err)
		}
	}
	log.Printf("  📋 Dividends: %d건 이관 완료\n", len(records))
	return nil
}

func syncSequences(db *gorm.DB) error {
	tables := map[string]string{
		"accounts":     "accounts_id_seq",
		"assets":       "assets_id_seq",
		"holdings":     "holdings_id_seq",
		"transactions": "transactions_id_seq",
		"dividends":    "dividends_id_seq",
	}

	for table, seq := range tables {
		query := fmt.Sprintf(
			"SELECT setval('%s', COALESCE((SELECT MAX(id) FROM %s), 0) + 1, false)",
			seq, table,
		)
		if err := db.Exec(query).Error; err != nil {
			log.Printf("  ⚠️  시퀀스 %s 동기화 실패: %v\n", seq, err)
		}
	}
	log.Println("  🔢 시퀀스 동기화 완료")
	return nil
}
