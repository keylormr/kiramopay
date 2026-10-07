package sinpe_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

// El reintento de un SINPE con la misma llave. La pantalla manda la llave para
// el caso de la red que se corta sin traer la respuesta: el envio pudo haber
// salido, y el reintento tiene que contestar con AQUEL envio, no hacer otro ni
// rechazarlo por algo que el propio envio consumio.

// destinoSinpe es el telefono de SeedTestUser2.
const destinoSinpe = "+50688885678"

const montoSinpe int64 = 1000000 // 10.000 colones

// sinpeConAvisos arma el servicio como setupSinpeService, con un notificador
// a eleccion y devolviendo tambien a quien recibe.
func sinpeConAvisos(t *testing.T, avisos sinpe.Notifier) (*sinpe.Service, string, string, *pgxpool.Pool) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	walletRepo := wallet.NewRepository(pool)
	txService := transaction.NewService(transaction.NewRepository(pool), walletRepo, l, nil)
	svc := sinpe.NewService(sinpe.NewRepository(pool), txService, walletRepo, user.NewRepository(pool),
		&sinpe.Options{Notifier: avisos})
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	emisor := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	receptor := testutil.SeedTestUser2(t, pool)
	return svc, emisor, receptor, pool
}

func enviarSinpe(svc *sinpe.Service, userID string, monto int64, llave string) (*sinpe.SendResponse, error) {
	return svc.Send(context.Background(), userID, &sinpe.SendRequest{
		Phone: destinoSinpe, Amount: monto, IdempotencyKey: llave,
	}, "")
}

// vaciarBilletera simula que, entre el envio y su reintento, la persona gasto
// el resto del saldo en otra cosa.
func vaciarBilletera(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET balance_crc = 0 WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("vaciar la billetera: %v", err)
	}
}

// llenarCupoDelDia simula otros SINPE del dia hasta el tope diario.
func llenarCupoDelDia(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	ctx := context.Background()
	var gastado int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM sinpe_history
		  WHERE user_id = $1::uuid AND type = 'sent' AND status = 'completed'
		    AND created_at::date = CURRENT_DATE`, userID).Scan(&gastado); err != nil {
		t.Fatalf("leer el cupo del dia: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO sinpe_history (user_id, phone, contact_name, amount, type, status)
		 VALUES ($1::uuid, '+50677770000', 'Otro envio', $2, 'sent', 'completed')`,
		userID, sinpe.DailyLimitCRC-gastado); err != nil {
		t.Fatalf("llenar el cupo del dia: %v", err)
	}
}

