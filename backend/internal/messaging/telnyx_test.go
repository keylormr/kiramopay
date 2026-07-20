package messaging

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTelnyxSendSMSSuccess(t *testing.T) {
	var gotAuth, gotPath, gotMethod string
	var gotBody telnyxRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		gotMethod = r.Method
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"id":"msg-1"}}`))
	}))
	defer srv.Close()

	sms := &telnyxSMS{apiKey: "secret", from: "+15550001111", baseURL: srv.URL, client: srv.Client()}
	if err := sms.SendSMS(context.Background(), "+50688887777", "hola"); err != nil {
		t.Fatalf("SendSMS returned error: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/v2/messages" {
		t.Errorf("path = %s, want /v2/messages", gotPath)
	}
	if gotAuth != "Bearer secret" {
		t.Errorf("auth = %q, want Bearer secret", gotAuth)
	}
	if gotBody.To != "+50688887777" || gotBody.Text != "hola" || gotBody.From != "+15550001111" {
		t.Errorf("body = %+v", gotBody)
	}
}

func TestTelnyxUsesMessagingProfileWhenNoFrom(t *testing.T) {
	var gotBody telnyxRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"id":"x"}}`))
	}))
	defer srv.Close()

	sms := &telnyxSMS{apiKey: "k", profileID: "profile-9", baseURL: srv.URL, client: srv.Client()}
	if err := sms.SendSMS(context.Background(), "+50688887777", "hi"); err != nil {
		t.Fatalf("SendSMS error: %v", err)
	}
	if gotBody.MessagingProfileID != "profile-9" || gotBody.From != "" {
		t.Errorf("expected messaging_profile_id routing, got %+v", gotBody)
	}
}

func TestTelnyxSendSMSErrorSurfacesDetail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"errors":[{"code":"10002","detail":"Invalid 'to' number"}]}`))
	}))
	defer srv.Close()

	sms := &telnyxSMS{apiKey: "k", from: "+1", baseURL: srv.URL, client: srv.Client()}
	err := sms.SendSMS(context.Background(), "bad", "hi")
	if err == nil {
		t.Fatal("expected error on 400")
	}
	if !strings.Contains(err.Error(), "Invalid 'to' number") {
		t.Errorf("error should surface Telnyx detail, got: %v", err)
	}
}
