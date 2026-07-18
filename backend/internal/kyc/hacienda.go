package kyc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/kiramopay/backend/internal/observability"
)

// Errors that let callers distinguish "the cedula does not exist" (a real
// negative result the user should see) from "the service is unreachable" (an
// infra hiccup that must NOT be treated as a failed identity, i.e. fail-open).
var (
	ErrIdentityNotFound    = errors.New("identity not found")
	ErrIdentityUnavailable = errors.New("identity service unavailable")
)

// Costa Rica taxpayer id types (Hacienda tipoIdentificacion codes).
func mapIDType(code string) string {
	switch strings.TrimSpace(code) {
	case "01":
		return "national_id"
	case "02":
		return "juridica"
	case "03":
		return "dimex"
	case "04":
		return "nite"
	default:
		return "unknown"
	}
}

// HaciendaResult is the normalized outcome of an identity lookup.
type HaciendaResult struct {
	Name   string // official taxpayer name
	IDType string // national_id | juridica | dimex | nite | unknown
	Source string // hacienda | gometa
}

var cedulaDigits = regexp.MustCompile(`^\d{9,12}$`)

type haciendaCacheEntry struct {
	res *HaciendaResult // nil = confirmed not-found
	at  time.Time
}

// HaciendaClient looks up Costa Rican identities against the free public
// Hacienda taxpayer registry (api.hacienda.go.cr), with apis.gometa.org as a
// fallback. Results are cached (identity is stable) and every call is
// timeout-bounded. Only existence + name + id type are read — never padron/TSE
// electoral data.
type HaciendaClient struct {
	client   *http.Client
	primary  string
	fallback string
	ttl      time.Duration
	mu       sync.RWMutex
	cache    map[string]haciendaCacheEntry
}

// NewHaciendaClient builds a client with sensible defaults. Empty base URLs
// fall back to the public endpoints.
func NewHaciendaClient(primary, fallback string) *HaciendaClient {
	if primary == "" {
		primary = "https://api.hacienda.go.cr/fe/ae"
	}
	if fallback == "" {
		fallback = "https://apis.gometa.org/cedulas"
	}
	return &HaciendaClient{
		client:   observability.HTTPClient(5 * time.Second),
		primary:  primary,
		fallback: fallback,
		ttl:      24 * time.Hour, // taxpayer identity is stable
		cache:    make(map[string]haciendaCacheEntry),
	}
}

func (c *HaciendaClient) getCached(cedula string) (*HaciendaResult, bool, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.cache[cedula]
	if !ok || time.Since(e.at) > c.ttl {
		return nil, false, false
	}
	// found=true when we have a positive result; res may be nil for a cached
	// confirmed not-found.
	return e.res, e.res != nil, true
}

func (c *HaciendaClient) putCached(cedula string, res *HaciendaResult) {
	c.mu.Lock()
	c.cache[cedula] = haciendaCacheEntry{res: res, at: time.Now()}
	c.mu.Unlock()
}

// Lookup resolves a cedula to its official name + id type. Returns
// ErrIdentityNotFound when the id genuinely does not exist, and
// ErrIdentityUnavailable when neither provider could be reached.
func (c *HaciendaClient) Lookup(ctx context.Context, cedula string) (*HaciendaResult, error) {
	cedula = strings.ReplaceAll(strings.TrimSpace(cedula), "-", "")
	if !cedulaDigits.MatchString(cedula) {
		return nil, ErrIdentityNotFound
	}

	if res, found, ok := c.getCached(cedula); ok {
		if found {
			return res, nil
		}
		return nil, ErrIdentityNotFound
	}

	// Primary: Hacienda.
	res, err := c.lookupHacienda(ctx, cedula)
	if err == nil {
		c.putCached(cedula, res)
		return res, nil
	}
	if errors.Is(err, ErrIdentityNotFound) {
		c.putCached(cedula, nil)
		return nil, ErrIdentityNotFound
	}

	// Fallback: gometa (only when primary was unavailable, not on a clean 404).
	res, ferr := c.lookupGometa(ctx, cedula)
	if ferr == nil {
		c.putCached(cedula, res)
		return res, nil
	}
	if errors.Is(ferr, ErrIdentityNotFound) {
		c.putCached(cedula, nil)
		return nil, ErrIdentityNotFound
	}

	return nil, ErrIdentityUnavailable
}

func (c *HaciendaClient) lookupHacienda(ctx context.Context, cedula string) (*HaciendaResult, error) {
	u := fmt.Sprintf("%s?identificacion=%s", c.primary, url.QueryEscape(cedula))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, ErrIdentityUnavailable
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, ErrIdentityUnavailable
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusOK:
		var body struct {
			Nombre             string `json:"nombre"`
			TipoIdentificacion string `json:"tipoIdentificacion"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			return nil, ErrIdentityUnavailable
		}
		if strings.TrimSpace(body.Nombre) == "" {
			return nil, ErrIdentityNotFound
		}
		return &HaciendaResult{
			Name:   strings.TrimSpace(body.Nombre),
			IDType: mapIDType(body.TipoIdentificacion),
			Source: "hacienda",
		}, nil
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return nil, ErrIdentityNotFound
	default:
		return nil, ErrIdentityUnavailable
	}
}

func (c *HaciendaClient) lookupGometa(ctx context.Context, cedula string) (*HaciendaResult, error) {
	u := fmt.Sprintf("%s/%s", c.fallback, url.PathEscape(cedula))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, ErrIdentityUnavailable
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, ErrIdentityUnavailable
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return nil, ErrIdentityNotFound
		}
		return nil, ErrIdentityUnavailable
	}
	var body struct {
		Results []struct {
			Fullname  string `json:"fullname"`
			GuessType string `json:"guess_type"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, ErrIdentityUnavailable
	}
	if len(body.Results) == 0 || strings.TrimSpace(body.Results[0].Fullname) == "" {
		return nil, ErrIdentityNotFound
	}
	idType := "national_id"
	if strings.Contains(strings.ToLower(body.Results[0].GuessType), "dimex") {
		idType = "dimex"
	} else if strings.Contains(strings.ToLower(body.Results[0].GuessType), "juridica") {
		idType = "juridica"
	}
	return &HaciendaResult{
		Name:   strings.TrimSpace(body.Results[0].Fullname),
		IDType: idType,
		Source: "gometa",
	}, nil
}
