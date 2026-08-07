package sinpe_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/sinpe"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupSinpeService(t *testing.T) (*sinpe.Service, string, *pgxpool.Pool) {
	t.Helper()
	pool := testutil.TestDB(t)

	sinpeRepo := sinpe.NewRepository(pool)
	txRepo := transaction.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	userRepo := user.NewRepository(pool)

	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txService := transaction.NewService(txRepo, walletRepo, l, nil)
	svc := sinpe.NewService(sinpeRepo, txService, walletRepo, userRepo, nil)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	// El destinatario que usan las pruebas, +50688885678, tiene que existir como
	// usuario: desde que se rechazan los envios a no-usuarios, un telefono sin
	// cuenta ya no produce una transferencia, produce un rechazo.
	testutil.SeedTestUser2(t, pool)

	return svc, userID, pool
}

// telefonoSinCuenta es un movil valido de Costa Rica que NO pertenece a ningun
// usuario sembrado.
const telefonoSinCuenta = "+50677776666"

func TestAddContact_Success(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	contact, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC")
	if err != nil {
		t.Fatalf("AddContact() error: %v", err)
	}
	if contact.Name != "Maria Lopez" || contact.Phone != "+50688885678" {
		t.Fatalf("unexpected contact %+v", contact)
	}
}

func TestAddContact_Duplicate(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC"); err != nil {
		t.Fatalf("first AddContact: %v", err)
	}
	// ON CONFLICT updates name/bank, so this no longer errors. Instead verify
	// idempotent upsert behaviour.
	c2, err := svc.AddContact(ctx, userID, "+50688885678", "Maria L.", "BCR")
	if err != nil {
		t.Fatalf("second AddContact (upsert): %v", err)
	}
	if c2.Name != "Maria L." {
		t.Fatalf("expected name to upsert, got %s", c2.Name)
	}
}

func TestGetContacts_Success(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	_, _ = svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC")
	_, _ = svc.AddContact(ctx, userID, "+50688889999", "Carlos Perez", "BCR")
	contacts, err := svc.GetContacts(ctx, userID)
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 2 {
		t.Fatalf("expected 2 contacts, got %d", len(contacts))
	}
}

func TestSend_Success(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	resp, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:       "+50688885678",
		Amount:      5000000,
		Description: "Test transfer",
	}, "")
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if resp.TransactionID == "" {
		t.Fatal("empty tx id")
	}
}

func TestSend_InsufficientBalance(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:       "+50688885678",
		Amount:      300000000,
		Description: "Too much",
	}, ""); err == nil {
		t.Fatal("expected insufficient-balance error")
	}
}

func TestSend_ToOwnNumber_Rejected(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	// +50688881234 is the phone SeedTestUser assigns to userID. Sending to your
	// own number must be rejected, not silently booked against the external rail.
	_, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:  "+50688881234",
		Amount: 1000000,
	}, "")
	if err == nil {
		t.Fatal("expected self-send to be rejected")
	}
}

// Enviar a un numero que no tiene cuenta se RECHAZA. Entregarlo exigiria el
// riel a otros bancos, que necesita una licencia que no tenemos; aceptar la
// plata y dejarla estacionada sin forma de devolverla es peor que decir que no.
func TestSend_ANoUsuario_SeRechaza(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()

	_, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:  telefonoSinCuenta,
		Amount: 1000000,
	}, "")
	if err == nil {
		t.Fatal("se acepto un envio a un numero sin cuenta")
	}
	if !errors.Is(err, sinpe.ErrRecipientNotUser) {
		t.Fatalf("error = %v, se esperaba ErrRecipientNotUser (el handler lo mapea a su propio codigo)", err)
	}
}

// Y sobre todo: el rechazo no puede haber tocado el dinero. El defecto original
// era justamente que se debitaba sin entregar.
func TestSend_ANoUsuario_NoTocaElSaldo(t *testing.T) {
	svc, userID, pool := setupSinpeService(t)
	ctx := context.Background()

	saldo := func() int64 {
		t.Helper()
		var bal int64
		if err := pool.QueryRow(ctx,
			`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&bal); err != nil {
			t.Fatalf("lectura del saldo: %v", err)
		}
		return bal
	}

	antes := saldo()
	_, _ = svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:  telefonoSinCuenta,
		Amount: 1000000,
	}, "")
	if despues := saldo(); despues != antes {
		t.Fatalf("el saldo cambio de %d a %d: el rechazo debito dinero", antes, despues)
	}
}

// Un envio aceptado sigue reportandose como interno y completado.
func TestSend_AUsuario_EsInternoYCompletado(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()

	resp, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone:  "+50688885678",
		Amount: 1000000,
	}, "")
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !resp.Internal {
		t.Fatal("una transferencia entre usuarios debe reportarse como interna")
	}
	if resp.Status != "completed" {
		t.Fatalf("estado = %q, se esperaba \"completed\"", resp.Status)
	}
	// Sin comision: el movimiento ocurre dentro de nuestro propio libro.
	if resp.Fee != 0 {
		t.Fatalf("comision = %d, se esperaba 0 entre usuarios", resp.Fee)
	}
}

func TestGetHistory_Success(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		Phone: "+50688885678", Amount: 1000000, Description: "Test",
	}, ""); err != nil {
		t.Fatalf("Send: %v", err)
	}
	history, err := svc.GetHistory(ctx, userID)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) < 1 {
		t.Fatal("expected >= 1 history entry")
	}
}
