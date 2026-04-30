package database

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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

func runMigrations() error {
	return DB.AutoMigrate(
		&models.Account{},
		&models.Asset{},
		&models.Holding{},
		&models.Transaction{},
		&models.Dividend{},
	)
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
