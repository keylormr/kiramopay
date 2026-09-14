package sinpe_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
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
	contact, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC", false)
	if err != nil {
		t.Fatalf("AddContact() error: %v", err)
	}
	if contact.Name != "Maria Lopez" || contact.Phone != "+50688885678" {
		t.Fatalf("unexpected contact %+v", contact)
	}
}

// El "Marcar como favorito" del formulario se perdía en silencio: el POST
// nunca lo mandaba y el INSERT tampoco lo guardaba, así que is_favorite
// quedaba siempre en su default (false) sin importar lo que eligiera el
// usuario.
func TestAddContact_Favorite(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()

	contact, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC", true)
	if err != nil {
		t.Fatalf("AddContact() error: %v", err)
	}
	if !contact.IsFav {
		t.Fatalf("contact.IsFav = false, se esperaba true (recien creado como favorito)")
	}

	contacts, err := svc.GetContacts(ctx, userID)
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 1 || !contacts[0].IsFav {
		t.Fatalf("contactos tras GetContacts = %+v, se esperaba is_favorite=true persistido", contacts)
	}
}

// Agregar un contacto que ya existe se RECHAZA en vez de pisarlo en silencio
// (el ON CONFLICT ... DO UPDATE de antes). El pedido del dueno: si el telefono
// ya esta guardado, avisar y devolver el contacto tal como esta, no la version
// nueva que se intento guardar encima.
func TestAddContact_Duplicate(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	if _, err := svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC", false); err != nil {
		t.Fatalf("first AddContact: %v", err)
	}

	_, err := svc.AddContact(ctx, userID, "+50688885678", "Maria L.", "BCR", false)
	if err == nil {
		t.Fatal("se esperaba un rechazo por contacto duplicado")
	}
	if !errors.Is(err, sinpe.ErrContactExists) {
		t.Fatalf("error = %v, se esperaba ErrContactExists", err)
	}
	var exists *sinpe.ContactExistsError
	if !errors.As(err, &exists) {
		t.Fatalf("error = %v, se esperaba *sinpe.ContactExistsError", err)
	}
	if exists.Existing == nil || exists.Existing.Name != "Maria Lopez" || exists.Existing.Bank != "BAC" {
		t.Fatalf("contacto existente = %+v, se esperaba el original sin pisar", exists.Existing)
	}

	// Y en la base el contacto de verdad no cambio.
	contacts, err := svc.GetContacts(ctx, userID)
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 1 || contacts[0].Name != "Maria Lopez" || contacts[0].Bank != "BAC" {
		t.Fatalf("el contacto guardado cambio: %+v", contacts)
	}
}

// El HTTP handler traduce el rechazo a 409 CONTACT_EXISTS con el contacto
// existente en `data`, para que el cliente lo muestre en vez de adivinar.
func TestHandlerAddContact_Conflict(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	h := sinpe.NewHandler(svc)

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/contacts", strings.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
		rec := httptest.NewRecorder()
		h.AddContact(rec, req)
		return rec
	}

	first := post(`{"phone":"+50688885678","name":"Maria Lopez","bank":"BAC"}`)
	if first.Code != http.StatusCreated {
		t.Fatalf("primera alta = %d, se esperaba 201: %s", first.Code, first.Body.String())
	}

	second := post(`{"phone":"+50688885678","name":"Maria L.","bank":"BCR"}`)
	if second.Code != http.StatusConflict {
		t.Fatalf("segunda alta = %d, se esperaba 409: %s", second.Code, second.Body.String())
	}

	var env struct {
		Success bool `json:"success"`
		Error   struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Data struct {
			Name string `json:"name"`
			Bank string `json:"bank"`
		} `json:"data"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Success {
		t.Fatal("se esperaba success:false en el 409")
	}
	if env.Error.Code != "CONTACT_EXISTS" {
		t.Fatalf("codigo = %q, se esperaba CONTACT_EXISTS", env.Error.Code)
	}
	if env.Data.Name != "Maria Lopez" || env.Data.Bank != "BAC" {
		t.Fatalf("data del 409 = %+v, se esperaba el contacto original sin pisar", env.Data)
	}
}

func TestGetContacts_Success(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()
	_, _ = svc.AddContact(ctx, userID, "+50688885678", "Maria Lopez", "BAC", false)
	_, _ = svc.AddContact(ctx, userID, "+50688889999", "Carlos Perez", "BCR", false)
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

// Un telefono mal formado (no son 8 digitos de movil CR) se rechaza con su
// propio codigo (INVALID_PHONE), no con el generico SINPE_FAILED: el cliente
// necesita distinguirlo para mostrar un mensaje traducido en vez del ingles
// crudo que devolvia antes fmt.Errorf.
func TestSend_TelefonoInvalido_Rechazado(t *testing.T) {
	svc, userID, _ := setupSinpeService(t)
	ctx := context.Background()

	_, err := svc.Send(ctx, userID, &sinpe.SendRequest{
		// Lo que mandaba el frontend cuando el campo manual recortaba con
		// slice(0,8) en vez de slice(-8): "+50688880005" tecleado terminaba
		// en "50688880" (le faltan los ultimos digitos reales, le sobran los
		// del prefijo "506"), y normalizarTelefonoCR lo volvia a anteponer.
		Phone:  "+50650688880",
		Amount: 1000000,
	}, "")
	if err == nil {
		t.Fatal("se acepto un envio con telefono invalido")
	}
	if !errors.Is(err, sinpe.ErrInvalidPhone) {
		t.Fatalf("error = %v, se esperaba ErrInvalidPhone (el handler lo mapea a INVALID_PHONE)", err)
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
