package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Server    ServerConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	JWT       JWTConfig
	CORS      CORSConfig
	VAPID     VAPIDConfig
	Telemetry TelemetryConfig
	Gemini    GeminiConfig
	Anthropic AnthropicConfig
}

// GeminiConfig controls the conversational assistant. The assistant is a no-op
// (returns "unavailable") unless GEMINI_API_KEY is set — same gating discipline
// as telemetry, so the service runs identically with no key in dev/CI.
type GeminiConfig struct {
	APIKey string // GEMINI_API_KEY
	Model  string // GEMINI_MODEL
}

// AnthropicConfig controls the Claude assistant provider. When ANTHROPIC_API_KEY
// is set it takes precedence over Gemini (see main.go). Same no-op gating: with
// neither key the assistant reports itself unavailable.
type AnthropicConfig struct {
	APIKey string // ANTHROPIC_API_KEY
	Model  string // ANTHROPIC_MODEL
}

// TelemetryConfig controls OpenTelemetry tracing. Tracing is enabled only when
// an OTLP endpoint is set (auto-enabled if OTEL_EXPORTER_OTLP_ENDPOINT is
// present), so the service runs identically with no collector in dev/CI.
type TelemetryConfig struct {
	Endpoint    string  // OTEL_EXPORTER_OTLP_ENDPOINT (host:port)
	Insecure    bool    // OTEL_EXPORTER_OTLP_INSECURE
	SampleRatio float64 // OTEL_TRACES_SAMPLER_RATIO (0<r<=1)
}

type VAPIDConfig struct {
	PublicKey  string
	PrivateKey string
}

type ServerConfig struct {
	Port         int
	Environment  string // "development", "staging", "production"
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	// RequirePhoneVerification gates registration on a verified phone OTP.
	// Keep false until an SMS provider can deliver the code.
	RequirePhoneVerification bool
}

type DatabaseConfig struct {
	Host        string
	Port        int
	User        string
	Password    string
	DBName      string
	SSLMode     string
	MaxConns    int
	SSLRootCert string
	SSLCert     string
	SSLKey      string
	// PIIEncryptionKey is set as the `kiramopay.encryption_key` GUC on every
	// pooled connection (AfterConnect), so pgcrypto fn_pii_* can encrypt/decrypt
	// user PII at rest. Required in production (fail-closed).
	PIIEncryptionKey string
}

// DevPIIKey is the development default for PII_ENCRYPTION_KEY. Rejected in
// production by ValidateForProduction, mirroring the JWT secret discipline.
const DevPIIKey = "dev-pii-encryption-key-change-me-000"

func (d DatabaseConfig) DSN() string {
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.DBName, d.SSLMode,
	)
	if d.SSLRootCert != "" {
		dsn += "&sslrootcert=" + d.SSLRootCert
	}
	if d.SSLCert != "" {
		dsn += "&sslcert=" + d.SSLCert
	}
	if d.SSLKey != "" {
		dsn += "&sslkey=" + d.SSLKey
	}
	return dsn
}

type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type JWTConfig struct {
	Secret          string
	AccessDuration  time.Duration
	RefreshDuration time.Duration
	// IdleTimeout ends a session after this much inactivity (no refresh), even
	// while the refresh token is still within RefreshDuration. RefreshDuration
	// doubles as the absolute session cap (max age from the original login).
	IdleTimeout time.Duration
}

type CORSConfig struct {
	Origins []string
}

