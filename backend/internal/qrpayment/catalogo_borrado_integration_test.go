package qrpayment_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// Sacar un producto del catalogo no borra la fila: la marca (deleted_at), la
// deja inactiva, y quien lo saco queda en audit_logs. Desde ahi no se lista,
// ni en la gestion ni al cobrar, y no se edita. Regla del dueno: todo borrado
// es logico; quitar acceso no es borrar registros.

// accionProductoSacado es la accion que deja en audit_logs sacar un producto.
const accionProductoSacado = "merchant_catalog_item_removed"

// filaDelProducto es lo que queda de un producto en la tabla, se haya sacado
// del catalogo o no.
type filaDelProducto struct {
	existe   bool
	activo   bool
	nombre   string
	precio   int64
	sacadoEn *time.Time
}

func leerProducto(t *testing.T, pool *pgxpool.Pool, itemID string) filaDelProducto {
	t.Helper()
	var f filaDelProducto
	err := pool.QueryRow(context.Background(), `
		SELECT active, name, price_minor, deleted_at
		  FROM merchant_catalog_items WHERE id = $1::uuid`, itemID,
	).Scan(&f.activo, &f.nombre, &f.precio, &f.sacadoEn)
	if errors.Is(err, pgx.ErrNoRows) {
		return f
	}
	if err != nil {
		t.Fatalf("leer el producto: %v", err)
	}
	f.existe = true
	return f
}

func crearProducto(t *testing.T, svc *qrpayment.Service, merchantID, userID, nombre string, precio int64) *qrpayment.CatalogItem {
	t.Helper()
	item, err := svc.CreateCatalogItem(context.Background(), merchantID, userID,
		&qrpayment.CatalogItemRequest{Name: nombre, PriceMinor: precio, Currency: "CRC"})
	if err != nil {
		t.Fatalf("crear el producto %q: %v", nombre, err)
	}
	return item
}

func idsDelCatalogo(t *testing.T, svc *qrpayment.Service, merchantID, userID string) []string {
	t.Helper()
	items, err := svc.ListCatalog(context.Background(), merchantID, userID)
	if err != nil {
		t.Fatalf("leer el catalogo: %v", err)
	}
	ids := make([]string, 0, len(items))
	for _, c := range items {
		ids = append(ids, c.ID)
	}
	return ids
}

func noEncontrado(err error) bool {
	return err != nil && strings.Contains(err.Error(), "catalog item not found")
}

// El producto sacado sigue en la tabla, marcado e inactivo, y deja de estar en
// el catalogo para todo el equipo: el dueno, el gerente y el cajero, que es
// quien cobra con el. El otro producto no se toca.
func TestSacarDelCatalogo_MarcaLaFilaSinBorrarla(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	seedEmployee(t, pool, "606660666")
	cajero, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "606660666", Role: "cashier"})
	if err != nil {
		t.Fatalf("sumar al cajero: %v", err)
	}
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)
	te := crearProducto(t, svc, m.ID, owner, "Te", 90000)

	antes := time.Now().Add(-time.Minute)
	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, cafe.ID); err != nil {
		t.Fatalf("sacar el producto: %v", err)
	}

	f := leerProducto(t, pool, cafe.ID)
	if !f.existe {
		t.Fatal("sacar un producto borro la fila de merchant_catalog_items: el borrado tiene que ser logico")
	}
	if f.sacadoEn == nil || f.sacadoEn.Before(antes) {
		t.Errorf("deleted_at = %v, se esperaba la hora en que se saco", f.sacadoEn)
	}
	if f.activo {
		t.Error("el producto sacado quedo activo")
	}
	if f.nombre != "Cafe" || f.precio != 120000 {
		t.Errorf("el producto sacado cambio: %q a %d", f.nombre, f.precio)
	}

	if otro := leerProducto(t, pool, te.ID); !otro.existe || otro.sacadoEn != nil || !otro.activo {
		t.Errorf("el otro producto se toco: %+v", otro)
	}

	for quien, id := range map[string]string{"el dueno": owner, "el cajero": cajero.UserID} {
		ids := idsDelCatalogo(t, svc, m.ID, id)
		if len(ids) != 1 || ids[0] != te.ID {
			t.Errorf("%s ve en el catalogo %v, se esperaba solo %s", quien, ids, te.ID)
		}
	}
}

