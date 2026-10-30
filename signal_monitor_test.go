package main

import (
	"context"
	"sync"
	"testing"
	"time"

	"stock-manager/models"
)

type fakeChecker struct {
	mu     sync.Mutex
	set    models.NotificationSetting
	events []models.SignalEvent
	checks int
}

func (f *fakeChecker) GetNotificationSettings() (*models.NotificationSetting, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.set
	return &s, nil
}

func (f *fakeChecker) CheckSignals() ([]models.SignalEvent, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checks++
	return f.events, int64(len(f.events)), nil
}

func TestNotificationBody(t *testing.T) {
	one := []models.SignalEvent{{Name: "삼성", Message: "매도 검토로 전환 · X"}}
	if got := notificationBody(one); got != "삼성: 매도 검토로 전환 · X" {
		t.Fatal(got)
	}
	two := []models.SignalEvent{{Name: "A"}, {Name: "B"}}
	if got := notificationBody(two); got != "새 신호 2건 · A 외" {
		t.Fatal(got)
	}
}

func TestMonitorRunChecksNotifiesAndStops(t *testing.T) {
	f := &fakeChecker{
		set:    models.DefaultNotificationSetting(),
		events: []models.SignalEvent{{Name: "A", Message: "m"}, {Name: "B", Message: "m"}},
	}
	var emitted, notified int
	var title, body string
	timer := make(chan time.Time)
	m := newSignalMonitor(f, func(e []models.SignalEvent) { emitted += len(e) },
		func(ti, bo string) error { notified++; title, body = ti, bo; return nil })
	m.after = func(time.Duration) <-chan time.Time { return timer }

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { m.Run(ctx); close(done) }()

	timer <- time.Now() // startup delay elapsed -> first check
	m.Wake()            // wakes the interval sleep -> second check
	timer <- time.Now() // (alternatively consumed by sleep) keeps test deterministic
	cancel()
	<-done

	if f.checks < 1 || emitted < 2 || notified < 1 || title != "매매 신호" || body != "새 신호 2건 · A 외" {
		t.Fatalf("checks=%d emitted=%d notified=%d %q %q", f.checks, emitted, notified, title, body)
	}
}

func TestMonitorDisabledSkipsCheck(t *testing.T) {
	f := &fakeChecker{set: models.DefaultNotificationSetting()}
	f.set.Enabled = false
	m := newSignalMonitor(f, nil, nil)
	m.startDelay = 0
	timer := make(chan time.Time)
	m.after = func(time.Duration) <-chan time.Time { return timer }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { m.Run(ctx); close(done) }()
	timer <- time.Now() // startDelay
	cancel()
	<-done
	if f.checks != 0 {
		t.Fatal("checked while disabled")
	}
}
