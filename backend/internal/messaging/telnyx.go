package messaging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/kiramopay/backend/internal/observability"
)

// telnyxSMS sends SMS through Telnyx's REST API (POST /v2/messages). It mirrors
// the raw-HTTP style of the assistant clients (fixed constant host, traced
// http.Client from observability, bounded response read).
type telnyxSMS struct {
	apiKey    string
	from      string
	profileID string
	baseURL   string
	client    *http.Client
}

func newTelnyxSMS(cfg SMSConfig) *telnyxSMS {
	return &telnyxSMS{
		apiKey:    cfg.TelnyxAPIKey,
		from:      cfg.TelnyxFrom,
		profileID: cfg.MessagingProfileID,
		baseURL:   "https://api.telnyx.com",
		client:    observability.HTTPClient(15 * time.Second),
	}
}

type telnyxRequest struct {
	From               string `json:"from,omitempty"`
	MessagingProfileID string `json:"messaging_profile_id,omitempty"`
	To                 string `json:"to"`
	Text               string `json:"text"`
}

type telnyxError struct {
	Code   string `json:"code"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

type telnyxResponse struct {
	Data *struct {
		ID string `json:"id"`
	} `json:"data,omitempty"`
	Errors []telnyxError `json:"errors,omitempty"`
}

func (t *telnyxSMS) SendSMS(ctx context.Context, toE164, body string) error {
	reqBody := telnyxRequest{To: toE164, Text: body}
	// Prefer an explicit From number; fall back to the messaging profile, which
	// lets Telnyx pick a number from the pool.
	if t.from != "" {
		reqBody.From = t.from
	} else {
		reqBody.MessagingProfileID = t.profileID
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	// Fixed constant host; the destination travels in the body, not the path.
	url := t.baseURL + "/v2/messages"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload)) // #nosec G704 -- fixed constant host
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+t.apiKey)

	resp, err := t.client.Do(httpReq) // #nosec G704 -- fixed constant host
	if err != nil {
		return fmt.Errorf("telnyx request: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var tr telnyxResponse
		if json.Unmarshal(raw, &tr) == nil && len(tr.Errors) > 0 {
			e := tr.Errors[0]
			detail := e.Detail
			if detail == "" {
				detail = e.Title
			}
			return fmt.Errorf("telnyx %d: %s", resp.StatusCode, detail)
		}
		return fmt.Errorf("telnyx http %d", resp.StatusCode)
	}
	return nil
}
