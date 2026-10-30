package services

import (
	"errors"
	"sync"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func chk(code, label string, met bool) SignalCheck {
	return SignalCheck{Code: code, Label: label, Met: met}
}

func item(id uint, action string, sell, buy []SignalCheck) SignalItem {
	return SignalItem{AssetID: id, Ticker: "T", Name: "종목", Action: action, SellChecks: sell, BuyChecks: buy, Currency: "USD"}
}

func defSet() models.NotificationSetting { return models.DefaultNotificationSetting() }

var t0 = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func TestDiffBaselineNoEvents(t *testing.T) {
	items := []SignalItem{item(1, SignalSell, []SignalCheck{chk("take_profit", "목표 수익률", true)}, nil)}
	ev, st := DiffSignals(items, nil, true, defSet(), t0)
	if len(ev) != 0 || len(st) != 1 || st[0].Action != SignalSell || st[0].MetKey != "take_profit" {
		t.Fatalf("%+v %+v", ev, st)
	}
}

func TestDiffEnteredNewConditionCleared(t *testing.T) {
	prev := map[uint]models.SignalState{}
	sell1 := []SignalCheck{chk("take_profit", "목표 수익률", true), chk("stop_loss", "손절", false)}
	ev, st := DiffSignals([]SignalItem{item(1, SignalSell, sell1, nil)}, prev, false, defSet(), t0)
	if len(ev) != 1 || ev[0].FromAction != SignalHold || ev[0].ToAction != SignalSell ||
		ev[0].Message != "매도 검토로 전환 · 목표 수익률" || ev[0].ReadAt != nil || ev[0].MetCodes != "take_profit" {
		t.Fatalf("entered %+v", ev)
	}
	prev[1] = st[0]

	// no-op
	if ev, _ := DiffSignals([]SignalItem{item(1, SignalSell, sell1, nil)}, prev, false, defSet(), t0); len(ev) != 0 {
		t.Fatalf("noop %+v", ev)
	}

	// new condition
	sell2 := []SignalCheck{chk("take_profit", "목표 수익률", true), chk("low_yield", "저배당", true)}
	ev, st = DiffSignals([]SignalItem{item(1, SignalSell, sell2, nil)}, prev, false, defSet(), t0)
	if len(ev) != 1 || ev[0].Message != "새 조건 충족 · 저배당" || ev[0].FromAction != SignalSell || ev[0].MetCodes != "low_yield" {
		t.Fatalf("newcond %+v", ev)
	}
	prev[1] = st[0]

	// condition dropped only: no event
	if ev, _ := DiffSignals([]SignalItem{item(1, SignalSell, sell1, nil)}, prev, false, defSet(), t0); len(ev) != 0 {
		t.Fatalf("drop %+v", ev)
	}

	// cleared -> read immediately
	ev, _ = DiffSignals([]SignalItem{item(1, SignalHold, nil, nil)}, prev, false, defSet(), t0)
	if len(ev) != 1 || ev[0].Message != "신호 해제 · 관망" || ev[0].ReadAt == nil || ev[0].ToAction != SignalHold {
		t.Fatalf("cleared %+v", ev)
	}
}

func TestDiffNoPriceIgnored(t *testing.T) {
	prev := map[uint]models.SignalState{1: {AssetID: 1, Action: SignalSell, MetKey: "take_profit"}}
	ev, st := DiffSignals([]SignalItem{item(1, SignalNoPrice, nil, nil)}, prev, false, defSet(), t0)
	if len(ev) != 0 || len(st) != 0 {
		t.Fatalf("%+v %+v", ev, st)
	}
}

func TestDiffRestrictedLabelAndConflict(t *testing.T) {
	it := item(1, SignalSell, []SignalCheck{chk("weight_over", "비중 초과", true)}, nil)
	it.RestrictedOnly = true
	ev, _ := DiffSignals([]SignalItem{it}, nil, false, defSet(), t0)
	if len(ev) != 1 || ev[0].Message != "리밸런싱 검토로 전환 · 비중 초과" {
		t.Fatalf("%+v", ev)
	}
	c := item(2, SignalConflict, []SignalCheck{chk("take_profit", "목표 수익률", true)}, []SignalCheck{chk("buy_dip", "저점", true)})
	ev, st := DiffSignals([]SignalItem{c}, nil, false, defSet(), t0)
	if len(ev) != 1 || ev[0].Message != "신호 충돌로 전환 · 목표 수익률, 저점" || st[0].MetKey != "buy_dip,take_profit" {
		t.Fatalf("%+v %+v", ev, st)
	}
}

func TestDiffFiltersAutoRead(t *testing.T) {
	items := []SignalItem{
		item(1, SignalSell, []SignalCheck{chk("a", "A", true)}, nil),
		item(2, SignalBuy, nil, []SignalCheck{chk("b", "B", true)}),
	}
	set := defSet()
	set.NotifySell = false
	ev, _ := DiffSignals(items, nil, false, set, t0)
	if len(ev) != 2 || ev[0].ReadAt == nil || ev[1].ReadAt != nil {
		t.Fatalf("%+v", ev)
	}
	set = defSet()
	set.Enabled = false
	ev, _ = DiffSignals(items, nil, false, set, t0)
	if ev[0].ReadAt == nil || ev[1].ReadAt == nil {
		t.Fatalf("disabled %+v", ev)
	}
}

func TestDiffMetKeyDeterministic(t *testing.T) {
	a := item(1, SignalConflict, []SignalCheck{chk("z", "Z", true), chk("a", "A", true)}, []SignalCheck{chk("m", "M", true)})
	b := item(1, SignalConflict, []SignalCheck{chk("a", "A", true), chk("z", "Z", true)}, []SignalCheck{chk("m", "M", true)})
	_, s1 := DiffSignals([]SignalItem{a}, nil, true, defSet(), t0)
	_, s2 := DiffSignals([]SignalItem{b}, nil, true, defSet(), t0)
	if s1[0].MetKey != "a,m,z" || s1[0].MetKey != s2[0].MetKey {
		t.Fatalf("%q %q", s1[0].MetKey, s2[0].MetKey)
	}
}

// ---- DB wrapper ----

func newAlertSvc(t *testing.T) (*SignalService, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SignalRule{}, &models.SignalState{}, &models.SignalEvent{}, &models.NotificationSetting{}); err != nil {
		t.Fatal(err)
	}
	return NewSignalService(db, nil, nil), db
}

