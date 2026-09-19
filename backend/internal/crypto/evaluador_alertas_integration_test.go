package crypto

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/shopspring/decimal"
)

// Pruebas del barrido de alertas contra Postgres: la consulta que marca las
// cumplidas, el candado de cluster real, el tope de activas y el contrato HTTP.
// El precio se siembra en el cache a mano (sembrarPrecio), que es justo lo que
// el barrido lee: ninguna prueba sale a la red.

type montajeAlertas struct {
	pool      *pgxpool.Pool
	repo      *Repository
	ps        *PriceService
	svc       *Service
	ana, beto string
	avisos    *buzon
	evaluador *EvaluadorDeAlertas
}

func montarAlertas(t *testing.T) *montajeAlertas {
	t.Helper()
	pool := testutil.TestDB(t)

	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	// Un simbolo que la prueba no sembro no puede terminar en api.coingecko.com.
	vacio := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	t.Cleanup(vacio.Close)
	ps.SetBaseURL(vacio.URL)
	sembrarPrecio(ps, "BTC", 1000, 0)
	sembrarPrecio(ps, "ETH", 1000, 0)

	repo := NewRepository(pool)
	avisos := &buzon{}
	return &montajeAlertas{
		pool:      pool,
		repo:      repo,
		ps:        ps,
		svc:       NewService(repo, ps, nil, nil, nil),
		ana:       testutil.SeedTestUser(t, pool, "702650930", "sin-uso"),
		beto:      testutil.SeedTestUser2(t, pool),
		avisos:    avisos,
		// Refresco propio apagado: estas pruebas siembran el precio a mano y lo
		// que verifican es la sentencia SQL de CumplirAlertas. El refresco tiene
		// sus propias pruebas en evaluador_alertas_test.go.
		evaluador: NuevoEvaluadorDeAlertas(repo, ps, avisos, pool, time.Minute, 0, silencio),
	}
}

func (m *montajeAlertas) crear(t *testing.T, usuario, activo, direccion, objetivo string) *PriceAlertRecord {
	t.Helper()
	a, err := m.svc.AddPriceAlert(context.Background(), usuario, &CrearAlertaRequest{
		Asset: activo, Direction: direccion, TargetPrice: dec(objetivo),
	})
	if err != nil {
		t.Fatalf("crear %s %s %s: %v", activo, direccion, objetivo, err)
	}
	return a
}

// precio deja un precio vigente en el cache, como si el broadcaster lo acabara
// de traer.
func (m *montajeAlertas) precio(simbolo string, valor float64) {
	sembrarPrecio(m.ps, simbolo, valor, 0)
}

type filaAlerta struct {
	activa   bool
	cumplida *time.Time
	precio   decimal.NullDecimal
	borrada  *time.Time
}

func (m *montajeAlertas) fila(t *testing.T, id string) filaAlerta {
	t.Helper()
	var f filaAlerta
	if err := m.pool.QueryRow(context.Background(),
		`SELECT COALESCE(active, false), cumplida_at, precio_cumplida, borrada_at
		   FROM crypto_price_alerts WHERE id = $1`, id,
	).Scan(&f.activa, &f.cumplida, &f.precio, &f.borrada); err != nil {
		t.Fatalf("leer la alerta %s: %v", id, err)
	}
	return f
}

func (m *montajeAlertas) vuelta(t *testing.T, quiere int) {
	t.Helper()
	if n := m.evaluador.vuelta(context.Background()); n != quiere {
		t.Fatalf("la vuelta cumplio %d alertas, se esperaban %d", n, quiere)
	}
}

