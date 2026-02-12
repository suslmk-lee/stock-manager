package database

import (
	"fmt"
	"os"
	"path/filepath"
	
	"stock-manager/models"
	
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB() error {
	dbPath, err := getDBPath()
	if err != nil {
		return fmt.Errorf("failed to get database path: %w", err)
	}
	
	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return fmt.Errorf("failed to create database directory: %w", err)
	}
	
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	
	DB = db
	
	if err := runMigrations(); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}
	
	return nil
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
