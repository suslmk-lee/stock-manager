package database

import (
	"testing"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 표 구조 지문: 처음엔 표를 맞추고 '이 지문으로 맞춤'을 남기고, 다음 실행에서는 건너뛴다 (모델이 바뀌면 지문도 바뀐다).
// 지문마다 따로 남기므로 버전이 다른 앱·서버가 예전 방식 기록을 덮어써도 다시 맞추지 않는다.
func TestRunMigrationsSkipsWhenSchemaUnchanged(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	old := DB
	DB = db
	defer func() { DB = old }()
	applied := func() int64 {
		var n int64
		db.Model(&models.AppMeta{}).Where("key LIKE ?", schemaAppliedPrefix+"%").Count(&n)
		return n
	}

	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	fp := schemaFingerprint(migrationModels())
	var meta models.AppMeta
	if err := db.First(&meta, "key = ?", schemaAppliedPrefix+fp).Error; err != nil {
		t.Fatalf("지문 기록 없음: %v", err)
	}
	if !db.Migrator().HasTable(&models.PriceZone{}) || !db.Migrator().HasTable(&models.Account{}) {
		t.Fatal("표를 만들지 않음")
	}

	// 지문이 같으면 표를 건드리지 않는다: 일부러 지운 표가 다시 생기지 않아야 한다
	if err := db.Migrator().DropTable(&models.HoldingCheckAlert{}); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable(&models.HoldingCheckAlert{}) {
		t.Fatal("지문이 같은데 표를 다시 맞춤")
	}

	// 다른 버전(예전 방식)이 '마지막 지문'을 자기 것으로 덮어써도 다시 맞추지 않는다 (앱·서버 버전이 다를 때 매번 1분 넘게 걸리던 것)
	db.Create(&models.AppMeta{Key: schemaMetaKey, Value: "other-version"})
	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable(&models.HoldingCheckAlert{}) {
		t.Fatal("다른 버전이 덮어쓴 기록 때문에 다시 맞춤")
	}
	var legacy models.AppMeta
	db.First(&legacy, "key = ?", schemaMetaKey)
	if legacy.Value != "other-version" {
		t.Fatalf("예전 방식 기록을 덮어씀: %q", legacy.Value)
	}

	// 이 지문으로 맞춘 기록이 없으면 (새 버전) 한 번 맞춘다
	db.Where("key = ?", schemaAppliedPrefix+fp).Delete(&models.AppMeta{})
	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&models.HoldingCheckAlert{}) || applied() != 1 {
		t.Fatalf("새 지문인데 맞추지 않음 (기록 %d)", applied())
	}

	// 예전 방식 기록이 지금 지문과 같으면 맞춘 것으로 보고 지문별 기록을 남긴다 (업데이트 직후 한 번 더 맞추지 않게)
	db.Where("key = ?", schemaAppliedPrefix+fp).Delete(&models.AppMeta{})
	db.Model(&models.AppMeta{}).Where("key = ?", schemaMetaKey).Update("value", fp)
	if err := db.Migrator().DropTable(&models.HoldingCheckAlert{}); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable(&models.HoldingCheckAlert{}) || applied() != 1 {
		t.Fatalf("예전 방식 기록이 같은데 다시 맞춤 (기록 %d)", applied())
	}

	// 모델 목록·필드가 바뀌면 지문도 바뀐다
	if schemaFingerprint(migrationModels()[:3]) == fp || schemaFingerprint(migrationModels()) != fp {
		t.Fatal("지문이 모델에 따라 바뀌지 않거나, 같은 모델인데 달라짐")
	}
}

// 환전 수수료 기본값: 처음 한 번만, 비어 있는 토스증권(원화·외화 따로) 계좌에 넣고, 그 뒤 고친 값은 그대로 둔다
func TestApplyFxPresetsOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.AppMeta{}); err != nil {
		t.Fatal(err)
	}
	accs := []models.Account{
		{Name: "토스", Broker: "토스증권", ForeignSettle: models.SettleUSD},
		{Name: "토스 자동", Broker: "토스증권", ForeignSettle: models.SettleAutoFX},
		{Name: "토스 직접 입력", Broker: "토스증권", ForeignSettle: models.SettleUSD, FxSpreadPct: 0.8, FxDayDiscPct: 90},
		{Name: "키움", Broker: "키움증권", ForeignSettle: models.SettleUSD},
	}
	if err := db.Create(&accs).Error; err != nil {
		t.Fatal(err)
	}
	applyFxPresets(db)
	get := func(id uint) models.Account {
		var a models.Account
		db.First(&a, id)
		return a
	}
	if a := get(accs[0].ID); a.FxSpreadPct != 1 || a.FxDayDiscPct != 95 || a.FxOffDiscPct != 50 {
		t.Fatalf("토스 = %+v", a)
	}
	if a := get(accs[1].ID); a.FxSpreadPct != 0 {
		t.Fatalf("자동 환전 계좌에 넣음: %+v", a)
	}
	if a := get(accs[2].ID); a.FxSpreadPct != 0.8 || a.FxDayDiscPct != 90 {
		t.Fatalf("이미 넣은 값을 덮음: %+v", a)
	}
	if a := get(accs[3].ID); a.FxSpreadPct != 0 {
		t.Fatalf("다른 증권사에 넣음: %+v", a)
	}
	// 사용자가 0으로 지운 뒤에는 다시 넣지 않는다
	db.Model(&models.Account{}).Where("id = ?", accs[0].ID).UpdateColumn("fx_spread_pct", 0)
	applyFxPresets(db)
	if a := get(accs[0].ID); a.FxSpreadPct != 0 {
		t.Fatalf("두 번째에도 넣음: %+v", a)
	}
}