func filasDeHistorial(t *testing.T, pool *pgxpool.Pool, userID, tipo string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM sinpe_history WHERE user_id = $1::uuid AND type = $2`,
		userID, tipo).Scan(&n); err != nil {
		t.Fatalf("contar el historial: %v", err)
	}
	return n
}

// El envio salio, la respuesta se perdio, y antes del reintento la persona
// gasto el resto del saldo. El reintento recibia "saldo insuficiente" por un
// envio que ya habia salido: la pantalla lo daba por fallido, y quien lo
// repitiera con otra llave mandaba la plata dos veces.
func TestSend_ElReintentoTrasGastarElSaldoDevuelveElMismoEnvio(t *testing.T) {
	svc, emisor, _, pool := sinpeConAvisos(t, nil)
	const llave = "sinpe:reintento:saldo"

	primero, err := enviarSinpe(svc, emisor, montoSinpe, llave)
	if err != nil {
		t.Fatalf("el envio: %v", err)
	}
	vaciarBilletera(t, pool, emisor)

	segundo, err := enviarSinpe(svc, emisor, montoSinpe, llave)
	if err != nil {
		t.Fatalf("el reintento: %v; se esperaba el envio de aquella vez", err)
	}
	if segundo.TransactionID != primero.TransactionID {
		t.Fatalf("el reintento devolvio %s, el envio fue %s", segundo.TransactionID, primero.TransactionID)
	}
}

// Lo mismo con el cupo diario de SINPE: el envio que se reintenta ya esta
// contado en el cupo, asi que con el cupo justo lleno el reintento se
// rechazaba por un tope que el propio envio habia gastado.
func TestSend_ElReintentoConElCupoDelDiaLlenoDevuelveElMismoEnvio(t *testing.T) {
	svc, emisor, _, pool := sinpeConAvisos(t, nil)
	const llave = "sinpe:reintento:cupo"

	primero, err := enviarSinpe(svc, emisor, montoSinpe, llave)
	if err != nil {
		t.Fatalf("el envio: %v", err)
	}
	llenarCupoDelDia(t, pool, emisor)

	segundo, err := enviarSinpe(svc, emisor, montoSinpe, llave)
	if err != nil {
		t.Fatalf("el reintento: %v; se esperaba el envio de aquella vez", err)
	}
	if segundo.TransactionID != primero.TransactionID {
		t.Fatalf("el reintento devolvio %s, el envio fue %s", segundo.TransactionID, primero.TransactionID)
	}
}

// Y el orden de los motivos: la misma llave con otro monto es una llave
// prestada, y eso es lo que se contesta aunque el saldo tampoco alcance. "No
// te alcanza" no se arregla poniendo plata: la llave seguiria siendo de otro
// envio.
func TestSend_LaMismaLlaveConOtroMontoSeRechazaAunqueElSaldoNoAlcance(t *testing.T) {
	svc, emisor, _, pool := sinpeConAvisos(t, nil)
	const llave = "sinpe:otro-monto"

	if _, err := enviarSinpe(svc, emisor, montoSinpe, llave); err != nil {
		t.Fatalf("el envio: %v", err)
	}
	vaciarBilletera(t, pool, emisor)

	_, err := enviarSinpe(svc, emisor, 2*montoSinpe, llave)
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la misma llave con otro monto: err=%v, se esperaba ErrLlaveReutilizada", err)
	}
}

// La repeticion no es otro envio: no escribe otra fila en el historial de
// nadie. La del que envia, ademas, es la que suma el cupo diario: duplicada,
// un corte de red le gastaba el cupo dos veces.
func TestSend_LaRepeticionNoEscribeOtraVezElHistorial(t *testing.T) {
	svc, emisor, receptor, pool := sinpeConAvisos(t, nil)
	const llave = "sinpe:repeticion:historial"

	for i := 0; i < 2; i++ {
		if _, err := enviarSinpe(svc, emisor, montoSinpe, llave); err != nil {
			t.Fatalf("envio %d: %v", i+1, err)
		}
	}
	if got := filasDeHistorial(t, pool, emisor, "sent"); got != 1 {
		t.Fatalf("el historial de quien envia tiene %d filas, se esperaba 1", got)
	}
	if got := filasDeHistorial(t, pool, receptor, "received"); got != 1 {
		t.Fatalf("el historial de quien recibe tiene %d filas, se esperaba 1", got)
	}
}

type avisosContados struct{ llegaron chan string }

func (a *avisosContados) NotifyUser(_ context.Context, userID, _, _, _ string) error {
	a.llegaron <- userID
	return nil
}

// Ni le avisa otra vez a quien recibe: un segundo "Recibiste 10.000" por un
// solo envio le hace creer que le llego dos veces.
func TestSend_LaRepeticionNoAvisaOtraVezAQuienRecibe(t *testing.T) {
	avisos := &avisosContados{llegaron: make(chan string, 4)}
	svc, emisor, receptor, _ := sinpeConAvisos(t, avisos)
	const llave = "sinpe:repeticion:aviso"

	if _, err := enviarSinpe(svc, emisor, montoSinpe, llave); err != nil {
		t.Fatalf("el envio: %v", err)
	}
	select {
	case id := <-avisos.llegaron:
		if id != receptor {
			t.Fatalf("el aviso fue para %s, se esperaba %s", id, receptor)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no llego el aviso del envio")
	}

	if _, err := enviarSinpe(svc, emisor, montoSinpe, llave); err != nil {
		t.Fatalf("la repeticion: %v", err)
	}
	select {
	case <-avisos.llegaron:
		t.Fatal("la repeticion volvio a avisar a quien recibe")
	case <-time.After(1500 * time.Millisecond):
	}
}

// El handler le dice a la pantalla que la llave es de otro envio con un codigo
// propio: es lo unico que le indica que esa llave ya no sirve y que el envio
// nuevo necesita otra. Con el SINPE_FAILED generico no puede distinguirlo de
// un fallo que se arregla reintentando.
func TestHandlerSend_LaMismaLlaveConOtroMontoEs409(t *testing.T) {
	svc, emisor, _, _ := sinpeConAvisos(t, nil)
	h := sinpe.NewHandler(svc)
	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/send", strings.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, emisor))
		rec := httptest.NewRecorder()
		h.Send(rec, req)
		return rec
	}

	if first := post(`{"phone":"+50688885678","amount":1000000,"idempotency_key":"sinpe:handler:llave"}`); first.Code != http.StatusOK {
		t.Fatalf("el envio = %d: %s", first.Code, first.Body.String())
	}
	second := post(`{"phone":"+50688885678","amount":2000000,"idempotency_key":"sinpe:handler:llave"}`)
	if second.Code != http.StatusConflict {
		t.Fatalf("la misma llave con otro monto = %d, se esperaba 409: %s", second.Code, second.Body.String())
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Error.Code != "LLAVE_REUTILIZADA" {
		t.Fatalf("codigo = %q, se esperaba LLAVE_REUTILIZADA", env.Error.Code)
	}
}
