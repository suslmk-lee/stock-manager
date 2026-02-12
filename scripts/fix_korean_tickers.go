package main

import (
	"fmt"
	"log"
	"regexp"
	"stock-manager/database"
	"stock-manager/models"
)

func main() {
	// 데이터베이스 초기화
	database.InitDB()
	db := database.GetDB()

	// 한국 티커 패턴 (숫자 6자리)
	koreanTickerPattern := regexp.MustCompile(`^\d{6}$`)

	var assets []models.Asset
	if err := db.Find(&assets).Error; err != nil {
		log.Fatalf("Failed to fetch assets: %v", err)
	}

	updatedCount := 0

	// 트랜잭션 시작
	tx := db.Begin()
	if tx.Error != nil {
		log.Fatalf("Failed to start transaction: %v", tx.Error)
	}

	for _, asset := range assets {
		// 숫자 6자리이고 .KS나 .KQ가 없는 경우
		if koreanTickerPattern.MatchString(asset.Ticker) {
			oldTicker := asset.Ticker
			newTicker := asset.Ticker + ".KS"

			// 새 티커가 이미 존재하는지 확인
			var existing models.Asset
			if err := tx.Where("ticker = ?", newTicker).First(&existing).Error; err == nil {
				log.Printf("Warning: Ticker %s already exists, skipping %s\n", newTicker, oldTicker)
				continue
			}

			// 티커 업데이트 (asset_id는 변경되지 않으므로 관계 데이터는 영향 없음)
			if err := tx.Model(&asset).Update("ticker", newTicker).Error; err != nil {
				log.Printf("Failed to update ticker %s: %v", oldTicker, err)
				tx.Rollback()
				log.Fatalf("Transaction rolled back due to error")
			}

			fmt.Printf("Updated: %s -> %s (%s)\n", oldTicker, newTicker, asset.Name)
			updatedCount++
		}
	}

	// 트랜잭션 커밋
	if err := tx.Commit().Error; err != nil {
		log.Fatalf("Failed to commit transaction: %v", err)
	}

	fmt.Printf("\n✅ Total updated: %d assets\n", updatedCount)
	fmt.Println("✅ 기존 배당금, 거래내역, 보유내역 데이터는 asset_id로 연결되어 있어 영향 없음")
}
