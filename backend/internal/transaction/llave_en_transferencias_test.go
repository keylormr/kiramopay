package transaction_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
)

// La llave de idempotencia en las transferencias y en el retiro del saldo del
// negocio: las mismas carreras que carrera_de_la_llave_test.go fija para
// CrearOReconocer, y lo que "el mismo movimiento" tiene que mirar ademas del
// monto. Una llave repetida es un reintento solo si pide lo mismo: el mismo
// monto, la misma moneda, el mismo tipo y el mismo destino —a quien va la
// plata, o el activo que se compra—. Si pide otra cosa, devolverle lo de
// aquella vez es contestarle "ya estaba hecho" por algo que nunca se hizo.

type resultadoTransferencia struct {
	emisor, receptor *transaction.TransactionRecord
	err              error
	listo            chan struct{}
}

func lanzarTransferencia(svc *transaction.Service, req *transaction.CreateTransferRequest) *resultadoTransferencia {
	r := &resultadoTransferencia{listo: make(chan struct{})}
	go func() {
		defer close(r.listo)
		r.emisor, r.receptor, r.err = svc.CreateTransfer(context.Background(), req)
	}()
	return r
}

func transferencia(de, a string, monto int64, llave string) *transaction.CreateTransferRequest {
	return &transaction.CreateTransferRequest{
		FromUserID: de, ToUserID: a, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
		TxType: transaction.TypeP2PSend, ReceiveType: transaction.TypeP2PReceive,
	}
}

type resultadoRetiro struct {
	rec   *transaction.TransactionRecord
	err   error
	listo chan struct{}
}

func lanzarRetiro(svc *transaction.Service, comercio, dueno string, monto int64, llave string) *resultadoRetiro {
	r := &resultadoRetiro{listo: make(chan struct{})}
	go func() {
		defer close(r.listo)
		r.rec, _, r.err = svc.WithdrawMerchantToUser(context.Background(), comercio, "Tienda", dueno, "CRC", monto, llave)
	}()
	return r
}

// cobrarAlComercio le da saldo propio a un comercio: un pago QR que el libro
// acredita en su cuenta.
func cobrarAlComercio(t *testing.T, svc *transaction.Service, pagador, comercio string, monto int64) {
	t.Helper()
	if _, _, err := svc.CreateTransfer(context.Background(), &transaction.CreateTransferRequest{
		FromUserID: pagador, ToMerchantID: comercio, Amount: monto, Currency: "CRC",
		IdempotencyKey: "comercio:cobro:" + uuid.New().String(),
		TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
	}); err != nil {
		t.Fatalf("cobro al comercio: %v", err)
	}
}

func saldoDelComercio(t *testing.T, svc *transaction.Service, comercio string) int64 {
	t.Helper()
	saldo, err := svc.MerchantBalance(context.Background(), comercio, "CRC")
	if err != nil {
		t.Fatalf("saldo del comercio: %v", err)
	}
	return saldo
}

