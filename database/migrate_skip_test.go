package database

import (
	"testing"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 표 구조 지문: 처음엔 표를 맞추고 지문을 남기고, 지문이 같으면 다음 실행에서 건너뛴다 (모델이 바뀌면 지문도 바뀐다)
func TestRunMigrationsSkipsWhenSchemaUnchanged(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	old := DB
	DB = db
	defer func() { DB = old }()

	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	fp := schemaFingerprint(migrationModels())
	var meta models.AppMeta
	if err := db.First(&meta, "key = ?", schemaMetaKey).Error; err != nil || meta.Value != fp {
		t.Fatalf("지문 = %+v %v (want %s)", meta, err, fp)
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

	// 지문이 다르면 (새 버전) 다시 맞춘다
	db.Model(&models.AppMeta{}).Where("key = ?", schemaMetaKey).Update("value", "old")
	if err := runMigrations(); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&models.HoldingCheckAlert{}) {
		t.Fatal("지문이 바뀌었는데 표를 맞추지 않음")
	}
	var n int64
	db.Model(&models.AppMeta{}).Where("key = ?", schemaMetaKey).Count(&n)
	if n != 1 {
		t.Fatalf("지문 기록 %d줄", n)
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
