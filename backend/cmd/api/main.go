package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/kiramopay/backend/internal/assistant"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/b2b"
	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/cards"
	"github.com/kiramopay/backend/internal/config"
	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/database"
	"github.com/kiramopay/backend/internal/docs"
	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/fraud"
	"github.com/kiramopay/backend/internal/kyc"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/loyalty"
	"github.com/kiramopay/backend/internal/marketplace"
	"github.com/kiramopay/backend/internal/mfa"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/notification"
	"github.com/kiramopay/backend/internal/observability"
	"github.com/kiramopay/backend/internal/payment"
	"github.com/kiramopay/backend/internal/payout"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/reconcile"
	"github.com/kiramopay/backend/internal/recurring"
	"github.com/kiramopay/backend/internal/savings"
	"github.com/kiramopay/backend/internal/sinpe"
	"github.com/kiramopay/backend/internal/splitpay"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/transparency"
	"github.com/kiramopay/backend/internal/uif"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	ws "github.com/kiramopay/backend/internal/websocket"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// metricsAuth optionally protects /metrics with a bearer token. When token is
// empty the endpoint stays open; when set, callers must present it as either an
// "Authorization: Bearer <token>" header or a ?token= query parameter.
func metricsAuth(token string, next http.HandlerFunc) http.HandlerFunc {
	if token == "" {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token && r.URL.Query().Get("token") != token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func main() {
	cfg := config.Load()
	if err := cfg.ValidateForProduction(); err != nil {
		log.Fatalf("Config validation failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// ── Telemetry (OpenTelemetry traces + metrics) ───────────────────────
	// No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
	tracingShutdown, err := observability.Init(context.Background(), observability.Config{
		Enabled:     cfg.Telemetry.Endpoint != "",
		Endpoint:    cfg.Telemetry.Endpoint,
		Insecure:    cfg.Telemetry.Insecure,
		ServiceName: "kiramopay-api",
		Environment: cfg.Server.Environment,
		SampleRatio: cfg.Telemetry.SampleRatio,
	}, logger)
	if err != nil {
		log.Fatalf("Failed to init tracing: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tracingShutdown(ctx)
	}()

	pool, err := database.NewPostgresPool(cfg.Database)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()
	log.Println("Connected to PostgreSQL")

	if os.Getenv("RUN_MIGRATIONS") == "true" {
		migDir := os.Getenv("MIGRATIONS_DIR")
		if migDir == "" {
			migDir = "./migrations"
		}
		log.Printf("Running migrations from %s ...", migDir)
		if err := database.RunMigrations(context.Background(), pool, migDir); err != nil {
			log.Fatalf("Migrations failed: %v", err)
		}
		log.Println("Migrations up to date")
	}

	redisClient, err := database.NewRedisClient(cfg.Redis)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer redisClient.Close()
	log.Println("Connected to Redis")

	// Seed demo users (idempotent — skips if cedula already exists).
	// Runs automatically in `development`, and on demand in any other
	// environment if SEED_DEMO=true. Used to populate Keilor + Admin on
	// the free-tier deploy.
	if cfg.Server.Environment == "development" || os.Getenv("SEED_DEMO") == "true" {
		if err := database.SeedDevelopment(context.Background(), pool, cfg.Server.Environment == "development"); err != nil {
			log.Printf("Warning: seed failed: %v", err)
		}
	}

	jwtManager := jwtpkg.NewManager(cfg.JWT.Secret, cfg.JWT.AccessDuration, cfg.JWT.RefreshDuration)

	// ── Audit ────────────────────────────────────────────────────────────
	auditRepo := audit.NewRepository(pool)
	auditLogger := audit.NewLogger(auditRepo, 1000)
	defer auditLogger.Stop()

	// ── Lockout store ────────────────────────────────────────────────────
	lockoutStore := middleware.NewRedisLockoutStore(redisClient, 15*time.Minute)

	// ── Ledger engine ────────────────────────────────────────────────────
	ledgerEngine := ledger.NewEngine(pool, logger)

	// ── MFA service ──────────────────────────────────────────────────────
	mfaSvc := mfa.NewService(pool, &mfa.Config{
		ThresholdCRCMinor: 10_000_000, // 100,000 CRC
		ThresholdUSDMinor: 20_000,     // 200 USD
		VerifyWindow:      5 * time.Minute,
		// Authenticator secrets are encrypted at rest with a key derived from
		// JWT_SECRET. The domain prefix keeps this AES key distinct from the
		// webhook-secret key and from the JWT signing secret (key separation),
		// so analysis of one ciphertext domain never reveals another's key.
		TOTPEncryptionKey: []byte("kiramopay-totp-secret\x00" + cfg.JWT.Secret),
	})

	// ── Repositories ─────────────────────────────────────────────────────
	userRepo := user.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	authRepo := auth.NewRepository(pool, redisClient)
	txRepo := transaction.NewRepository(pool)
	sinpeRepo := sinpe.NewRepository(pool)
	paymentRepo := payment.NewRepository(pool)
	cryptoRepo := crypto.NewRepository(pool)
	priceService := crypto.NewPriceService()
	kycRepo := kyc.NewRepository(pool)
	uifRepo := uif.NewRepository(pool)

	marketplaceRepo := marketplace.NewRepository(pool)
	loyaltyRepo := loyalty.NewRepository(pool)
	qrRepo := qrpayment.NewRepository(pool)
	splitRepo := splitpay.NewRepository(pool)
	cardsRepo := cards.NewRepository(pool)
	fraudRepo := fraud.NewRepository(pool)
	countryRepo := country.NewRepository(pool)
	budgetRepo := budget.NewRepository(pool)
	recurringRepo := recurring.NewRepository(pool)
	savingsRepo := savings.NewRepository(pool)

	// ── Services ─────────────────────────────────────────────────────────
	kycService := kyc.NewService(kycRepo, &kyc.Options{AuditLogger: auditLogger})
	uifService := uif.NewService(uifRepo, &uif.Options{AuditLogger: auditLogger})
	authService := auth.NewService(authRepo, userRepo, walletRepo, jwtManager, &auth.Options{
		LockoutStore:     lockoutStore,
		AuditLogger:      auditLogger,
		Screener:         kycService,
		MaxLoginAttempts: 5,
		IdleTimeout:      cfg.JWT.IdleTimeout,
		AbsoluteTimeout:  cfg.JWT.RefreshDuration,
	})
	userService := user.NewService(userRepo)
	walletService := wallet.NewService(walletRepo)
	txService := transaction.NewService(txRepo, walletRepo, ledgerEngine, &transaction.Options{
		AuditLogger: auditLogger,
		MFA:         mfaSvc,
		UIF:         uifService,
	})
	// Notification service is created early so domains (e.g. SINPE) can notify
	// users on real events. Web push is gated on VAPID config; history is always
	// persisted.
	notifRepo := notification.NewRepository(pool)
	notifService := notification.NewService(notifRepo, cfg.VAPID.PublicKey, cfg.VAPID.PrivateKey)
	sinpeService := sinpe.NewService(sinpeRepo, txService, walletRepo, userRepo, &sinpe.Options{
		AuditLogger: auditLogger,
		Notifier:    notifService,
	})
	// Webhook signing secrets are encrypted at rest with a key derived from
	// JWT_SECRET. The domain prefix keeps this AES key distinct from the
	// TOTP-secret key (key separation).
	b2bCipher := b2b.NewCipher([]byte("kiramopay-webhook-secret\x00" + cfg.JWT.Secret))
	b2bRepo := b2b.NewRepository(pool)
	b2bService := b2b.NewService(b2bRepo, b2bCipher, auditLogger, logger)
	escrowRepo := escrow.NewRepository(pool)
	escrowService := escrow.NewService(escrowRepo, ledgerEngine, &escrow.Options{
		MFA:         mfaSvc,
		UIF:         uifService,
		Events:      b2bService, // escrow lifecycle → merchant webhooks
		History:     txService,  // fund/release/refund visible in tx history
		AuditLogger: auditLogger,
	})
	// Payouts — ledger-backed outbound payments over pluggable rails. Only the
	// deterministic mock rail is registered today; real rails (SINPE
	// participant, dLocal, Circle/USDC) are added by registering an adapter and
	// seeding its SYSTEM:EXTERNAL:<RAIL>:<CUR> accounts.
	payoutRegistry := payout.NewRegistry()
	// The mock rail debits the user's real wallet but never actually disburses,
	// so it must NEVER be reachable in production. Only register it outside
	// production; with an empty registry in prod the payout routes reject every
	// request (Service.Create validates the rail is registered) until a real
	// rail (SINPE participant / dLocal / Circle) is wired.
	if cfg.Server.Environment != "production" {
		if err := payoutRegistry.Register(payout.NewMockRail()); err != nil {
			log.Fatalf("register mock payout rail: %v", err)
		}
	} else {
		log.Println("payout: no real rail configured for production — payout endpoints will reject requests")
	}
	payoutRepo := payout.NewRepository(pool)
	payoutService := payout.NewService(payoutRepo, ledgerEngine, payoutRegistry, &payout.Options{
		MFA:         mfaSvc,
		UIF:         uifService,
		Events:      b2bService, // payout lifecycle → merchant webhooks
		History:     txService,  // payout_sent / payout_refund visible in tx history
		AuditLogger: auditLogger,
		Logger:      logger,
	})
	paymentService := payment.NewService(paymentRepo, txService)
	cryptoService := crypto.NewService(cryptoRepo, priceService, txService)

	marketplaceService := marketplace.NewService(marketplaceRepo)
	loyaltyService := loyalty.NewService(loyaltyRepo)
	qrService := qrpayment.NewService(qrRepo, txService)
	splitService := splitpay.NewService(splitRepo, txService)
	cardsService := cards.NewService(cardsRepo)
	fraudService := fraud.NewService(fraudRepo)
	countryService := country.NewService(countryRepo)
	budgetService := budget.NewService(budgetRepo)
	recurringService := recurring.NewService(recurringRepo)
	savingsService := savings.NewService(savingsRepo, ledgerEngine, txService)

	// Conversational assistant. The LLM stays a true nil interface when no
	// provider key is set, so the service reports itself unavailable instead of
	// wrapping a nil pointer. Claude (Anthropic) takes precedence over Gemini
	// when both keys are present.
	var assistantLLM assistant.LLM
	switch {
	case cfg.Anthropic.APIKey != "":
		assistantLLM = assistant.NewClaudeClient(cfg.Anthropic.APIKey, cfg.Anthropic.Model, 20*time.Second)
	case cfg.Gemini.APIKey != "":
		assistantLLM = assistant.NewGeminiClient(cfg.Gemini.APIKey, cfg.Gemini.Model, 20*time.Second)
	}
	assistantService := assistant.NewService(
		assistantLLM,
		assistant.NewTools(walletService, txService, budgetService, paymentService),
		auditLogger,
		logger,
	)

	// ── Handlers ─────────────────────────────────────────────────────────
	// Mark the session cookie Secure (and use the __Host- name) outside of local
	// development, where the API is served over HTTPS.
	authHandler := auth.NewHandler(authService, auth.CookieConfig{
		Secure: cfg.Server.Environment != "development",
	})
	userHandler := user.NewHandler(userService)
	walletHandler := wallet.NewHandler(walletService)
	txHandler := transaction.NewHandler(txService)
	sinpeHandler := sinpe.NewHandler(sinpeService)
	paymentHandler := payment.NewHandler(paymentService)
	cryptoHandler := crypto.NewHandler(cryptoService)
	mfaHandler := mfa.NewHandler(mfaSvc)
	escrowHandler := escrow.NewHandler(escrowService)
	payoutHandler := payout.NewHandler(payoutService)
	assistantHandler := assistant.NewHandler(assistantService)
	b2bHandler := b2b.NewHandler(b2bService)
	kycHandler := kyc.NewHandler(kycService)
	uifHandler := uif.NewHandler(uifService)
	transparencyHandler := transparency.NewHandler(pool)

	marketplaceHandler := marketplace.NewHandler(marketplaceService)
	loyaltyHandler := loyalty.NewHandler(loyaltyService)
	qrHandler := qrpayment.NewHandler(qrService)
	splitHandler := splitpay.NewHandler(splitService)
	cardsHandler := cards.NewHandler(cardsService)
	fraudHandler := fraud.NewHandler(fraudService)
	countryHandler := country.NewHandler(countryService)
	budgetHandler := budget.NewHandler(budgetService)
	recurringHandler := recurring.NewHandler(recurringService)
	savingsHandler := savings.NewHandler(savingsService)

	// ── WebSocket + price broadcaster ────────────────────────────────────
	wsHub := ws.NewHub(logger)
	go wsHub.Run()
	broadcaster := ws.NewPriceBroadcaster(wsHub, priceService, logger)
	go broadcaster.Start()

	// ── Notifications ────────────────────────────────────────────────────
	// Wire the hub so SendToUser also fans out live over /ws/notifications, in
	// addition to web-push delivery and history persistence.
	notifService.SetBroadcaster(wsHub)
	notifHandler := notification.NewHandler(notifService)

	// ── Reconciliation worker ────────────────────────────────────────────
	// Auto-fix snaps the wallets cache to the journal (source of truth) under
	// the same row lock the ledger uses. Drift above 1,000,000 CRC is alerted
	// but left for manual review — a gap that large signals a deeper bug.
	// Each periodic pass runs under a cluster-wide advisory lock so only one
	// instance surveys every wallet when the API is scaled horizontally.
	reconcileSvc := reconcile.NewService(pool, auditLogger, 1*time.Hour, logger,
		reconcile.WithAutoFix(100_000_000))
	reconcileCtx, reconcileCancel := context.WithCancel(context.Background())
	defer reconcileCancel()
	go reconcileSvc.Run(reconcileCtx)

	// ── Webhook dispatcher ───────────────────────────────────────────────
	webhookDispatcher := b2b.NewDispatcher(b2bRepo, b2bCipher, 15*time.Second, logger)
	dispatcherCtx, dispatcherCancel := context.WithCancel(context.Background())
	defer dispatcherCancel()
	go webhookDispatcher.Run(dispatcherCtx)

	// ── Payout settlement poller ─────────────────────────────────────────
	// Reconciles processing payouts against their rail: drives async
	// settlements to terminal and self-heals any payout that crashed between
	// its debit and its Send (Rail.Send is idempotent, so re-dispatch is safe).
	// Each tick runs under a cluster-wide advisory lock so only one instance
	// re-dispatches a batch when the API is scaled horizontally.
	payoutPoller := payout.NewPoller(payoutService, pool, 30*time.Second, logger)
	payoutPollerCtx, payoutPollerCancel := context.WithCancel(context.Background())
	defer payoutPollerCancel()
	go payoutPoller.Run(payoutPollerCtx)

	// ── Escrow settlement poller ─────────────────────────────────────────
	// Re-drives any escrow agreement left in a terminal state with funds stuck
	// in SYSTEM:ESCROW (release/refund posting failed and its revert also
	// failed). Re-posting is idempotent, so a settled agreement is a no-op.
	// Each tick runs under a cluster-wide advisory lock so only one instance
	// re-drives a batch when the API is scaled horizontally.
	escrowPoller := escrow.NewPoller(escrowService, pool, 60*time.Second, logger)
	escrowPollerCtx, escrowPollerCancel := context.WithCancel(context.Background())
	defer escrowPollerCancel()
	go escrowPoller.Run(escrowPollerCtx)

	// Router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(middleware.OtelRouteTag) // refine the otelhttp span name to the chi route
	r.Use(middleware.RequestTimeout(30 * time.Second))
	r.Use(middleware.Logger)
	r.Use(chimw.Recoverer)
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.BodyLimit(1 << 20)) // 1MB
	r.Use(middleware.RateLimit(redisClient, 100, time.Minute))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORS.Origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Kiramopay-Dev"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		dbOk := "ok"
		if err := pool.Ping(r.Context()); err != nil {
			dbOk = "error"
		}
		redisOk := "ok"
		if err := redisClient.Ping(r.Context()).Err(); err != nil {
			redisOk = "error"
		}
		status := "ok"
		httpStatus := http.StatusOK
		if dbOk != "ok" || redisOk != "ok" {
			status = "degraded"
			httpStatus = http.StatusServiceUnavailable
		}
		w.WriteHeader(httpStatus)
		fmt.Fprintf(w, `{"status":%q,"version":"1.0.0","environment":%q,"services":{"database":%q,"redis":%q},"websocket_clients":%d,"last_drift_crc":%d}`,
			status, cfg.Server.Environment, dbOk, redisOk, wsHub.ClientCount(), reconcileSvc.LastDriftCRC())
	})

	// /metrics exposes internal counters (incl. ledger drift). Optionally gate it
	// behind METRICS_TOKEN; left open when unset so Prometheus scraping works
	// out of the box.
	r.Get("/metrics", metricsAuth(os.Getenv("METRICS_TOKEN"), middleware.MetricsHandler))
	r.Get("/api/docs", docs.ServeSwaggerUI)
	r.Get("/api/docs/openapi.yaml", docs.ServeOpenAPISpec)

	r.Get("/ws/prices", func(w http.ResponseWriter, r *http.Request) {
		ws.ServeWs(wsHub, logger, w, r)
	})

	// Per-user real-time channel. The client authenticates over the socket with
	// its access token (validated + session-checked like the REST API); the
	// notification service then fans deliveries here via the hub.
	r.Get("/ws/notifications", func(w http.ResponseWriter, r *http.Request) {
		ws.ServeWsAuthenticated(wsHub, logger, jwtManager, authRepo, w, r)
	})

	r.Route("/api/v1", func(r chi.Router) {
		// ─────────────────────────────────────────────────────────────
		// Public + transparency
		// ─────────────────────────────────────────────────────────────
		r.Group(func(r chi.Router) {
			// Public data
			r.Get("/crypto/prices", cryptoHandler.GetPrices)
			r.Get("/countries", countryHandler.GetCountries)
			r.Get("/exchange-rates", countryHandler.GetExchangeRates)

			// Public transparency endpoints
			r.Get("/transparency/proof-of-reserves", transparencyHandler.ProofOfReserves)
			r.Get("/transparency/fees", transparencyHandler.Fees)
		})

		// ─────────────────────────────────────────────────────────────
		// Auth endpoints — tighter rate limit, lockout for login.
		// ─────────────────────────────────────────────────────────────
		r.Group(func(r chi.Router) {
			// 20/min/IP for /auth/* — headroom for the per-load cookie refresh
			// on boot; brute-force is bounded separately by the per-account
			// lockout below (5 failed logins).
			r.Use(middleware.RateLimit(redisClient, 20, time.Minute))
			r.With(middleware.AccountLockoutCheck(lockoutStore, 5)).
				Post("/auth/login", authHandler.Login)
			r.Post("/auth/register", authHandler.Register)
			r.Post("/auth/refresh", authHandler.RefreshToken)
			r.Post("/auth/forgot-password", authHandler.ForgotPassword)
			r.Post("/auth/reset-password", authHandler.ResetPassword)
		})

		// ─────────────────────────────────────────────────────────────
		// Protected routes
		// ─────────────────────────────────────────────────────────────
		r.Group(func(r chi.Router) {
			r.Use(middleware.AuthWithSessionCheck(jwtManager, authRepo))
			r.Use(middleware.UserRateLimit(redisClient, 200, time.Minute))

			// Auth
			r.Post("/auth/logout", authHandler.Logout)
			r.Post("/auth/change-password", authHandler.ChangePassword)

			// MFA
			r.Post("/mfa/issue", mfaHandler.Issue)
			r.Post("/mfa/verify", mfaHandler.Verify)
			// MFA — TOTP authenticator app
			r.Get("/mfa/totp/status", mfaHandler.TOTPStatus)
			r.Post("/mfa/totp/enroll", mfaHandler.TOTPEnroll)
			r.Post("/mfa/totp/confirm", mfaHandler.TOTPConfirm)
			r.Post("/mfa/totp/verify", mfaHandler.TOTPVerify)
			r.Post("/mfa/totp/disable", mfaHandler.TOTPDisable)

			// User
			r.Get("/users/me", userHandler.GetProfile)
			r.Patch("/users/me", userHandler.UpdateProfile)

			// KYC
			r.Get("/kyc/status", kycHandler.GetStatus)
			r.Post("/kyc/submit", kycHandler.Submit)

			// Wallet
			r.Get("/wallets/me", walletHandler.GetWallet)
			r.Get("/wallets/me/balance", walletHandler.GetBalance)

			// Transactions
			r.Post("/transactions", txHandler.Create)
			r.Get("/transactions", txHandler.List)
			r.Get("/transactions/{id}", txHandler.Get)

			// B2B platform management (API keys + webhooks)
			r.Post("/b2b/keys", b2bHandler.CreateKey)
			r.Get("/b2b/keys", b2bHandler.ListKeys)
			r.Delete("/b2b/keys/{id}", b2bHandler.RevokeKey)
			r.Post("/b2b/webhooks", b2bHandler.CreateWebhook)
			r.Get("/b2b/webhooks", b2bHandler.ListWebhooks)
			r.Delete("/b2b/webhooks/{id}", b2bHandler.DeleteWebhook)
			r.Get("/b2b/webhooks/{id}/deliveries", b2bHandler.ListDeliveries)

			// Escrow
			r.Post("/escrow", escrowHandler.Create)
			r.Get("/escrow", escrowHandler.List)
			r.Get("/escrow/{id}", escrowHandler.Get)
			r.Post("/escrow/{id}/fund", escrowHandler.Fund)
			r.Post("/escrow/{id}/release", escrowHandler.Release)
			r.Post("/escrow/{id}/refund", escrowHandler.Refund)
			r.Post("/escrow/{id}/dispute", escrowHandler.Dispute)
			r.Post("/escrow/{id}/cancel", escrowHandler.Cancel)

			// Conversational assistant (read-only).
			r.Get("/assistant/status", assistantHandler.Status)
			r.Post("/assistant/chat", assistantHandler.Chat)

			// Payouts — ledger-backed outbound payments over pluggable rails.
			r.Get("/payouts/rails", payoutHandler.Rails)
			r.Post("/payouts", payoutHandler.Create)
			r.Get("/payouts", payoutHandler.List)
			r.Get("/payouts/{id}", payoutHandler.Get)
			r.Post("/payouts/{id}/refresh", payoutHandler.Refresh)

			// SINPE
			r.Get("/sinpe/contacts", sinpeHandler.GetContacts)
			r.Post("/sinpe/contacts", sinpeHandler.AddContact)
			r.Get("/sinpe/history", sinpeHandler.GetHistory)
			r.Post("/sinpe/send", sinpeHandler.Send)

			// Services & Payments
			r.Post("/services/pay-bill", paymentHandler.PayBill)
			r.Post("/services/recharge", paymentHandler.Recharge)
			r.Get("/services/saved", paymentHandler.GetSavedServices)
			r.Post("/services/saved", paymentHandler.AddSavedService)
			r.Get("/services/history", paymentHandler.GetPaymentHistory)

			// Crypto
			r.Get("/crypto/assets", cryptoHandler.GetAssets)
			r.Get("/crypto/transactions", cryptoHandler.GetTransactions)
			r.Post("/crypto/buy", cryptoHandler.Buy)
			r.Post("/crypto/sell", cryptoHandler.Sell)
			r.Post("/crypto/convert", cryptoHandler.Convert)
			r.Get("/crypto/staking", cryptoHandler.GetStakingPositions)
			r.Post("/crypto/staking", cryptoHandler.Stake)
			r.Delete("/crypto/staking/{id}", cryptoHandler.Unstake)
			r.Get("/crypto/alerts", cryptoHandler.GetPriceAlerts)
			r.Post("/crypto/alerts", cryptoHandler.AddPriceAlert)
			r.Delete("/crypto/alerts/{id}", cryptoHandler.RemovePriceAlert)

			// Marketplace
			r.Get("/marketplace/partners", marketplaceHandler.GetPartners)
			r.Post("/marketplace/connect", marketplaceHandler.ConnectPartner)
			r.Delete("/marketplace/connect/{code}", marketplaceHandler.DisconnectPartner)
			r.Post("/marketplace/rides", marketplaceHandler.CreateRideRequest)
			r.Get("/marketplace/rides", marketplaceHandler.ListRides)
			r.Get("/marketplace/rides/{id}", marketplaceHandler.GetRideRequest)
			r.Patch("/marketplace/rides/{id}", marketplaceHandler.UpdateRideStatus)
			r.Post("/marketplace/food-orders", marketplaceHandler.CreateFoodOrder)
			r.Get("/marketplace/food-orders", marketplaceHandler.ListFoodOrders)
			r.Get("/marketplace/food-orders/{id}", marketplaceHandler.GetFoodOrder)
			r.Patch("/marketplace/food-orders/{id}", marketplaceHandler.UpdateFoodOrderStatus)

			// Loyalty
			r.Get("/loyalty/account", loyaltyHandler.GetAccount)
			r.Get("/loyalty/transactions", loyaltyHandler.GetTransactions)
			r.Post("/loyalty/earn", loyaltyHandler.EarnPoints)
			r.Get("/loyalty/rewards", loyaltyHandler.GetRewards)
			r.Post("/loyalty/redeem", loyaltyHandler.RedeemReward)
			r.Get("/loyalty/redemptions", loyaltyHandler.GetRedemptions)
			r.Get("/loyalty/cashback-rules", loyaltyHandler.GetCashbackRules)

			// QR
			r.Post("/qr/merchant", qrHandler.RegisterMerchant)
			r.Get("/qr/merchants", qrHandler.GetMerchants)
			r.Post("/qr/codes", qrHandler.CreateQRCode)
			r.Get("/qr/codes", qrHandler.GetUserQRCodes)
			r.Post("/qr/pay", qrHandler.ScanAndPay)
			r.Get("/qr/history", qrHandler.GetPaymentHistory)

			// Splits
			r.Post("/splits", splitHandler.CreateSplit)
			r.Get("/splits", splitHandler.ListSplits)
			r.Get("/splits/{id}", splitHandler.GetSplit)
			r.Post("/splits/{id}/pay", splitHandler.PayShare)
			r.Post("/splits/{id}/decline", splitHandler.DeclineShare)
			r.Delete("/splits/{id}", splitHandler.CancelSplit)

			// Cards
			r.Post("/cards", cardsHandler.CreateCard)
			r.Get("/cards", cardsHandler.GetCards)
			r.Get("/cards/{id}", cardsHandler.GetCard)
			r.Post("/cards/{id}/freeze", cardsHandler.FreezeCard)
			r.Delete("/cards/{id}", cardsHandler.CancelCard)
			r.Patch("/cards/{id}/limits", cardsHandler.UpdateLimits)
			r.Get("/cards/{id}/transactions", cardsHandler.GetCardTransactions)

			// Fraud
			r.Get("/fraud/profile", fraudHandler.GetRiskProfile)
			r.Get("/fraud/assessments", fraudHandler.GetUserAssessments)
			r.Post("/fraud/assess", fraudHandler.AssessTransaction)

			// Country
			r.Get("/country/wallets", countryHandler.GetUserWallets)
			r.Post("/country/wallets/{code}", countryHandler.CreateWallet)
			r.Post("/country/convert", countryHandler.ConvertCurrency)
			r.Post("/country/transfer", countryHandler.SendCrossBorder)
			r.Get("/country/transfers", countryHandler.GetTransferHistory)
			r.Get("/country/transfers/{id}", countryHandler.GetTransfer)

			// Push
			r.Post("/push/subscribe", notifHandler.Subscribe)
			r.Delete("/push/unsubscribe", notifHandler.Unsubscribe)
			r.Get("/notifications", notifHandler.ListNotifications)
			r.Patch("/notifications/{id}/read", notifHandler.MarkRead)
			r.Post("/notifications/read-all", notifHandler.MarkAllRead)

			// Budgets
			r.Get("/budgets", budgetHandler.List)
			r.Post("/budgets", budgetHandler.Create)
			r.Patch("/budgets/{id}", budgetHandler.Update)
			r.Delete("/budgets/{id}", budgetHandler.Delete)
			r.Post("/budgets/reset", budgetHandler.ResetAll)

			// Recurring
			r.Get("/recurring", recurringHandler.List)
			r.Post("/recurring", recurringHandler.Create)
			r.Patch("/recurring/{id}", recurringHandler.Update)
			r.Delete("/recurring/{id}", recurringHandler.Delete)
			r.Post("/recurring/{id}/toggle", recurringHandler.Toggle)
			r.Post("/recurring/{id}/mark-paid", recurringHandler.MarkPaid)

			// Savings goals (deposit/withdraw move money via the ledger)
			r.Get("/savings/goals", savingsHandler.List)
			r.Post("/savings/goals", savingsHandler.Create)
			r.Delete("/savings/goals/{id}", savingsHandler.Delete)
			r.Post("/savings/goals/{id}/deposit", savingsHandler.Deposit)
			r.Post("/savings/goals/{id}/withdraw", savingsHandler.Withdraw)

			// ─────────────────────────────────────────────────────────
			// Admin-only routes — gated on role = 'admin'.
			// ─────────────────────────────────────────────────────────
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin(userRepo))

				// KYC review
				r.Post("/admin/kyc/{id}/decision", kycHandler.Decide)

				// Merchant verification (light KYC review)
				r.Get("/admin/merchants/pending", qrHandler.ListPendingMerchants)
				r.Post("/admin/merchants/{id}/approve", qrHandler.ApproveMerchant)
				r.Post("/admin/merchants/{id}/reject", qrHandler.RejectMerchant)
				r.Patch("/admin/merchants/{id}/commission", qrHandler.SetCommission)

				// UIF / AML reporting queue
				r.Get("/admin/uif/reports", uifHandler.ListReports)
				r.Post("/admin/uif/reports/{id}/review", uifHandler.Review)

				// Fraud
				r.Post("/admin/escrow/{id}/resolve", escrowHandler.Resolve)

				r.Get("/admin/fraud/alerts", fraudHandler.GetOpenAlerts)
				r.Patch("/admin/fraud/alerts/{id}", fraudHandler.ResolveAlert)
				r.Post("/admin/fraud/restrict/{userId}", fraudHandler.RestrictUser)

				// Reconciliation on-demand
				r.Post("/admin/reconcile", func(w http.ResponseWriter, r *http.Request) {
					rpt, err := reconcileSvc.RunOnce(r.Context())
					if err != nil {
						http.Error(w, err.Error(), http.StatusInternalServerError)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					fmt.Fprintf(w, `{"wallets_total":%d,"wallets_bad":%d,"drift_crc":%d,"drift_usd":%d,"duration_ms":%d}`,
						rpt.WalletsTotal, rpt.WalletsBad, rpt.DriftCRC, rpt.DriftUSD,
						rpt.FinishedAt.Sub(rpt.StartedAt).Milliseconds())
				})
			})
		})
	})

	// ─────────────────────────────────────────────────────────────────────
	// Merchant API (B2B) — authenticated by API key, not JWT. The middleware
	// injects the key's owning user into the same context slot the JWT auth
	// uses, so the domain handlers work unchanged.
	// ─────────────────────────────────────────────────────────────────────
	r.Route("/api/b2b/v1", func(r chi.Router) {
		r.Use(b2b.APIKeyAuth(b2bService))
		r.Use(middleware.UserRateLimit(redisClient, 300, time.Minute))

		r.Get("/ping", b2bHandler.Ping)

		// Escrow, programmatic — read vs write gated by the key's scopes.
		r.Group(func(r chi.Router) {
			r.Use(b2b.RequireScope(b2b.ScopeEscrowRead))
			r.Get("/escrow", escrowHandler.List)
			r.Get("/escrow/{id}", escrowHandler.Get)
		})
		r.Group(func(r chi.Router) {
			r.Use(b2b.RequireScope(b2b.ScopeEscrowWrite))
			r.Post("/escrow", escrowHandler.Create)
			r.Post("/escrow/{id}/fund", escrowHandler.Fund)
			r.Post("/escrow/{id}/release", escrowHandler.Release)
			r.Post("/escrow/{id}/refund", escrowHandler.Refund)
			r.Post("/escrow/{id}/dispute", escrowHandler.Dispute)
			r.Post("/escrow/{id}/cancel", escrowHandler.Cancel)
		})

		// Payouts, programmatic — read vs write gated by the key's scopes.
		r.Group(func(r chi.Router) {
			r.Use(b2b.RequireScope(b2b.ScopePayoutRead))
			r.Get("/payouts", payoutHandler.List)
			r.Get("/payouts/{id}", payoutHandler.Get)
		})
		r.Group(func(r chi.Router) {
			r.Use(b2b.RequireScope(b2b.ScopePayoutWrite))
			r.Post("/payouts", payoutHandler.Create)
			r.Post("/payouts/{id}/refresh", payoutHandler.Refresh)
		})
	})

	// Wrap the router so every request gets a server span with W3C context
	// propagation. The OtelRouteTag middleware (added in the chi stack) refines
	// the span name to the matched route pattern (low cardinality).
	otelHandler := otelhttp.NewHandler(r, "http.server",
		otelhttp.WithSpanNameFormatter(func(_ string, req *http.Request) string {
			return req.Method
		}),
	)

	srv := &http.Server{
		Addr:           fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:        otelHandler,
		ReadTimeout:    cfg.Server.ReadTimeout,
		WriteTimeout:   cfg.Server.WriteTimeout,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	go func() {
		log.Printf("KiramoPay API starting on port %d (%s)", cfg.Server.Port, cfg.Server.Environment)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	broadcaster.Stop()
	reconcileCancel()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("Server stopped")
}