func filasCompletadasDe(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND status = 'completed'`,
		userID).Scan(&n); err != nil {
		t.Fatalf("contar filas: %v", err)
	}
	return n
}

// --- CreateTransfer: la carrera ---

// Otro monto con la misma llave, y la transferencia del primero ya completada:
// el segundo no puede salir con "listo" y las filas del primero.
func TestCreateTransfer_OtroMontoConLaLlaveDeUnaTransferenciaHechaSeRechaza(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "transfer:carrera:tarde-otro-monto"
	saldoEmisor, saldoReceptor := crcWallet(t, pool, emisor), crcWallet(t, pool, receptor)

	otra := lanzarTransferencia(tarde, transferencia(emisor, receptor, 50000, llave))
	esperarCanal(t, freno.llego, "que la segunda llegue a insertar su fila")
	if _, _, err := svc.CreateTransfer(context.Background(), transferencia(emisor, receptor, 30000, llave)); err != nil {
		t.Fatalf("la primera transferencia: %v", err)
	}
	close(freno.soltar)
	esperarCanal(t, otra.listo, "que la segunda termine")

	if !errors.Is(otra.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la segunda: err=%v, se esperaba ErrLlaveReutilizada", otra.err)
	}
	if got, want := crcWallet(t, pool, emisor), saldoEmisor-30000; got != want {
		t.Fatalf("saldo del emisor = %d, se esperaba %d", got, want)
	}
	if got, want := crcWallet(t, pool, receptor), saldoReceptor+30000; got != want {
		t.Fatalf("saldo del receptor = %d, se esperaba %d", got, want)
	}
}

// El caso que mueve plata de verdad: la fila del emisor de la primera todavia
// esta pendiente cuando la segunda, con otro monto, choca con ella. Si sigue
// sobre esa fila, asienta SU monto con el id de la fila de la otra.
func TestCreateTransfer_OtroMontoNoSeAsientaSobreLaFilaPendienteDeLaPrimera(t *testing.T) {
	_, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	frenoPrimera := nuevoFreno(true)
	frenoSegunda := nuevoFreno(false)
	primera := servicioSobre(testutil.PoolTrazado(t, frenoPrimera))
	segunda := servicioSobre(testutil.PoolTrazado(t, frenoSegunda))
	const llave = "transfer:carrera:pendiente-otro-monto"
	saldoEmisor, saldoReceptor := crcWallet(t, pool, emisor), crcWallet(t, pool, receptor)

	// La segunda pasa la relectura sin fila y espera antes de insertar; la
	// primera escribe la fila del emisor y espera antes de seguir.
	otra := lanzarTransferencia(segunda, transferencia(emisor, receptor, 50000, llave))
	esperarCanal(t, frenoSegunda.llego, "que la segunda llegue a insertar su fila")
	propia := lanzarTransferencia(primera, transferencia(emisor, receptor, 30000, llave))
	esperarCanal(t, frenoPrimera.llego, "que la primera escriba la fila del emisor")
	close(frenoSegunda.soltar)
	esperarCanal(t, otra.listo, "que la segunda termine")
	close(frenoPrimera.soltar)
	esperarCanal(t, propia.listo, "que la primera termine")

	if !errors.Is(otra.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la segunda: err=%v, se esperaba ErrLlaveReutilizada: otra transferencia se asento sobre la fila de la primera", otra.err)
	}
	if propia.err != nil {
		t.Fatalf("la primera: %v", propia.err)
	}
	if got, want := crcWallet(t, pool, emisor), saldoEmisor-30000; got != want {
		t.Fatalf("saldo del emisor = %d, se esperaba %d: el libro movio otro monto que el de la fila", got, want)
	}
	if got, want := crcWallet(t, pool, receptor), saldoReceptor+30000; got != want {
		t.Fatalf("saldo del receptor = %d, se esperaba %d", got, want)
	}
}

// --- CreateTransfer: a quien va ---

// La misma llave y el mismo monto, pero a otra persona: no es el reintento de
// la primera. Contestar con aquella es decirle a quien envia que la plata le
// llego a alguien a quien nunca se le mando.
func TestCreateTransfer_OtroDestinatarioConLaMismaLlaveSeRechaza(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	tercero := testutil.SeedTestUser3(t, pool)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()
	const llave = "transfer:otro-destinatario"

	if _, _, err := svc.CreateTransfer(ctx, transferencia(emisor, receptor, 30000, llave)); err != nil {
		t.Fatalf("la primera transferencia: %v", err)
	}
	saldoEmisor, saldoTercero := crcWallet(t, pool, emisor), crcWallet(t, pool, tercero)

	_, _, err := svc.CreateTransfer(ctx, transferencia(emisor, tercero, 30000, llave))
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la misma llave hacia otra persona: err=%v, se esperaba ErrLlaveReutilizada", err)
	}
	if got := crcWallet(t, pool, emisor); got != saldoEmisor {
		t.Fatalf("saldo del emisor = %d, se esperaba %d", got, saldoEmisor)
	}
	if got := crcWallet(t, pool, tercero); got != saldoTercero {
		t.Fatalf("saldo de la tercera persona = %d, se esperaba %d", got, saldoTercero)
	}
}

// En la carrera es peor: la segunda, hacia otra persona, adoptaba la fila
// completada del emisor, escribia la fila de recepcion de la tercera persona y
// la daba por completada con el asiento de la primera. A la tercera le quedaba
// un "recibido" de una plata que nunca le llego.
func TestCreateTransfer_OtroDestinatarioEnLaCarreraSeRechazaSinDejarUnRecibidoFantasma(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	tercero := testutil.SeedTestUser3(t, pool)
	billeteraHolgada(t, pool, emisor)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "transfer:carrera:otro-destinatario"
	saldoTercero := crcWallet(t, pool, tercero)
	filasTercero := filasCompletadasDe(t, pool, tercero)

	otra := lanzarTransferencia(tarde, transferencia(emisor, tercero, 30000, llave))
	esperarCanal(t, freno.llego, "que la segunda llegue a insertar su fila")
	if _, _, err := svc.CreateTransfer(context.Background(), transferencia(emisor, receptor, 30000, llave)); err != nil {
		t.Fatalf("la primera transferencia: %v", err)
	}
	close(freno.soltar)
	esperarCanal(t, otra.listo, "que la segunda termine")

	if !errors.Is(otra.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la segunda: err=%v, se esperaba ErrLlaveReutilizada", otra.err)
	}
	if got := filasCompletadasDe(t, pool, tercero); got != filasTercero {
		t.Fatalf("la tercera persona tiene %d filas completadas, se esperaban %d: le quedo un recibido sin plata", got, filasTercero)
	}
	if got := crcWallet(t, pool, tercero); got != saldoTercero {
		t.Fatalf("saldo de la tercera persona = %d, se esperaba %d", got, saldoTercero)
	}
}

// Otra persona con la misma llave hacia el mismo destinatario: la fila de
// recepcion choca con la de la primera, que es de otro movimiento. Se adoptaba
// sin mirarla, el asiento chocaba despues con un error que el cliente no sabe
// leer, y la fila propia de quien envia quedaba 'pending' para siempre.
func TestCreateTransfer_OtroEmisorConLaMismaLlaveNoAdoptaLaRecepcionAjena(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	tercero := testutil.SeedTestUser3(t, pool)
	billeteraHolgada(t, pool, emisor)
	billeteraHolgada(t, pool, tercero)
	ctx := context.Background()
	const llave = "transfer:otro-emisor"

	if _, _, err := svc.CreateTransfer(ctx, transferencia(emisor, receptor, 30000, llave)); err != nil {
		t.Fatalf("la primera transferencia: %v", err)
	}
	saldoTercero, saldoReceptor := crcWallet(t, pool, tercero), crcWallet(t, pool, receptor)

	_, _, err := svc.CreateTransfer(ctx, transferencia(tercero, receptor, 30000, llave))
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("otra persona con la misma llave: err=%v, se esperaba ErrLlaveReutilizada", err)
	}
	if got := crcWallet(t, pool, tercero); got != saldoTercero {
		t.Fatalf("saldo de quien envia = %d, se esperaba %d", got, saldoTercero)
	}
	if got := crcWallet(t, pool, receptor); got != saldoReceptor {
		t.Fatalf("saldo de quien recibe = %d, se esperaba %d", got, saldoReceptor)
	}
	var estado string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM transactions WHERE user_id = $1::uuid AND idempotency_key = $2`,
		tercero, llave).Scan(&estado); err != nil {
		t.Fatalf("leer la fila de quien envia: %v", err)
	}
	if estado != transaction.StatusFailed {
		t.Fatalf("la fila de quien envia quedo %q, se esperaba %q", estado, transaction.StatusFailed)
	}
}

