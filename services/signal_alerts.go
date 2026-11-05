package services

import (
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

const signalEventRetention = 500

var allowedNotifyIntervals = map[int]bool{15: true, 30: true, 60: true, 180: true, 360: true}

// ValidateNotificationSetting 은 알림 설정을 검증한다.
func ValidateNotificationSetting(s *models.NotificationSetting) error {
	if !allowedNotifyIntervals[s.IntervalMinutes] {
		return &ErrInvalidSignalRule{"interval_minutes must be one of 15, 30, 60, 180, 360"}
	}
	return nil
}

func isAlertAction(a string) bool {
	return a == SignalSell || a == SignalBuy || a == SignalConflict
}

func alertKindEnabled(set models.NotificationSetting, action string) bool {
	switch action {
	case SignalSell:
		return set.NotifySell
	case SignalBuy:
		return set.NotifyBuy
	case SignalConflict:
		return set.NotifyConflict
	}
	return true
}

// metCodes 는 매도+매수 충족 체크 코드를 정렬해 반환한다.
func metCodes(it SignalItem) []string {
	var codes []string
	for _, list := range [][]SignalCheck{it.SellChecks, it.BuyChecks} {
		for _, c := range list {
			if c.Met {
				codes = append(codes, c.Code)
			}
		}
	}
	sort.Strings(codes)
	return codes
}

func splitKey(k string) map[string]bool {
	m := map[string]bool{}
	for _, p := range strings.Split(k, ",") {
		if p != "" {
			m[p] = true
		}
	}
	return m
}

func actionLabel(it SignalItem) string {
	switch it.Action {
	case SignalSell:
		if it.RestrictedOnly {
			return "리밸런싱 검토"
		}
		return "매도 검토"
	case SignalBuy:
		return "매수 검토"
	case SignalConflict:
		return "신호 충돌"
	}
	return "관망"
}

// metLabels 는 리포트 순서대로 충족된 체크 라벨을 반환한다 (only != nil 이면 해당 코드만).
func metLabels(it SignalItem, only map[string]bool) []string {
	var out []string
	for _, list := range [][]SignalCheck{it.SellChecks, it.BuyChecks} {
		for _, c := range list {
			if c.Met && (only == nil || only[c.Code]) {
				out = append(out, c.Label)
			}
		}
	}
	return out
}

// DiffSignals 는 순수 함수: 이전 상태와 현재 리포트 항목을 비교해 이벤트와 새 상태를 만든다.
// baseline 이 true 이면 이벤트 없이 상태만 만든다. NO_PRICE 항목은 무시한다.
func DiffSignals(items []SignalItem, prev map[uint]models.SignalState, baseline bool,
	set models.NotificationSetting, now time.Time) ([]models.SignalEvent, []models.SignalState) {
	var events []models.SignalEvent
	var states []models.SignalState
	for _, it := range items {
		if it.Action == SignalNoPrice {
			continue
		}
		codes := metCodes(it)
		metKey := strings.Join(codes, ",")
		states = append(states, models.SignalState{AssetID: it.AssetID, Action: it.Action, MetKey: metKey})
		if baseline {
			continue
		}
		p, ok := prev[it.AssetID]
		if !ok {
			p = models.SignalState{AssetID: it.AssetID, Action: SignalHold}
		}

		var msg string
		var evCodes []string
		switch {
		case it.Action != p.Action && isAlertAction(it.Action):
			msg = actionLabel(it) + "로 전환"
			if ls := metLabels(it, nil); len(ls) > 0 {
				msg += " · " + strings.Join(ls, ", ")
			}
			msg += sellSuggestionSuffix(it) + buySuggestionSuffix(it)
			evCodes = codes
		case it.Action == p.Action && isAlertAction(it.Action):
			old := splitKey(p.MetKey)
			newSet := map[string]bool{}
			for _, c := range codes {
				if !old[c] {
					evCodes = append(evCodes, c)
					newSet[c] = true
				}
			}
			if len(evCodes) == 0 {
				continue
			}
			msg = "새 조건 충족 · " + strings.Join(metLabels(it, newSet), ", ") + sellSuggestionSuffix(it) + buySuggestionSuffix(it)
		case it.Action == SignalHold && isAlertAction(p.Action):
			msg = "신호 해제 · 관망"
		default:
			continue
		}
		ev := models.SignalEvent{
			AssetID: it.AssetID, Ticker: it.Ticker, Name: it.Name,
			FromAction: p.Action, ToAction: it.Action, MetCodes: strings.Join(evCodes, ","),
			Message: msg, TotalReturnPct: it.TotalReturnPct, CurrentPrice: it.CurrentPrice,
			Currency: it.Currency, CreatedAt: now, Kind: models.SignalEventKindSignal,
		}
		if it.Action == SignalHold || !set.Enabled || !alertKindEnabled(set, it.Action) {
			t := now
			ev.ReadAt = &t
		}
		events = append(events, ev)
	}
	return events, states
}

// ---- DB 래퍼 ----

func (s *SignalService) loadNotificationSetting(db *gorm.DB) (models.NotificationSetting, error) {
	var set models.NotificationSetting
	err := db.Where("id = ?", 1).First(&set).Error
	if err == nil {
		return set, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return set, err
	}
	set = models.DefaultNotificationSetting()
	if err := db.Create(&set).Error; err != nil {
		return set, err
	}
	return set, nil
}

func (s *SignalService) GetNotificationSettings() (*models.NotificationSetting, error) {
	s.alertMu.Lock()
	defer s.alertMu.Unlock()
	set, err := s.loadNotificationSetting(s.db)
	if err != nil {
		return nil, err
	}
	return &set, nil
}

func (s *SignalService) SaveNotificationSettings(in models.NotificationSetting) (*models.NotificationSetting, error) {
	if err := ValidateNotificationSetting(&in); err != nil {
		return nil, err
	}
	s.alertMu.Lock()
	in.ID = 1
	in.UpdatedAt = time.Time{}
	err := s.db.Save(&in).Error
	s.alertMu.Unlock()
	if err != nil {
		return nil, err
	}
	if fn := s.onSettingsSaved; fn != nil {
		fn()
	}
	return &in, nil
}

// SetSettingsListener 는 설정 저장 시 호출될 콜백을 등록한다 (백그라운드 점검 즉시 깨우기용).
func (s *SignalService) SetSettingsListener(fn func()) { s.onSettingsSaved = fn }

// recordReport 는 리포트와 저장된 상태를 비교해 이벤트를 기록하고, 이번에 생성된 이벤트를 반환한다.
func (s *SignalService) recordReport(report *SignalReport) ([]models.SignalEvent, error) {
	if len(report.Candidates) > 0 {
		if err := s.ensureSeeded(); err != nil {
			return nil, fmt.Errorf("프로필 초기화 실패: %w", err)
		}
	}
	s.alertMu.Lock()
	defer s.alertMu.Unlock()
	var created []models.SignalEvent
	err := s.db.Transaction(func(tx *gorm.DB) error {
		set, err := s.loadNotificationSetting(tx)
		if err != nil {
			return err
		}
		var stored []models.SignalState
		if err := tx.Find(&stored).Error; err != nil {
			return err
		}
		prev := make(map[uint]models.SignalState, len(stored))
		for _, st := range stored {
			prev[st.AssetID] = st
		}
		now := time.Now()
		events, states := DiffSignals(report.Items, prev, len(stored) == 0, set, now)
		sugg, err := s.recordSuggestions(tx, report, set, now)
		if err != nil {
			return err
		}
		events = append(events, sugg...)
		for _, st := range states {
			if old, ok := prev[st.AssetID]; ok {
				if old.Action == st.Action && old.MetKey == st.MetKey {
					continue
				}
				st.ID = old.ID
				if err := tx.Save(&st).Error; err != nil {
					return err
				}
			} else if err := tx.Create(&st).Error; err != nil {
				return err
			}
		}
		if len(events) > 0 {
			if err := tx.Create(&events).Error; err != nil {
				return err
			}
			if err := tx.Exec("DELETE FROM signal_events WHERE id NOT IN (SELECT id FROM signal_events ORDER BY id DESC LIMIT ?)",
				signalEventRetention).Error; err != nil {
				return err
			}
		}
		created = events
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("신호 변화 기록 실패: %w", err)
	}
	return created, nil
}

// CheckSignals 는 신호를 계산해 변화를 기록하고, 이번 점검에서 생긴 읽지 않은 이벤트를 반환한다.
func (s *SignalService) CheckSignals() ([]models.SignalEvent, int64, error) {
	report, err := s.buildSignalReport()
	if err != nil {
		return nil, 0, err
	}
	events, err := s.recordReport(report)
	if err != nil {
		return nil, 0, err
	}
	newEvents := []models.SignalEvent{}
	for _, e := range events {
		if e.ReadAt == nil {
			newEvents = append(newEvents, e)
		}
	}
	n, err := s.GetUnreadSignalCount()
	return newEvents, n, err
}

func (s *SignalService) GetSignalEvents(limit int, unreadOnly bool) ([]models.SignalEvent, int64, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > signalEventRetention {
		limit = signalEventRetention
	}
	q := s.db.Model(&models.SignalEvent{})
	if unreadOnly {
		q = q.Where("read_at IS NULL")
	}
	events := []models.SignalEvent{}
	if err := q.Order("id DESC").Limit(limit).Find(&events).Error; err != nil {
		return nil, 0, err
	}
	n, err := s.GetUnreadSignalCount()
	return events, n, err
}

func (s *SignalService) GetUnreadSignalCount() (int64, error) {
	var n int64
	err := s.db.Model(&models.SignalEvent{}).Where("read_at IS NULL").Count(&n).Error
	return n, err
}

func (s *SignalService) MarkSignalEventsRead(ids []uint, all bool) (int64, error) {
	if all || len(ids) > 0 {
		q := s.db.Model(&models.SignalEvent{}).Where("read_at IS NULL")
		if !all {
			q = q.Where("id IN ?", ids)
		}
		if err := q.Update("read_at", time.Now()).Error; err != nil {
			return 0, err
		}
	}
	return s.GetUnreadSignalCount()
}

func logRecordErr(err error) {
	if err != nil {
		log.Printf("signal alerts: %v", err)
	}
}
