package config

import (
	"testing"
)

func TestValidateForProduction_DefaultJWTSecret_Error(t *testing.T) {
	cfg := &Config{
		Server:   ServerConfig{Environment: "production"},
		Database: DatabaseConfig{SSLMode: "verify-full", Password: "strong-password"},
		Redis:    RedisConfig{Password: "redis-pass"},
		JWT:      JWTConfig{Secret: "dev-secret-change-in-production"},
	}
	if err := cfg.ValidateForProduction(); err == nil {
		t.Error("expected error for default JWT secret in production")
	}
}

func TestValidateForProduction_DBSSLDisable_Error(t *testing.T) {
	t.Setenv("DATABASE_URL", "") // exercise the individual DB_* var checks
	cfg := &Config{
		Server:   ServerConfig{Environment: "production"},
		Database: DatabaseConfig{SSLMode: "disable", Password: "strong-password"},
		Redis:    RedisConfig{Password: "redis-pass"},
		JWT:      JWTConfig{Secret: "a-secure-production-secret-key-with-enough-length"},
	}
	if err := cfg.ValidateForProduction(); err == nil {
		t.Error("expected error for DB SSL disable in production")
	}
}

func TestValidateForProduction_DatabaseURL_SkipsDBVarChecks(t *testing.T) {
	// With DATABASE_URL set, the individual DB_PASSWORD/DB_SSL_MODE are unused
	// (database.NewPostgresPool prefers DATABASE_URL), so their checks must not
	// gate startup even at their development defaults.
	t.Setenv("DATABASE_URL", "postgres://u:p@neon.example/db?sslmode=require")
	t.Setenv("METRICS_TOKEN", "metrics-secret")
	cfg := &Config{
		Server:   ServerConfig{Environment: "production"},
		Database: DatabaseConfig{SSLMode: "disable", Password: "kiramopay_dev"},
		Redis:    RedisConfig{Password: "redis-pass"},
		JWT:      JWTConfig{Secret: "a-secure-production-secret-key-with-enough-length"},
	}
	if err := cfg.ValidateForProduction(); err != nil {
		t.Errorf("DATABASE_URL set should skip the DB_* var checks, got: %v", err)
	}
}

func TestValidateForProduction_DatabaseURL_RejectsSSLDisable(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@neon.example/db?sslmode=disable")
	cfg := &Config{
		Server:   ServerConfig{Environment: "production"},
		Database: DatabaseConfig{SSLMode: "verify-full", Password: "strong-password"},
		Redis:    RedisConfig{Password: "redis-pass"},
		JWT:      JWTConfig{Secret: "a-secure-production-secret-key-with-enough-length"},
	}
	if err := cfg.ValidateForProduction(); err == nil {
		t.Error("expected error for DATABASE_URL with sslmode=disable")
	}
}

func TestValidateForProduction_RedisNoPassword_Error(t *testing.T) {
	cfg := &Config{
		Server:   ServerConfig{Environment: "production"},
		Database: DatabaseConfig{SSLMode: "verify-full", Password: "strong-password"},
		Redis:    RedisConfig{Password: ""},
		JWT:      JWTConfig{Secret: "a-secure-production-secret-key-with-enough-length"},
	}
	if err := cfg.ValidateForProduction(); err == nil {
		t.Error("expected error for Redis without password in production")
	}
}

func TestValidateForProduction_Development_NoError(t *testing.T) {
	cfg := &Config{
		Server:   ServerConfig{Environment: "development"},
		Database: DatabaseConfig{SSLMode: "disable"},
		Redis:    RedisConfig{Password: ""},
		JWT:      JWTConfig{Secret: "dev-secret-change-in-production"},
	}
	if err := cfg.ValidateForProduction(); err != nil {
		t.Errorf("unexpected error for development: %v", err)
	}
}

func TestValidateForProduction_AllSecure_NoError(t *testing.T) {
	t.Setenv("DATABASE_URL", "") // individual DB_* vars are the connection source here
	t.Setenv("METRICS_TOKEN", "metrics-secret")
	cfg := &Config{
		Server:   ServerConfig{Environment: "production"},
		Database: DatabaseConfig{SSLMode: "verify-full", Password: "strong-password"},
		Redis:    RedisConfig{Password: "redis-pass"},
		JWT:      JWTConfig{Secret: "a-secure-production-secret-key-with-enough-length"},
	}
	if err := cfg.ValidateForProduction(); err != nil {
		t.Errorf("unexpected error with secure config: %v", err)
	}
}

func TestDSN_IncludesSSLRootCert(t *testing.T) {
	cfg := DatabaseConfig{
		Host:        "db.example.com",
		Port:        5432,
		User:        "app",
		Password:    "secret",
		DBName:      "kiramopay",
		SSLMode:     "verify-full",
		SSLRootCert: "/etc/ssl/certs/rds-ca.pem",
	}
	dsn := cfg.DSN()
	if !containsSubstr(dsn, "sslrootcert=/etc/ssl/certs/rds-ca.pem") {
		t.Errorf("DSN missing sslrootcert, got: %s", dsn)
	}
}

func TestDSN_NoSSLParamsWhenNotConfigured(t *testing.T) {
	cfg := DatabaseConfig{
		Host:     "localhost",
		Port:     5432,
		User:     "kiramopay",
		Password: "dev",
		DBName:   "kiramopay",
		SSLMode:  "disable",
	}
	dsn := cfg.DSN()
	if containsSubstr(dsn, "sslrootcert") {
		t.Errorf("DSN should not contain sslrootcert, got: %s", dsn)
	}
}

func containsSubstr(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