// --- CreateTransfer: lo que tiene que seguir siendo repeticion ---

func TestCreateTransfer_LaMismaTransferenciaDosVecesEsRepeticion(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()

	env1, rec1, err := svc.CreateTransfer(ctx, transferencia(emisor, receptor, 30000, "transfer:dos-veces"))
	if err != nil {
		t.Fatalf("la primera: %v", err)
	}
	saldo := crcWallet(t, pool, emisor)
	env2, rec2, err := svc.CreateTransfer(ctx, transferencia(emisor, receptor, 30000, "transfer:dos-veces"))
	if err != nil {
		t.Fatalf("la repeticion: %v", err)
	}
	if env2.ID != env1.ID || rec2 == nil || rec2.ID != rec1.ID {
		t.Fatalf("la repeticion devolvio otras filas: emisor %s/%s", env2.ID, env1.ID)
	}
	if got := crcWallet(t, pool, emisor); got != saldo {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro dos veces", got, saldo)
	}

	// Y el cobro a un comercio, que no tiene fila de recepcion.
	comercio := uuid.New().String()
	cobro := func() *transaction.CreateTransferRequest {
		return &transaction.CreateTransferRequest{
			FromUserID: emisor, ToMerchantID: comercio, Amount: 20000, Currency: "CRC",
			IdempotencyKey: "transfer:dos-veces:comercio",
			TxType:         transaction.TypeQRPayment, ReceiveType: transaction.TypeQRReceive,
		}
	}
	primero, _, err := svc.CreateTransfer(ctx, cobro())
	if err != nil {
		t.Fatalf("el primer cobro: %v", err)
	}
	saldo = crcWallet(t, pool, emisor)
	segundo, _, err := svc.CreateTransfer(ctx, cobro())
	if err != nil {
		t.Fatalf("la repeticion del cobro: %v", err)
	}
	if segundo.ID != primero.ID {
		t.Fatalf("la repeticion del cobro devolvio %s, el cobro fue %s", segundo.ID, primero.ID)
	}
	if got := crcWallet(t, pool, emisor); got != saldo {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro dos veces", got, saldo)
	}
	if got := saldoDelComercio(t, svc, comercio); got != 20000 {
		t.Fatalf("saldo del comercio = %d, se esperaba 20000", got)
	}
}

