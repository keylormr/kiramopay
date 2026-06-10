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
}

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
}

type CORSConfig struct {
	Origins []string
}

func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port:         getEnvInt("SERVER_PORT", 8080),
			Environment:  getEnv("ENVIRONMENT", "development"),
			ReadTimeout:  time.Duration(getEnvInt("SERVER_READ_TIMEOUT", 10)) * time.Second,
			WriteTimeout: time.Duration(getEnvInt("SERVER_WRITE_TIMEOUT", 10)) * time.Second,
		},
		Database: DatabaseConfig{
			Host:        getEnv("DB_HOST", "localhost"),
			Port:        getEnvInt("DB_PORT", 5432),
			User:        getEnv("DB_USER", "kiramopay"),
			Password:    getEnv("DB_PASSWORD", "kiramopay_dev"),
			DBName:      getEnv("DB_NAME", "kiramopay"),
			SSLMode:     getEnv("DB_SSL_MODE", "disable"),
			MaxConns:    getEnvInt("DB_MAX_CONNS", 50),
			SSLRootCert: getEnv("DB_SSL_ROOT_CERT", ""),
			SSLCert:     getEnv("DB_SSL_CERT", ""),
			SSLKey:      getEnv("DB_SSL_KEY", ""),
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
	if c.Database.SSLMode == "disable" {
		errs = append(errs, "DB_SSL_MODE must not be 'disable' in production")
	}
	if c.Redis.Password == "" {
		errs = append(errs, "REDIS_PASSWORD must be set in production")
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
