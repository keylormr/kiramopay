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

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/cards"
	"github.com/kiramopay/backend/internal/config"
	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/database"
	"github.com/kiramopay/backend/internal/docs"
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
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/reconcile"
	"github.com/kiramopay/backend/internal/recurring"
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

func main() {
	cfg := config.Load()
	if err := cfg.ValidateForProduction(); err != nil {
		log.Fatalf("Config validation failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// ── Tracing (OpenTelemetry) ──────────────────────────────────────────
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
		if err := database.SeedDevelopment(context.Background(), pool); err != nil {
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
		// JWT_SECRET (already required to be a real 32+ byte value in prod).
		TOTPEncryptionKey: []byte(cfg.JWT.Secret),
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

	// ── Services ─────────────────────────────────────────────────────────
	kycService := kyc.NewService(kycRepo, &kyc.Options{AuditLogger: auditLogger})
	uifService := uif.NewService(uifRepo, &uif.Options{AuditLogger: auditLogger})
	authService := auth.NewService(authRepo, userRepo, walletRepo, jwtManager, &auth.Options{
		LockoutStore:     lockoutStore,
		AuditLogger:      auditLogger,
		Screener:         kycService,
		MaxLoginAttempts: 5,
	})
	userService := user.NewService(userRepo)
	walletService := wallet.NewService(walletRepo)
	txService := transaction.NewService(txRepo, walletRepo, ledgerEngine, &transaction.Options{
		AuditLogger: auditLogger,
		MFA:         mfaSvc,
		UIF:         uifService,
	})
	sinpeService := sinpe.NewService(sinpeRepo, txService, walletRepo, userRepo, &sinpe.Options{
		AuditLogger: auditLogger,
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

	// ── Handlers ─────────────────────────────────────────────────────────
	authHandler := auth.NewHandler(authService)
	userHandler := user.NewHandler(userService)
	walletHandler := wallet.NewHandler(walletService)
	txHandler := transaction.NewHandler(txService)
	sinpeHandler := sinpe.NewHandler(sinpeService)
	paymentHandler := payment.NewHandler(paymentService)
	cryptoHandler := crypto.NewHandler(cryptoService)
	mfaHandler := mfa.NewHandler(mfaSvc)
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

	// ── WebSocket + price broadcaster ────────────────────────────────────
	wsHub := ws.NewHub(logger)
	go wsHub.Run()
	broadcaster := ws.NewPriceBroadcaster(wsHub, priceService, logger)
	go broadcaster.Start()

	// ── Notifications ────────────────────────────────────────────────────
	notifRepo := notification.NewRepository(pool)
	notifService := notification.NewService(notifRepo, cfg.VAPID.PublicKey, cfg.VAPID.PrivateKey)
	notifHandler := notification.NewHandler(notifService)

	// ── Reconciliation worker ────────────────────────────────────────────
	// Auto-fix snaps the wallets cache to the journal (source of truth) under
	// the same row lock the ledger uses. Drift above 1,000,000 CRC is alerted
	// but left for manual review — a gap that large signals a deeper bug.
	reconcileSvc := reconcile.NewService(pool, auditLogger, 1*time.Hour, logger,
		reconcile.WithAutoFix(100_000_000))
	reconcileCtx, reconcileCancel := context.WithCancel(context.Background())
	defer reconcileCancel()
	go reconcileSvc.Run(reconcileCtx)

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

	r.Get("/metrics", middleware.MetricsHandler)
	r.Get("/api/docs", docs.ServeSwaggerUI)
	r.Get("/api/docs/openapi.yaml", docs.ServeOpenAPISpec)

	r.Get("/ws/prices", func(w http.ResponseWriter, r *http.Request) {
		ws.ServeWs(wsHub, logger, w, r)
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
			r.Use(middleware.RateLimit(redisClient, 10, time.Minute)) // 10/min/IP for /auth/*
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
			r.Get("/qr/merchant", qrHandler.GetMerchant)
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

			// ─────────────────────────────────────────────────────────
			// Admin-only routes — gated on role = 'admin'.
			// ─────────────────────────────────────────────────────────
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin(userRepo))

				// KYC review
				r.Post("/admin/kyc/{id}/decision", kycHandler.Decide)

				// UIF / AML reporting queue
				r.Get("/admin/uif/reports", uifHandler.ListReports)
				r.Post("/admin/uif/reports/{id}/review", uifHandler.Review)

				// Fraud
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