// Las filas escritas antes de este cambio no dicen a quien iba la plata: con
// ellas se compara lo de siempre, y el reintento sigue siendo reintento.
func TestCreateTransfer_UnaFilaViejaSinDestinoSigueSiendoRepeticion(t *testing.T) {
	svc, pool, emisor, receptor := setupTransferService(t)
	const llave = "transfer:fila-vieja"
	id := insertarFilaCruda(t, pool, emisor, transaction.TypeP2PSend, "CRC", llave, transaction.StatusCompleted, 30000)
	saldo := crcWallet(t, pool, emisor)

	env, _, err := svc.CreateTransfer(context.Background(), transferencia(emisor, receptor, 30000, llave))
	if err != nil {
		t.Fatalf("el reintento sobre la fila vieja: %v", err)
	}
	if env.ID != id {
		t.Fatalf("devolvio %s, la fila es %s", env.ID, id)
	}
	if got := crcWallet(t, pool, emisor); got != saldo {
		t.Fatalf("saldo = %d, se esperaba %d: se cobro de nuevo", got, saldo)
	}
}

// --- WithdrawMerchantToUser ---

func TestWithdrawMerchantToUser_OtroMontoConLaLlaveDeUnRetiroHechoSeRechaza(t *testing.T) {
	svc, pool, emisor, dueno := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	comercio := uuid.New().String()
	cobrarAlComercio(t, svc, emisor, comercio, 500000)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "mwithdraw:carrera:tarde-otro-monto"
	saldoDueno := crcWallet(t, pool, dueno)

	otro := lanzarRetiro(tarde, comercio, dueno, 120000, llave)
	esperarCanal(t, freno.llego, "que el segundo llegue a insertar su fila")
	if _, _, err := svc.WithdrawMerchantToUser(context.Background(), comercio, "Tienda", dueno, "CRC", 100000, llave); err != nil {
		t.Fatalf("el primer retiro: %v", err)
	}
	close(freno.soltar)
	esperarCanal(t, otro.listo, "que el segundo termine")

	if !errors.Is(otro.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("el segundo: err=%v, se esperaba ErrLlaveReutilizada", otro.err)
	}
	if got, want := crcWallet(t, pool, dueno), saldoDueno+100000; got != want {
		t.Fatalf("saldo del dueno = %d, se esperaba %d", got, want)
	}
	if got, want := saldoDelComercio(t, svc, comercio), int64(400000); got != want {
		t.Fatalf("saldo del comercio = %d, se esperaba %d", got, want)
	}
}