func reportOf(items ...SignalItem) *SignalReport { return &SignalReport{Items: items} }

func TestRecordReportConcurrentNoDuplicates(t *testing.T) {
	svc, db := newAlertSvc(t)
	hold := reportOf(item(1, SignalHold, nil, nil))
	if ev, err := svc.recordReport(hold); err != nil || len(ev) != 0 {
		t.Fatal(ev, err)
	}
	sell := reportOf(item(1, SignalSell, []SignalCheck{chk("take_profit", "목표 수익률", true)}, nil))
	var wg sync.WaitGroup
	var mu sync.Mutex
	total := 0
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ev, err := svc.recordReport(sell)
			if err != nil {
				t.Error(err)
			}
			mu.Lock()
			total += len(ev)
			mu.Unlock()
		}()
	}
	wg.Wait()
	var n int64
	db.Model(&models.SignalEvent{}).Count(&n)
	if n != 1 || total != 1 {
		t.Fatalf("events=%d returned=%d", n, total)
	}
	if c, _ := svc.GetUnreadSignalCount(); c != 1 {
		t.Fatalf("unread %d", c)
	}
}

func TestRetentionCap(t *testing.T) {
	svc, db := newAlertSvc(t)
	if _, err := svc.recordReport(reportOf(item(1, SignalHold, nil, nil))); err != nil {
		t.Fatal(err)
	}
	sell := reportOf(item(1, SignalSell, []SignalCheck{chk("a", "A", true)}, nil))
	hold := reportOf(item(1, SignalHold, nil, nil))
	for i := 0; i < 260; i++ { // 2 events per loop
		if _, err := svc.recordReport(sell); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.recordReport(hold); err != nil {
			t.Fatal(err)
		}
	}
	var n int64
	db.Model(&models.SignalEvent{}).Count(&n)
	if n != signalEventRetention {
		t.Fatalf("count %d", n)
	}
	events, _, _ := svc.GetSignalEvents(1000, false)
	if len(events) != signalEventRetention || events[0].ID < events[1].ID {
		t.Fatal("order/limit")
	}
}

func TestMarkReadAndCount(t *testing.T) {
	svc, _ := newAlertSvc(t)
	svc.recordReport(reportOf(item(1, SignalHold, nil, nil), item(2, SignalHold, nil, nil), item(3, SignalHold, nil, nil)))
	sell := func(id uint) SignalItem { return item(id, SignalSell, []SignalCheck{chk("a", "A", true)}, nil) }
	ev, _ := svc.recordReport(reportOf(sell(1), sell(2), sell(3)))
	if len(ev) != 3 {
		t.Fatalf("%d", len(ev))
	}
	if n, _ := svc.GetUnreadSignalCount(); n != 3 {
		t.Fatal(n)
	}
	n, err := svc.MarkSignalEventsRead([]uint{ev[0].ID}, false)
	if err != nil || n != 2 {
		t.Fatal(n, err)
	}
	if unread, _, _ := svc.GetSignalEvents(50, true); len(unread) != 2 {
		t.Fatal(len(unread))
	}
	if n, _ := svc.MarkSignalEventsRead(nil, false); n != 2 {
		t.Fatal("noop", n)
	}
	if n, _ := svc.MarkSignalEventsRead(nil, true); n != 0 {
		t.Fatal(n)
	}
}

func TestNotificationSettings(t *testing.T) {
	svc, _ := newAlertSvc(t)
	s, err := svc.GetNotificationSettings()
	if err != nil || !s.Enabled || s.IntervalMinutes != 60 || !s.OSNotify || !s.NotifySell || !s.NotifyBuy || !s.NotifyConflict {
		t.Fatalf("%+v %v", s, err)
	}
	woken := 0
	svc.SetSettingsListener(func() { woken++ })
	in := *s
	in.IntervalMinutes = 45
	_, err = svc.SaveNotificationSettings(in)
	var inv *ErrInvalidSignalRule
	if !errors.As(err, &inv) || woken != 0 {
		t.Fatalf("expected validation error, got %v", err)
	}
	in.IntervalMinutes = 15
	in.Enabled = false
	in.NotifyBuy = false
	if _, err := svc.SaveNotificationSettings(in); err != nil || woken != 1 {
		t.Fatal(err, woken)
	}
	s2, _ := svc.GetNotificationSettings()
	if s2.Enabled || s2.NotifyBuy || s2.IntervalMinutes != 15 || !s2.NotifySell {
		t.Fatalf("%+v", s2)
	}
}