// Quien lo saco queda en el rastro, en la misma transaccion: una sola vez, con
// el comercio y el producto. Un segundo intento no deja otra entrada.
func TestSacarDelCatalogo_QuienLoSacoQuedaEnElRastro(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	seedEmployee(t, pool, "606660666")
	gerente, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "606660666", Role: "manager"})
	if err != nil {
		t.Fatalf("sumar al gerente: %v", err)
	}
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)

	if err := svc.DeleteCatalogItem(ctx, m.ID, gerente.UserID, cafe.ID); err != nil {
		t.Fatalf("el gerente saca el producto: %v", err)
	}
	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, cafe.ID); !noEncontrado(err) {
		t.Fatalf("sacarlo otra vez: err = %v, se esperaba catalog item not found", err)
	}

	var n int
	var quien, comercio, recurso, tipo string
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) OVER (), COALESCE(user_id::text, ''), COALESCE(details->>'merchant_id', ''),
		       COALESCE(resource_id, ''), COALESCE(resource_type, '')
		  FROM audit_logs WHERE action = $1`, accionProductoSacado,
	).Scan(&n, &quien, &comercio, &recurso, &tipo); err != nil {
		t.Fatalf("sacar un producto no dejo rastro en audit_logs (%s): %v", accionProductoSacado, err)
	}
	if n != 1 {
		t.Errorf("entradas en el rastro = %d, se esperaba 1", n)
	}
	if quien != gerente.UserID {
		t.Errorf("el rastro dice que lo saco %q, fue el gerente %q", quien, gerente.UserID)
	}
	if comercio != m.ID || recurso != cafe.ID || tipo != "merchant_catalog_item" {
		t.Errorf("el rastro dice comercio=%q recurso=%q tipo=%q; se esperaba %q, %q y merchant_catalog_item",
			comercio, recurso, tipo, m.ID, cafe.ID)
	}
}

// Sacar dos veces, sacar uno que no existe o sacarlo desde otro comercio del
// mismo dueno responde como hasta hoy: "catalog item not found". Y nada de eso
// mueve la marca del que ya se saco ni toca el producto del otro comercio.
func TestSacarDelCatalogo_LoQueNoSeEncuentra(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	otro, err := svc.RegisterMerchant(ctx, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Otra Soda", Category: "restaurant", Cedula: "3-101-456",
		CedulaType: "juridica", LegalName: "Otra Soda SA",
	})
	if err != nil {
		t.Fatalf("registrar el segundo comercio: %v", err)
	}
	if _, err := svc.ApproveMerchant(ctx, otro.ID, revisorDePrueba, qrpayment.ActorContext{}); err != nil {
		t.Fatalf("aprobar el segundo comercio: %v", err)
	}
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)
	te := crearProducto(t, svc, m.ID, owner, "Te", 90000)

	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, cafe.ID); err != nil {
		t.Fatalf("sacar el producto: %v", err)
	}
	primera := leerProducto(t, pool, cafe.ID)
	if !primera.existe || primera.sacadoEn == nil {
		t.Fatalf("despues de sacarlo la fila quedo %+v; se esperaba marcada", primera)
	}

	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, cafe.ID); !noEncontrado(err) {
		t.Errorf("sacarlo dos veces: err = %v, se esperaba catalog item not found", err)
	}
	if f := leerProducto(t, pool, cafe.ID); f.sacadoEn == nil || !f.sacadoEn.Equal(*primera.sacadoEn) {
		t.Errorf("el segundo intento movio la marca: %v, era %v", f.sacadoEn, primera.sacadoEn)
	}

	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, uuid.NewString()); !noEncontrado(err) {
		t.Errorf("sacar uno que no existe: err = %v, se esperaba catalog item not found", err)
	}

	if err := svc.DeleteCatalogItem(ctx, otro.ID, owner, te.ID); !noEncontrado(err) {
		t.Errorf("sacarlo desde otro comercio: err = %v, se esperaba catalog item not found", err)
	}
	if f := leerProducto(t, pool, te.ID); !f.existe || f.sacadoEn != nil || !f.activo {
		t.Errorf("el producto de un comercio se saco desde otro: %+v", f)
	}
}

// Un producto sacado no se edita ni se reactiva: ni por el servicio ni por el
// repositorio, que es lo que queda si el producto se saca entre la lectura del
// servicio y la escritura.
func TestSacarDelCatalogo_UnoSacadoNoSeEdita(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)
	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, cafe.ID); err != nil {
		t.Fatalf("sacar el producto: %v", err)
	}
	activo := true

	if _, err := svc.UpdateCatalogItem(ctx, m.ID, owner, cafe.ID,
		&qrpayment.CatalogItemRequest{Name: "Cafe grande", PriceMinor: 150000, Active: &activo}); !noEncontrado(err) {
		t.Errorf("editar uno sacado por el servicio: err = %v, se esperaba catalog item not found", err)
	}
	repo := qrpayment.NewRepository(pool)
	if _, err := repo.UpdateCatalogItem(ctx, m.ID, cafe.ID, "Cafe grande", 150000, true, 0); !noEncontrado(err) {
		t.Errorf("editar uno sacado por el repositorio: err = %v, se esperaba catalog item not found", err)
	}

	f := leerProducto(t, pool, cafe.ID)
	if !f.existe {
		t.Fatal("sacar un producto borro la fila de merchant_catalog_items: el borrado tiene que ser logico")
	}
	if f.activo || f.nombre != "Cafe" || f.precio != 120000 || f.sacadoEn == nil {
		t.Errorf("el producto sacado cambio: %+v", f)
	}
	if ids := idsDelCatalogo(t, svc, m.ID, owner); len(ids) != 0 {
		t.Errorf("el producto sacado volvio al catalogo: %v", ids)
	}
}

// La ruta responde igual que antes: 204 al sacarlo, y la segunda vez 400
// DELETE_ITEM_FAILED con "catalog item not found". La lista no lo trae, ni
// muestra la marca: la forma de un producto no cambio.
func TestSacarDelCatalogo_LaRutaRespondeComoAntes(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)
	te := crearProducto(t, svc, m.ID, owner, "Te", 90000)
	base := "/api/v1/qr/merchants/" + m.ID + "/catalog"
	conItem := map[string]string{"id": m.ID, "itemID": cafe.ID}

	rec := httptest.NewRecorder()
	h.DeleteCatalogItem(rec, peticionCon(http.MethodDelete, base+"/"+cafe.ID, "", owner, conItem))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("sacar el producto: %d %s, se esperaba 204", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.DeleteCatalogItem(rec, peticionCon(http.MethodDelete, base+"/"+cafe.ID, "", owner, conItem))
	if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "DELETE_ITEM_FAILED" ||
		!strings.Contains(rec.Body.String(), "catalog item not found") {
		t.Errorf("sacarlo otra vez: %d %s, se esperaba 400 DELETE_ITEM_FAILED con catalog item not found",
			rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.ListCatalog(rec, peticionCon(http.MethodGet, base, "", owner, map[string]string{"id": m.ID}))
	cuerpo := rec.Body.String()
	if rec.Code != http.StatusOK {
		t.Fatalf("leer el catalogo: %d %s", rec.Code, cuerpo)
	}
	if strings.Contains(cuerpo, cafe.ID) || !strings.Contains(cuerpo, te.ID) {
		t.Errorf("el catalogo trae %s; se esperaba solo %s", cuerpo, te.ID)
	}
	if strings.Contains(cuerpo, "deleted") {
		t.Errorf("la lista muestra la marca del borrado: %s", cuerpo)
	}

	if f := leerProducto(t, pool, cafe.ID); !f.existe || f.sacadoEn == nil {
		t.Errorf("despues de la ruta la fila quedo %+v; se esperaba marcada y no borrada", f)
	}
}

// ── Lo que encontro la revision ──────────────────────────────────────────────

// La marca y el rastro van en la misma transaccion: si el rastro no se puede
// escribir, el producto no queda sacado. Un userID que no es UUID hace fallar
// el INSERT en audit_logs (user_id es UUID) sin romper nada mas.
func TestSacarDelCatalogo_SiElRastroFallaNoQuedaLaMarca(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)

	repo := qrpayment.NewRepository(pool)
	err := repo.DeleteCatalogItem(ctx, m.ID, cafe.ID, "no-es-un-uuid")
	if err == nil || noEncontrado(err) {
		t.Fatalf("el rastro no se pudo escribir y el borrado respondio %v; se esperaba un fallo interno", err)
	}
	if f := leerProducto(t, pool, cafe.ID); !f.existe || f.sacadoEn != nil || !f.activo {
		t.Errorf("el rastro fallo pero la marca quedo: %+v", f)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action = $1`, accionProductoSacado); n != 0 {
		t.Errorf("entradas en el rastro = %d, se esperaba 0", n)
	}
	if ids := idsDelCatalogo(t, svc, m.ID, owner); len(ids) != 1 || ids[0] != cafe.ID {
		t.Errorf("el producto salio del catalogo sin rastro: %v", ids)
	}
}