func TestWithdrawMerchantToUser_OtroMontoNoSeAsientaSobreLaFilaPendienteDelPrimero(t *testing.T) {
	svc, pool, emisor, dueno := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	comercio := uuid.New().String()
	cobrarAlComercio(t, svc, emisor, comercio, 500000)
	frenoPrimero := nuevoFreno(true)
	frenoSegundo := nuevoFreno(false)
	primero := servicioSobre(testutil.PoolTrazado(t, frenoPrimero))
	segundo := servicioSobre(testutil.PoolTrazado(t, frenoSegundo))
	const llave = "mwithdraw:carrera:pendiente-otro-monto"
	saldoDueno := crcWallet(t, pool, dueno)

	otro := lanzarRetiro(segundo, comercio, dueno, 120000, llave)
	esperarCanal(t, frenoSegundo.llego, "que el segundo llegue a insertar su fila")
	propio := lanzarRetiro(primero, comercio, dueno, 100000, llave)
	esperarCanal(t, frenoPrimero.llego, "que el primero escriba su fila")
	close(frenoSegundo.soltar)
	esperarCanal(t, otro.listo, "que el segundo termine")
	close(frenoPrimero.soltar)
	esperarCanal(t, propio.listo, "que el primero termine")

	if !errors.Is(otro.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("el segundo: err=%v, se esperaba ErrLlaveReutilizada: otro retiro se asento sobre la fila del primero", otro.err)
	}
	if propio.err != nil {
		t.Fatalf("el primero: %v", propio.err)
	}
	if got, want := crcWallet(t, pool, dueno), saldoDueno+100000; got != want {
		t.Fatalf("saldo del dueno = %d, se esperaba %d: el libro movio otro monto que el de la fila", got, want)
	}
	if got, want := saldoDelComercio(t, svc, comercio), int64(400000); got != want {
		t.Fatalf("saldo del comercio = %d, se esperaba %d", got, want)
	}
}

// La misma llave y el mismo monto desde otro comercio: no es el reintento del
// primer retiro, y el segundo comercio no puede quedar con su saldo adentro y
// un "listo".
func TestWithdrawMerchantToUser_DesdeOtroComercioConLaMismaLlaveSeRechaza(t *testing.T) {
	svc, pool, emisor, dueno := setupTransferService(t)
	billeteraHolgada(t, pool, emisor)
	ctx := context.Background()
	comercioA, comercioB := uuid.New().String(), uuid.New().String()
	cobrarAlComercio(t, svc, emisor, comercioA, 300000)
	cobrarAlComercio(t, svc, emisor, comercioB, 300000)
	const llave = "mwithdraw:otro-comercio"

	if _, _, err := svc.WithdrawMerchantToUser(ctx, comercioA, "Tienda A", dueno, "CRC", 100000, llave); err != nil {
		t.Fatalf("el retiro del primer comercio: %v", err)
	}
	_, _, err := svc.WithdrawMerchantToUser(ctx, comercioB, "Tienda B", dueno, "CRC", 100000, llave)
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la misma llave desde otro comercio: err=%v, se esperaba ErrLlaveReutilizada", err)
	}
	if got := saldoDelComercio(t, svc, comercioB); got != 300000 {
		t.Fatalf("saldo del segundo comercio = %d, se esperaba 300000", got)
	}
}