func TestEvaluadorDeAlertas_DisparaUnaVezYNoRepite(t *testing.T) {
	m := montarAlertas(t)
	ctx := context.Background()

	arriba := m.crear(t, m.ana, "BTC", "above", "1500")
	abajo := m.crear(t, m.ana, "BTC", "below", "500")
	lejos := m.crear(t, m.ana, "BTC", "above", "3000")
	quitada := m.crear(t, m.ana, "ETH", "above", "1500")
	if err := m.svc.RemovePriceAlert(ctx, m.ana, quitada.ID); err != nil {
		t.Fatalf("quitar: %v", err)
	}

	// Sube: se cumple la de arriba y nada mas. La quitada no, aunque ETH
	// tambien paso su objetivo.
	m.precio("BTC", 2000)
	m.precio("ETH", 2000)
	m.vuelta(t, 1)
	if m.avisos.total() != 1 {
		t.Fatalf("avisos = %+v, se esperaba 1", m.avisos.avisos)
	}
	if av := m.avisos.avisos[0]; av.usuario != m.ana || av.etiqueta != EtiquetaAvisoDeAlerta ||
		av.titulo != "Alerta de precio: BTC" {
		t.Fatalf("aviso = %+v", av)
	}
	if f := m.fila(t, arriba.ID); f.activa || f.cumplida == nil || !f.precio.Valid ||
		!f.precio.Decimal.Equal(dec("2000")) || f.borrada != nil {
		t.Fatalf("la alerta cumplida quedo %+v", f)
	}
	if f := m.fila(t, quitada.ID); f.activa || f.cumplida != nil {
		t.Fatalf("la alerta quitada se cumplio: %+v", f)
	}

	// Mismo precio, otra vuelta: nada nuevo.
	m.vuelta(t, 0)
	if m.avisos.total() != 1 {
		t.Fatalf("la segunda vuelta repitio el aviso: %+v", m.avisos.avisos)
	}

	// Baja: se cumple la de abajo.
	m.precio("BTC", 400)
	m.vuelta(t, 1)
	if m.avisos.total() != 2 || m.avisos.avisos[1].cuerpo != "BTC bajó a tu precio objetivo. Abre KiramoPay para ver el detalle." {
		t.Fatalf("avisos = %+v", m.avisos.avisos)
	}

	// Un precio viejo no decide, aunque pase el objetivo de la que falta.
	sembrarPrecio(m.ps, "BTC", 5000, time.Hour)
	m.vuelta(t, 0)
	if f := m.fila(t, lejos.ID); !f.activa {
		t.Fatalf("la alerta se cumplio con un precio de hace una hora: %+v", f)
	}

	// La lista: primero la activa, despues las cumplidas (la ultima arriba),
	// con su precio. La quitada no aparece.
	lista, err := m.svc.GetPriceAlerts(ctx, m.ana)
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	if len(lista) != 3 || lista[0].ID != lejos.ID || lista[1].ID != abajo.ID || lista[2].ID != arriba.ID {
		t.Fatalf("lista = %+v, se esperaba [lejos, abajo, arriba]", lista)
	}
	if lista[0].Status != AlertaActiva || lista[0].TriggeredAt != nil || lista[0].TriggeredPrice != nil {
		t.Fatalf("la activa salio %+v", lista[0])
	}
	for i, precio := range map[int]string{1: "400", 2: "2000"} {
		a := lista[i]
		if a.Status != AlertaCumplida || a.Active || a.TriggeredAt == nil ||
			a.TriggeredPrice == nil || !a.TriggeredPrice.Equal(dec(precio)) {
			t.Fatalf("la cumplida %d salio %+v", i, a)
		}
	}

	// Quitar una cumplida la saca de la lista, pero la fila queda.
	if err := m.svc.RemovePriceAlert(ctx, m.ana, arriba.ID); err != nil {
		t.Fatalf("quitar la cumplida: %v", err)
	}
	lista, _ = m.svc.GetPriceAlerts(ctx, m.ana)
	if len(lista) != 2 {
		t.Fatalf("despues de quitar la cumplida quedaron %d en la lista", len(lista))
	}
	if f := m.fila(t, arriba.ID); f.cumplida == nil || f.borrada == nil {
		t.Fatalf("la cumplida quitada quedo %+v; debe conservar su cumplimiento y anotar la baja", f)
	}
	var filas int
	if err := m.pool.QueryRow(ctx, `SELECT COUNT(*) FROM crypto_price_alerts WHERE user_id = $1`, m.ana).Scan(&filas); err != nil || filas != 4 {
		t.Fatalf("filas de la persona = %d (err %v): quitar no borra", filas, err)
	}
}

// Las alertas de una cuenta bloqueada esperan: no se cumplen ni se avisan
// mientras dure el bloqueo.
func TestEvaluadorDeAlertas_NoEvaluaCuentasBloqueadas(t *testing.T) {
	m := montarAlertas(t)
	ctx := context.Background()
	a := m.crear(t, m.beto, "BTC", "above", "1500")

	// Con su rastro, como lo deja el bloqueo real (chk_users_blocked_coherente).
	if _, err := m.pool.Exec(ctx,
		`UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'prueba' WHERE id = $1`,
		m.beto); err != nil {
		t.Fatalf("bloquear: %v", err)
	}
	m.precio("BTC", 2000)
	m.vuelta(t, 0)
	if f := m.fila(t, a.ID); !f.activa || m.avisos.total() != 0 {
		t.Fatalf("la alerta de una cuenta bloqueada se cumplio: %+v", f)
	}

	if _, err := m.pool.Exec(ctx,
		`UPDATE users SET status = 'active', blocked_at = NULL, blocked_reason = NULL WHERE id = $1`,
		m.beto); err != nil {
		t.Fatalf("desbloquear: %v", err)
	}
	m.vuelta(t, 1)
}

