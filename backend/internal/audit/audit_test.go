package audit

import (
	"sync"
	"testing"
	"time"
)

func TestLogLogin_GeneratesCorrectAction(t *testing.T) {
	collected := make([]Event, 0)
	var mu sync.Mutex

	// Create a logger with a nil repo (won't actually write to DB)
	// Instead we intercept events via the channel
	logger := &Logger{
		events: make(chan Event, 100),
		done:   make(chan struct{}),
	}

	// Drain manually
	go func() {
		for evt := range logger.events {
			mu.Lock()
			collected = append(collected, evt)
			mu.Unlock()
		}
		close(logger.done)
	}()

	logger.LogLogin("user-1", "192.168.1.1", "Mozilla/5.0", true)

	// Give time for async processing
	time.Sleep(50 * time.Millisecond)
	close(logger.events)
	<-logger.done

	mu.Lock()
	defer mu.Unlock()
	if len(collected) != 1 {
		t.Fatalf("expected 1 event, got %d", len(collected))
	}
	if collected[0].Action != "login_success" {
		t.Errorf("action = %q, want %q", collected[0].Action, "login_success")
	}
	if collected[0].UserID != "user-1" {
		t.Errorf("user_id = %q, want %q", collected[0].UserID, "user-1")
	}
}

func TestLogTransfer_IncludesAmountAndCurrency(t *testing.T) {
	collected := make([]Event, 0)
	var mu sync.Mutex

	logger := &Logger{
		events: make(chan Event, 100),
		done:   make(chan struct{}),
	}

	go func() {
		for evt := range logger.events {
			mu.Lock()
			collected = append(collected, evt)
			mu.Unlock()
		}
		close(logger.done)
	}()

	logger.LogTransfer("user-2", "tx-abc", 5000000, "CRC", "10.0.0.1")

	time.Sleep(50 * time.Millisecond)
	close(logger.events)
	<-logger.done

	mu.Lock()
	defer mu.Unlock()
	if len(collected) != 1 {
		t.Fatalf("expected 1 event, got %d", len(collected))
	}

	details := collected[0].Details
	if details["amount"] != int64(5000000) {
		t.Errorf("amount = %v, want %d", details["amount"], 5000000)
	}
	if details["currency"] != "CRC" {
		t.Errorf("currency = %v, want %q", details["currency"], "CRC")
	}
}

func TestConcurrentLogs_NoneDropped(t *testing.T) {
	collected := make([]Event, 0)
	var mu sync.Mutex

	logger := &Logger{
		events: make(chan Event, 1000),
		done:   make(chan struct{}),
	}

	go func() {
		for evt := range logger.events {
			mu.Lock()
			collected = append(collected, evt)
			mu.Unlock()
		}
		close(logger.done)
	}()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			logger.LogLogin("user-concurrent", "127.0.0.1", "test", true)
		}()
	}

	wg.Wait()
	time.Sleep(100 * time.Millisecond)
	close(logger.events)
	<-logger.done

	mu.Lock()
	defer mu.Unlock()
	if len(collected) != 100 {
		t.Errorf("expected 100 events, got %d", len(collected))
	}
}

func TestLogLogin_FailedAttemptSetsMediumRisk(t *testing.T) {
	collected := make([]Event, 0)
	var mu sync.Mutex

	logger := &Logger{
		events: make(chan Event, 100),
		done:   make(chan struct{}),
	}

	go func() {
		for evt := range logger.events {
			mu.Lock()
			collected = append(collected, evt)
			mu.Unlock()
		}
		close(logger.done)
	}()

	logger.LogLogin("user-3", "10.0.0.1", "curl", false)

	time.Sleep(50 * time.Millisecond)
	close(logger.events)
	<-logger.done

	mu.Lock()
	defer mu.Unlock()
	if len(collected) != 1 {
		t.Fatalf("expected 1 event, got %d", len(collected))
	}
	if collected[0].Action != "login_failed" {
		t.Errorf("action = %q, want %q", collected[0].Action, "login_failed")
	}
	if collected[0].RiskLevel != "medium" {
		t.Errorf("risk_level = %q, want %q", collected[0].RiskLevel, "medium")
	}
}