// --- CrearOReconocer: el activo ---

func compraDeActivo(monto int64, activo, llave string) *transaction.CreateTransactionRequest {
	return &transaction.CreateTransactionRequest{
		Type: transaction.TypeCryptoBuy, Amount: monto, Currency: "CRC", IdempotencyKey: llave,
		CounterpartyType: "crypto", CounterpartyName: activo,
	}
}

// La misma llave y el mismo monto en colones, pero otro activo: la capa de
// cripto lo frena antes cuando la primera ya termino, pero no en la carrera, y
// aqui la relectura comparaba solo monto, moneda y tipo.
func TestCrearOReconocer_OtroActivoConLaMismaLlaveSeRechaza(t *testing.T) {
	svc, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	ctx := context.Background()
	const llave = "activo:otro"
	saldo := crcWallet(t, pool, userID)

	if _, _, err := svc.CrearOReconocer(ctx, userID, compraDeActivo(30000, "BTC", llave)); err != nil {
		t.Fatalf("la compra de BTC: %v", err)
	}
	_, repetido, err := svc.CrearOReconocer(ctx, userID, compraDeActivo(30000, "ETH", llave))
	if !errors.Is(err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la misma llave para ETH: repetido=%v err=%v, se esperaba ErrLlaveReutilizada", repetido, err)
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

func TestCrearOReconocer_OtroActivoEnLaCarreraSeRechaza(t *testing.T) {
	svc, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	freno := nuevoFreno(false)
	tarde := servicioSobre(testutil.PoolTrazado(t, freno))
	const llave = "activo:carrera"
	saldo := crcWallet(t, pool, userID)

	otro := lanzar(tarde, userID, compraDeActivo(30000, "ETH", llave))
	esperarCanal(t, freno.llego, "que el segundo llegue a insertar su fila")
	if _, _, err := svc.CrearOReconocer(context.Background(), userID, compraDeActivo(30000, "BTC", llave)); err != nil {
		t.Fatalf("la compra de BTC: %v", err)
	}
	close(freno.soltar)
	esperarCanal(t, otro.listo, "que el segundo termine")

	if !errors.Is(otro.err, transaction.ErrLlaveReutilizada) {
		t.Fatalf("la compra de ETH: repetido=%v err=%v, se esperaba ErrLlaveReutilizada", otro.repetido, otro.err)
	}
	if got, want := crcWallet(t, pool, userID), saldo-30000; got != want {
		t.Fatalf("saldo = %d, se esperaba %d", got, want)
	}
}

// La base guarda el nombre de la contraparte recortado. Compararlo sin
// recortar convertiria en "llave reutilizada" el reintento identico de un
// movimiento con un nombre largo.
func TestCrearOReconocer_ConUnNombreLargoElReintentoSigueSiendoRepeticion(t *testing.T) {
	svc, pool, userID := conPool(t)
	billeteraHolgada(t, pool, userID)
	ctx := context.Background()
	largo := strings.Repeat("Proveedor de servicios con un nombre muy largo ", 4)
	pedido := func() *transaction.CreateTransactionRequest {
		return &transaction.CreateTransactionRequest{
			Type: transaction.TypeCryptoBuy, Amount: 25000, Currency: "CRC", IdempotencyKey: "nombre:largo",
			CounterpartyType: "service", CounterpartyName: largo,
		}
	}

	primero, _, err := svc.CrearOReconocer(ctx, userID, pedido())
	if err != nil {
		t.Fatalf("el primero: %v", err)
	}
	segundo, repetido, err := svc.CrearOReconocer(ctx, userID, pedido())
	if err != nil || !repetido {
		t.Fatalf("el reintento identico: repetido=%v err=%v, se esperaba la repeticion", repetido, err)
	}
	if segundo.ID != primero.ID {
		t.Fatalf("el reintento devolvio %s, el movimiento fue %s", segundo.ID, primero.ID)
	}
}