// Dos barridos a la vez (dos instancias sin el candado, o un candado que se
// perdio): cada alerta se marca una sola vez.
func TestCumplirAlertas_DosBarridosALaVezNoRepitenNinguna(t *testing.T) {
	m := montarAlertas(t)
	ctx := context.Background()
	const porPersona = 30
	for _, usuario := range []string{m.ana, m.beto} {
		if _, err := m.pool.Exec(ctx, `
			INSERT INTO crypto_price_alerts (user_id, asset, target_price, direction)
			SELECT $1::uuid, 'BTC', 1000 + g, 'above' FROM generate_series(1, $2) AS g`,
			usuario, porPersona); err != nil {
			t.Fatalf("sembrar alertas: %v", err)
		}
	}

	var (
		mu     sync.Mutex
		vistas = map[string]int{}
		wg     sync.WaitGroup
		fallas = make(chan error, 2)
	)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				cumplidas, err := m.repo.CumplirAlertas(ctx, "BTC", dec("5000"), 7)
				if err != nil {
					fallas <- err
					return
				}
				if len(cumplidas) == 0 {
					return
				}
				mu.Lock()
				for _, a := range cumplidas {
					vistas[a.ID]++
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	close(fallas)
	for err := range fallas {
		t.Fatalf("CumplirAlertas: %v", err)
	}

	if len(vistas) != 2*porPersona {
		t.Fatalf("se cumplieron %d alertas distintas, se esperaban %d", len(vistas), 2*porPersona)
	}
	for id, veces := range vistas {
		if veces != 1 {
			t.Fatalf("la alerta %s se cumplio %d veces", id, veces)
		}
	}
	var activas int
	if err := m.pool.QueryRow(ctx, `SELECT COUNT(*) FROM crypto_price_alerts WHERE active`).Scan(&activas); err != nil || activas != 0 {
		t.Fatalf("quedaron %d activas (err %v)", activas, err)
	}
}

func TestPriceAlert_TopeDeActivas(t *testing.T) {
	m := montarAlertas(t)
	ctx := context.Background()
	for i := range AlertasActivasMaximas {
		m.crear(t, m.ana, "BTC", "above", fmt.Sprint(1500+i))
	}

	_, err := m.svc.AddPriceAlert(ctx, m.ana, &CrearAlertaRequest{
		Asset: "BTC", Direction: "above", TargetPrice: dec("9000"),
	})
	var tope *plans.TopeAlcanzadoError
	if !errors.As(err, &tope) || tope.Limite != AlertasActivasMaximas || tope.Actuales != AlertasActivasMaximas {
		t.Fatalf("la alerta %d: err = %v, se esperaba el tope de %d", AlertasActivasMaximas+1, err, AlertasActivasMaximas)
	}

	// Otra persona no comparte el tope.
	m.crear(t, m.beto, "BTC", "above", "9000")

	// Las cumplidas no cuentan: al cumplirse dos, hay lugar para dos mas.
	m.precio("BTC", 1501)
	m.vuelta(t, 2)
	m.precio("BTC", 1000)
	m.crear(t, m.ana, "BTC", "above", "9000")
	m.crear(t, m.ana, "BTC", "above", "9001")
	if _, err := m.svc.AddPriceAlert(ctx, m.ana, &CrearAlertaRequest{
		Asset: "BTC", Direction: "above", TargetPrice: dec("9002"),
	}); !errors.As(err, &tope) {
		t.Fatalf("con el tope otra vez lleno: err = %v", err)
	}
}

// ── HTTP y contrato ─────────────────────────────────────────────────────────

const urlAlertas = "http://localhost:8080/api/v1/crypto/alerts"

func (m *montajeAlertas) pedir(t *testing.T, metodo, url, cuerpo string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewHandler(m.svc)
	r := chi.NewRouter()
	r.Get("/api/v1/crypto/alerts", h.GetPriceAlerts)
	r.Post("/api/v1/crypto/alerts", h.AddPriceAlert)
	r.Delete("/api/v1/crypto/alerts/{id}", h.RemovePriceAlert)

	req := httptest.NewRequest(metodo, url, strings.NewReader(cuerpo))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, m.ana))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

