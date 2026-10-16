package qrpayment_test

import (
	"context"
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/user"
)

// pedirReporteCSV prepara un comercio con el plan analitica y una venta sin
// sucursal ni cobrador, y devuelve una funcion que pide su CSV con la consulta
// dada.
func pedirReporteCSV(t *testing.T) func(consulta string) *httptest.ResponseRecorder {
	t.Helper()
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	h := qrpayment.NewHandler(qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool), nil))

	m := comercioVerificado(t, svc, owner)
	pagarAlComercio(t, svc, payer, owner, m.ID, 20000)
	if _, err := svc.AsignarPlanComercio(ctx, m.ID, owner, qrpayment.PlanComercioAnalitica, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("asignar analitica: %v", err)
	}

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, owner)))
		})
	})
	router.Get("/qr/merchants/{id}/report.csv", h.GetMerchantReportCSV)

	return func(consulta string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/qr/merchants/"+m.ID+"/report.csv?"+consulta, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", consulta, rec.Code, rec.Body.String())
		}
		return rec
	}
}

func filasDelCSV(t *testing.T, rec *httptest.ResponseRecorder) [][]string {
	t.Helper()
	filas, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(rec.Body.String(), "\xef\xbb\xbf"))).ReadAll()
	if err != nil {
		t.Fatalf("CSV invalido: %v", err)
	}
	return filas
}

// El reporte del comercio salia en espanol en cualquier idioma de la app: el
// encabezado, el nombre de cada seccion, "(sin asignar)" y el nombre del
// archivo. Con lang, sale en ese idioma.
func TestReporteCSV_SaleEnElIdiomaPedido(t *testing.T) {
	pedir := pedirReporteCSV(t)
	rec := pedir("days=7&tz=0&lang=en")
	filas := filasDelCSV(t, rec)

	if got := strings.Join(filas[0], ","); got != "section,from,to,key,name,gross,fee,net,payments" {
		t.Fatalf("encabezado = %q", got)
	}
	secciones := map[string]bool{}
	for _, f := range filas[1:] {
		secciones[f[0]] = true
	}
	for _, s := range []string{"day", "location", "collector", "total"} {
		if !secciones[s] {
			t.Errorf("falta la seccion %q; hay %v", s, secciones)
		}
	}
	crudo := rec.Body.String()
	if !strings.Contains(crudo, "(unassigned)") {
		t.Errorf("la venta sin sucursal no dice (unassigned):\n%s", crudo)
	}
	for _, espanol := range []string{"seccion", "sucursal", "cobrador", "sin asignar", "dia,"} {
		if strings.Contains(crudo, espanol) {
			t.Errorf("el CSV en ingles trae %q:\n%s", espanol, crudo)
		}
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="report-`) || !strings.Contains(cd, "-to-") {
		t.Errorf("Content-Disposition = %q", cd)
	}
}

// Sin lang, o con uno que la app no tiene, sigue en espanol como hasta ahora:
// lo que ya lo importaba no se rompe.
func TestReporteCSV_SinIdiomaSigueEnEspanol(t *testing.T) {
	pedir := pedirReporteCSV(t)
	for _, consulta := range []string{"days=7&tz=0", "days=7&tz=0&lang=xx", "days=7&tz=0&lang="} {
		rec := pedir(consulta)
		filas := filasDelCSV(t, rec)
		if got := strings.Join(filas[0], ","); got != "seccion,desde,hasta,clave,nombre,bruto,comision,neto,cobros" {
			t.Errorf("%s: encabezado = %q", consulta, got)
		}
		if !strings.Contains(rec.Body.String(), "(sin asignar)") {
			t.Errorf("%s: falta (sin asignar)", consulta)
		}
		if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="reporte-`) {
			t.Errorf("%s: Content-Disposition = %q", consulta, cd)
		}
	}
}

// Los siete idiomas de la app tienen su encabezado; ninguno cae al espanol
// salvo el espanol.
func TestReporteCSV_CadaIdiomaDeLaApp(t *testing.T) {
	pedir := pedirReporteCSV(t)
	vistos := map[string]string{}
	for _, idioma := range []string{"es", "en", "fr", "pt", "zh-cn", "ja", "hi"} {
		encabezado := strings.Join(filasDelCSV(t, pedir("days=7&tz=0&lang="+idioma))[0], ",")
		if otro, ok := vistos[encabezado]; ok {
			t.Errorf("%s repite el encabezado de %s: %q", idioma, otro, encabezado)
		}
		vistos[encabezado] = idioma
	}
}