// El rastro guarda los ids como los tiene la base, no como los escribio el
// cliente: Postgres acepta un UUID en mayusculas, y quien busque quien saco el
// producto lo busca por el id de la fila. Y no copia el nombre, que es texto
// libre del comerciante y sigue en la fila.
func TestSacarDelCatalogo_ElRastroGuardaLosIdsDeLaBase(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)

	if err := svc.DeleteCatalogItem(ctx, m.ID, owner, strings.ToUpper(cafe.ID)); err != nil {
		t.Fatalf("sacar el producto con el id en mayusculas: %v", err)
	}
	var recurso, comercio string
	var conNombre bool
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(resource_id, ''), COALESCE(details->>'merchant_id', ''), details ? 'name'
		  FROM audit_logs WHERE action = $1`, accionProductoSacado,
	).Scan(&recurso, &comercio, &conNombre); err != nil {
		t.Fatalf("leer el rastro: %v", err)
	}
	if recurso != cafe.ID || comercio != m.ID {
		t.Errorf("el rastro dice recurso=%q comercio=%q; la base los tiene como %q y %q", recurso, comercio, cafe.ID, m.ID)
	}
	if conNombre {
		t.Error("el rastro copia el nombre del producto")
	}
}

// Un id que no tiene forma de UUID es un producto que no existe: 400
// DELETE_ITEM_FAILED, como dice el contrato, y no un 500 que cualquiera puede
// provocar.
func TestSacarDelCatalogo_UnIdQueNoEsUUIDNoSeEncuentra(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	const malo = "no-es-un-uuid"

	rec := httptest.NewRecorder()
	h.DeleteCatalogItem(rec, peticionCon(http.MethodDelete, "/api/v1/qr/merchants/"+m.ID+"/catalog/"+malo, "", owner,
		map[string]string{"id": m.ID, "itemID": malo}))
	if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "DELETE_ITEM_FAILED" ||
		!strings.Contains(rec.Body.String(), "catalog item not found") {
		t.Errorf("sacar %q: %d %s, se esperaba 400 DELETE_ITEM_FAILED con catalog item not found", malo, rec.Code, rec.Body.String())
	}
}

// Dos que sacan el mismo producto a la vez dejan una sola marca y un solo
// rastro: el segundo espera la fila y ya no la ve.
func TestSacarDelCatalogo_DosALaVezDejanUnaSolaMarca(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	cafe := crearProducto(t, svc, m.ID, owner, "Cafe", 120000)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir la transaccion: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SELECT 1 FROM merchant_catalog_items WHERE id = $1::uuid FOR UPDATE`, cafe.ID); err != nil {
		t.Fatalf("tomar la fila del producto: %v", err)
	}

	resultados := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { resultados <- svc.DeleteCatalogItem(context.Background(), m.ID, owner, cafe.ID) }()
	}
	esperando := `SELECT COUNT(*) FROM pg_stat_activity
		WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
		  AND query LIKE '%merchant_catalog_items%' AND query LIKE '%deleted_at = NOW()%'`
	for limite := time.Now().Add(10 * time.Second); contar(t, pool, esperando) < 2; time.Sleep(20 * time.Millisecond) {
		if time.Now().After(limite) {
			t.Fatal("los dos borrados nunca esperaron en la fila del producto")
		}
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("soltar la fila: %v", err)
	}

	var bien, noEstaba int
	for i := 0; i < 2; i++ {
		select {
		case err := <-resultados:
			switch {
			case err == nil:
				bien++
			case noEncontrado(err):
				noEstaba++
			default:
				t.Errorf("borrado a la vez: %v", err)
			}
		case <-time.After(15 * time.Second):
			t.Fatal("un borrado no termino")
		}
	}
	if bien != 1 || noEstaba != 1 {
		t.Errorf("resultados: %d bien y %d no encontrado; se esperaba uno de cada uno", bien, noEstaba)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM audit_logs WHERE action = $1`, accionProductoSacado); n != 1 {
		t.Errorf("entradas en el rastro = %d, se esperaba 1", n)
	}
}