type sobreDeRespuesta struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code string `json:"code"`
	} `json:"error"`
}

func leerSobre(t *testing.T, rec *httptest.ResponseRecorder) sobreDeRespuesta {
	t.Helper()
	var s sobreDeRespuesta
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("respuesta ilegible (%d): %s", rec.Code, rec.Body.String())
	}
	return s
}

func TestAlertasHTTP_CumplenElContrato(t *testing.T) {
	m := montarAlertas(t)
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("cargar el contrato: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router del contrato: %v", err)
	}
	validar := func(metodo string, estado int, crudo json.RawMessage) {
		t.Helper()
		var data any
		if err := json.Unmarshal(crudo, &data); err != nil {
			t.Fatalf("data ilegible: %v", err)
		}
		if err := contract.ValidateData(router, metodo, urlAlertas, estado, data); err != nil {
			t.Errorf("%s %d no cumple el contrato: %v", metodo, estado, err)
		}
	}

	// Crear: numero o texto, el activo se normaliza, y lo que el cliente
	// mande de mas (id, estado) se ignora.
	rec := m.pedir(t, http.MethodPost, urlAlertas,
		`{"id":"no-es-uuid","status":"triggered","asset":"btc","target_price":1500,"direction":"above"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("crear = %d: %s", rec.Code, rec.Body.String())
	}
	sobre := leerSobre(t, rec)
	validar(http.MethodPost, http.StatusCreated, sobre.Data)
	var creada PriceAlertRecord
	if err := json.Unmarshal(sobre.Data, &creada); err != nil {
		t.Fatalf("leer la creada: %v", err)
	}
	if creada.ID == "no-es-uuid" || creada.Asset != "BTC" || creada.Status != AlertaActiva ||
		!creada.Active || creada.UserID != m.ana || creada.CreatedAt.IsZero() {
		t.Fatalf("creada = %+v", creada)
	}
	if rec := m.pedir(t, http.MethodPost, urlAlertas,
		`{"asset":"BTC","target_price":"800.25","direction":"below"}`); rec.Code != http.StatusCreated {
		t.Fatalf("crear con el precio como texto = %d: %s", rec.Code, rec.Body.String())
	}

	// Ya cumplida con el precio de ahora (BTC a 1000).
	rec = m.pedir(t, http.MethodPost, urlAlertas, `{"asset":"BTC","target_price":900,"direction":"above"}`)
	if s := leerSobre(t, rec); rec.Code != http.StatusBadRequest || s.Error == nil || s.Error.Code != "ALERT_ALREADY_MET" {
		t.Fatalf("ya cumplida = %d: %s", rec.Code, rec.Body.String())
	}

	// La lista con una cumplida tambien cumple el contrato.
	m.precio("BTC", 1600)
	m.vuelta(t, 1)
	m.precio("BTC", 1000)
	rec = m.pedir(t, http.MethodGet, urlAlertas, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("listar = %d: %s", rec.Code, rec.Body.String())
	}
	sobre = leerSobre(t, rec)
	validar(http.MethodGet, http.StatusOK, sobre.Data)
	var lista []PriceAlertRecord
	if err := json.Unmarshal(sobre.Data, &lista); err != nil || len(lista) != 2 {
		t.Fatalf("lista = %s (err %v)", sobre.Data, err)
	}
	if lista[1].Status != AlertaCumplida || lista[1].TriggeredPrice == nil {
		t.Fatalf("la cumplida salio %+v", lista[1])
	}

	// El tope: 409 con los numeros.
	for i := 1; i < AlertasActivasMaximas; i++ {
		m.crear(t, m.ana, "BTC", "above", fmt.Sprint(2000+i))
	}
	rec = m.pedir(t, http.MethodPost, urlAlertas, `{"asset":"BTC","target_price":5000,"direction":"above"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("pasado el tope = %d: %s", rec.Code, rec.Body.String())
	}
	if err := contract.ValidateResponseBody(router, http.MethodPost, urlAlertas, http.StatusConflict, rec.Body.Bytes()); err != nil {
		t.Errorf("el 409 no cumple PriceAlertLimitError: %v", err)
	}

	// Quitar responde 204 y la saca de la lista.
	rec = m.pedir(t, http.MethodDelete, urlAlertas+"/"+creada.ID, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("quitar = %d: %s", rec.Code, rec.Body.String())
	}
	if f := m.fila(t, creada.ID); f.activa || f.borrada == nil {
		t.Fatalf("la quitada quedo %+v", f)
	}
}
