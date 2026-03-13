package database

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

var DB *gorm.DB

func InitDB() error {
	// .env 파일 로드 (없으면 무시)
	if err := godotenv.Load(); err != nil {
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

	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
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

	return gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
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
