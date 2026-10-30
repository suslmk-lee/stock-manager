package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gen2brain/beeep"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const signalMonitorStartDelay = 20 * time.Second

// signalChecker 는 모니터가 의존하는 서비스 기능이다 (테스트에서 대체).
type signalChecker interface {
	GetNotificationSettings() (*models.NotificationSetting, error)
	CheckSignals() ([]models.SignalEvent, int64, error)
}

// signalMonitor 는 주기적으로 신호를 점검하고 새 이벤트를 앱/OS 에 알린다.
type signalMonitor struct {
	checker    signalChecker
	startDelay time.Duration
	after      func(d time.Duration) <-chan time.Time // 주입 가능한 타이머
	emit       func(events []models.SignalEvent)      // 프론트엔드 이벤트
	notify     func(title, body string) error         // OS 알림
	wake       chan struct{}
}

func newSignalMonitor(checker signalChecker, emit func([]models.SignalEvent), notify func(title, body string) error) *signalMonitor {
	return &signalMonitor{
		checker:    checker,
		startDelay: signalMonitorStartDelay,
		after:      time.After,
		emit:       emit,
		notify:     notify,
		wake:       make(chan struct{}, 1),
	}
}

// Wake 는 대기 중인 루프를 즉시 깨워 새 설정을 적용하게 한다.
func (m *signalMonitor) Wake() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

// Run 은 ctx 가 끝날 때까지 점검 루프를 실행한다.
func (m *signalMonitor) Run(ctx context.Context) {
	if !m.sleep(ctx, m.startDelay) {
		return
	}
	for {
		interval := time.Hour
		set, err := m.checker.GetNotificationSettings()
		if err != nil {
			log.Printf("signal monitor: settings: %v", err)
		} else {
			interval = time.Duration(set.IntervalMinutes) * time.Minute
			if interval <= 0 {
				interval = time.Hour
			}
			if set.Enabled {
				m.checkOnce(set)
			}
		}
		if !m.sleep(ctx, interval) {
			return
		}
	}
}

func (m *signalMonitor) checkOnce(set *models.NotificationSetting) {
	events, _, err := m.checker.CheckSignals()
	if err != nil {
		log.Printf("signal monitor: check: %v", err)
		return
	}
	if len(events) == 0 {
		return
	}
	if m.emit != nil {
		m.emit(events)
	}
	if set.OSNotify && m.notify != nil {
		if err := m.notify(notificationTitle(events), notificationBody(events)); err != nil {
			log.Printf("signal monitor: notify: %v", err)
		}
	}
}

func allSuggestions(events []models.SignalEvent) bool {
	for _, e := range events {
		if e.Kind != models.SignalEventKindSuggestion {
			return false
		}
	}
	return len(events) > 0
}

func notificationTitle(events []models.SignalEvent) string {
	if allSuggestions(events) {
		return "전략 프로필 추천"
	}
	return "매매 신호"
}

func notificationBody(events []models.SignalEvent) string {
	if len(events) > 1 && allSuggestions(events) {
		return fmt.Sprintf("프로필 후보 %d건 · %s 외", len(events), events[0].Name)
	}
	if len(events) == 1 {
		return fmt.Sprintf("%s: %s", events[0].Name, events[0].Message)
	}
	return fmt.Sprintf("새 신호 %d건 · %s 외", len(events), events[0].Name)
}

// sleep 은 d 만큼 대기한다. ctx 종료면 false, 깨우기(Wake)나 타임아웃이면 true.
func (m *signalMonitor) sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-m.wake:
		return true
	case <-m.after(d):
		return true
	}
}

func (a *App) startSignalMonitor(ctx context.Context) {
	m := newSignalMonitor(a.signalService,
		func(events []models.SignalEvent) { runtime.EventsEmit(ctx, "signals:new", events) },
		func(title, body string) error { return beeep.Notify(title, body, "") },
	)
	a.signalService.SetSettingsListener(m.Wake)
	go m.Run(ctx)
}

var _ signalChecker = (*services.SignalService)(nil)
