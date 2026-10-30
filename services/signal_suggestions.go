package services

import (
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// recordSuggestions 는 배당 장기보유 프로필 후보 종목에 대한 추천을 기록한다 (alertMu 를 잡은 상태에서 호출).
//   - 대상: 시세가 있고 프로필 배정/종목 오버라이드가 없는 후보
//   - 기준점 표시 행이 없으면(기능 최초 실행) 현재 후보 전부를 baseline 으로 기록하고 알림은 만들지 않는다.
//   - 이미 행이 있는 종목(suggested/dismissed/accepted/baseline)은 다시 제안하지 않는다.
//
// 알림 설정의 enabled 만 존중하며(꺼져 있으면 읽음 처리) 매도/매수/충돌 필터는 무시한다.
func (s *SignalService) recordSuggestions(tx *gorm.DB, report *SignalReport, set models.NotificationSetting,
	now time.Time) ([]models.SignalEvent, error) {
	var rows []models.ProfileSuggestion
	if err := tx.Find(&rows).Error; err != nil {
		return nil, err
	}
	known := make(map[uint]bool, len(rows))
	baseline := true
	for _, r := range rows {
		if r.Status == models.SuggestionBaselineMarker {
			baseline = false
			continue
		}
		known[r.AssetID] = true
	}
	// 기준점은 표시 행으로 판단한다. 첫 기록 전에 사용자가 종목을 지정/무시해 행이 생겨도
	// 나머지 기존 후보가 한꺼번에 제안되지 않게 하기 위함 (후보가 0개여도 표시는 남긴다).
	if baseline {
		marker := models.ProfileSuggestion{AssetID: 0, ProfileKey: models.ProfileKeyDividend, Status: models.SuggestionBaselineMarker}
		if err := tx.Create(&marker).Error; err != nil {
			return nil, err
		}
	}

	var targets []DividendCandidate
	for _, c := range report.Candidates {
		if c.IsCandidate && c.priced && c.unassigned {
			targets = append(targets, c)
		}
	}
	if len(targets) == 0 {
		return nil, nil
	}

	var divID uint
	if !baseline {
		var p models.SignalProfile
		if err := tx.Where("key = ?", models.ProfileKeyDividend).First(&p).Error; err != nil {
			return nil, err
		}
		divID = p.ID
	}
	actions := make(map[uint]SignalItem, len(report.Items))
	for _, it := range report.Items {
		actions[it.AssetID] = it
	}

	var events []models.SignalEvent
	for _, c := range targets {
		if known[c.AssetID] {
			continue
		}
		status := models.SuggestionBaseline
		if !baseline {
			status = models.SuggestionSuggested
			it := actions[c.AssetID]
			codes, labels := metReasons(c)
			ev := models.SignalEvent{
				AssetID: c.AssetID, Ticker: c.Ticker, Name: c.Name,
				FromAction: it.Action, ToAction: "SUGGEST",
				MetCodes:       strings.Join(codes, ","),
				Message:        "배당 장기보유 프로필 후보 · " + strings.Join(labels, ", "),
				TotalReturnPct: it.TotalReturnPct, CurrentPrice: it.CurrentPrice, Currency: it.Currency,
				CreatedAt: now, Kind: models.SignalEventKindSuggestion, SuggestedProfileID: divID,
			}
			if !set.Enabled {
				t := now
				ev.ReadAt = &t
			}
			events = append(events, ev)
		}
		row := models.ProfileSuggestion{AssetID: c.AssetID, ProfileKey: models.ProfileKeyDividend, Status: status}
		if err := tx.Create(&row).Error; err != nil {
			return nil, err
		}
		known[c.AssetID] = true
	}
	return events, nil
}