func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port:                     getEnvInt("SERVER_PORT", 8080),
			// Fail-safe default: an UNSET ENVIRONMENT is treated as production, so a
			// deploy that forgets to set it runs the full ValidateForProduction gate
			// instead of silently booting with development bypasses. Local work opts
			// out explicitly via ENVIRONMENT=development (see .env.example).
			Environment:              getEnv("ENVIRONMENT", "production"),
			ReadTimeout:              time.Duration(getEnvInt("SERVER_READ_TIMEOUT", 10)) * time.Second,
			WriteTimeout:             time.Duration(getEnvInt("SERVER_WRITE_TIMEOUT", 10)) * time.Second,
			RequirePhoneVerification: getEnv("REQUIRE_PHONE_VERIFICATION", "false") == "true",
		},
		Database: DatabaseConfig{
			Host:        getEnv("DB_HOST", "localhost"),
			Port:        getEnvInt("DB_PORT", 5432),
			User:        getEnv("DB_USER", "kiramopay"),
			Password:    getEnv("DB_PASSWORD", "kiramopay_dev"),
			DBName:      getEnv("DB_NAME", "kiramopay"),
			SSLMode:     getEnv("DB_SSL_MODE", "disable"),
			MaxConns:    getEnvInt("DB_MAX_CONNS", 50),
			SSLRootCert:      getEnv("DB_SSL_ROOT_CERT", ""),
			SSLCert:          getEnv("DB_SSL_CERT", ""),
			SSLKey:           getEnv("DB_SSL_KEY", ""),
			PIIEncryptionKey: getEnv("PII_ENCRYPTION_KEY", DevPIIKey),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnvInt("REDIS_PORT", 6379),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 0),
		},
		JWT: JWTConfig{
			Secret:          getEnv("JWT_SECRET", "dev-secret-change-in-production"),
			AccessDuration:  time.Duration(getEnvInt("JWT_ACCESS_MINUTES", 15)) * time.Minute,
			RefreshDuration: time.Duration(getEnvInt("JWT_REFRESH_DAYS", 7)) * 24 * time.Hour,
			IdleTimeout:     time.Duration(getEnvInt("JWT_IDLE_MINUTES", 30)) * time.Minute,
		},
		CORS: CORSConfig{
			Origins: parseCORSOrigins(getEnv("CORS_ORIGINS", "http://localhost:*,https://localhost:*")),
		},
		VAPID: VAPIDConfig{
			PublicKey:  getEnv("VAPID_PUBLIC_KEY", ""),
			PrivateKey: getEnv("VAPID_PRIVATE_KEY", ""),
		},
		Telemetry: TelemetryConfig{
			Endpoint:    getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
			Insecure:    getEnvBool("OTEL_EXPORTER_OTLP_INSECURE", false),
			SampleRatio: getEnvFloat("OTEL_TRACES_SAMPLER_RATIO", 1.0),
		},
		Gemini: GeminiConfig{
			APIKey: getEnv("GEMINI_API_KEY", ""),
			Model:  getEnv("GEMINI_MODEL", "gemini-2.0-flash"),
		},
		Anthropic: AnthropicConfig{
			APIKey: getEnv("ANTHROPIC_API_KEY", ""),
			Model:  getEnv("ANTHROPIC_MODEL", "claude-opus-4-8"),
		},
	}
}

// ValidateForProduction checks that config is safe for production.
// Also rejects insecure defaults in *staging* and any non-development env
// (so a typo like ENVIRONMENT=prod doesn't silently bypass checks).
func (c *Config) ValidateForProduction() error {
	if c.Server.Environment == "development" {
		return nil
	}

	var errs []string

	// JWT secret must be a real cryptographic value (≥32 bytes recommended).
	if c.JWT.Secret == "dev-secret-change-in-production" {
		errs = append(errs, "JWT_SECRET is set to the development default — generate a fresh 32-byte random value")
	}
	if len(c.JWT.Secret) < 32 {
		errs = append(errs, "JWT_SECRET must be at least 32 characters (use `openssl rand -base64 48`)")
	}
	// The individual DB_* credentials are only used when DATABASE_URL is unset
	// (database.NewPostgresPool prefers DATABASE_URL). When DATABASE_URL is set
	// — the usual managed-Postgres setup — DB_PASSWORD / DB_SSL_MODE are unused,
	// so validate the URL's sslmode instead of gating on the dead vars.
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		if strings.Contains(dbURL, "sslmode=disable") {
			errs = append(errs, "DATABASE_URL must not use sslmode=disable in production")
		}
	} else {
		if c.Database.SSLMode == "disable" {
			errs = append(errs, "DB_SSL_MODE must not be 'disable' in production")
		}
		if c.Database.Password == "kiramopay_dev" {
			errs = append(errs, "DB_PASSWORD is set to the development default — set a real database password")
		}
	}
	if c.Redis.Password == "" {
		errs = append(errs, "REDIS_PASSWORD must be set in production")
	}
	// PII at rest is encrypted with this key; without it pgcrypto fn_pii_* raises
	// and every user lookup/registration fails — fail closed at startup instead.
	if c.Database.PIIEncryptionKey == DevPIIKey {
		errs = append(errs, "PII_ENCRYPTION_KEY is set to the development default — generate a fresh 32+ byte value")
	}
	if len(c.Database.PIIEncryptionKey) < 32 {
		errs = append(errs, "PII_ENCRYPTION_KEY must be at least 32 characters")
	}
	// /metrics is left open when METRICS_TOKEN is unset; require it in production
	// so operational telemetry (incl. ledger drift) is never internet-exposed.
	if os.Getenv("METRICS_TOKEN") == "" {
		errs = append(errs, "METRICS_TOKEN must be set in production (else /metrics is publicly exposed)")
	}
	// A wildcard origin combined with AllowCredentials:true (main.go) would
	// reflect credentials to any site. Require an explicit allowlist.
	for _, o := range c.CORS.Origins {
		if o == "*" {
			errs = append(errs, "CORS_ORIGINS must not be '*' in production (set an explicit allowlist)")
			break
		}
	}
	if c.JWT.AccessDuration > 60*time.Minute {
		errs = append(errs, "JWT_ACCESS_MINUTES should be <= 60 in production (short-lived access tokens)")
	}
	if c.JWT.RefreshDuration > 30*24*time.Hour {
		errs = append(errs, "JWT_REFRESH_DAYS should be <= 30 in production")
	}

	if len(errs) > 0 {
		return fmt.Errorf("production config validation failed:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}

func parseCORSOrigins(s string) []string {
	parts := strings.Split(s, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			origins = append(origins, p)
		}
	}
	return origins
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func getEnvFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}
