package crypto

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/shopspring/decimal"
)

type Service struct {
	repo   *Repository
	prices *PriceService
	tx     *transaction.Service
	// rates convierte el precio en dolares del feed a la moneda del monedero.
	// Nil deja el servicio operando solo en dolares (ver precioEn).
	rates RateLookup

	// Colaboradores del envio entre personas (ver envio.go y Opciones). Solo
	// los usa Send: sin ellos el resto de cripto funciona igual.
	destinatarios Destinatarios
	mfa           MFAEnforcer
	uif           UIFReporter
	avisos        Avisos
	logger        Logger
}

func NewService(repo *Repository, prices *PriceService, tx *transaction.Service, rates RateLookup, opts *Opciones) *Service {
	if opts == nil {
		opts = &Opciones{}
	}
	return &Service{
		repo:          repo,
		prices:        prices,
		tx:            tx,
		rates:         rates,
		destinatarios: opts.Destinatarios,
		mfa:           opts.MFA,
		uif:           opts.UIF,
		avisos:        opts.Avisos,
		logger:        opts.Logger,
	}
}

// toMinor converts a fiat amount (CRC/USD, 2 decimals) to integer centimos,
// exactly (no float round-trip).
func toMinor(v decimal.Decimal) int64 {
	return v.Mul(decimal.NewFromInt(100)).Round(0).IntPart()
}

// decimalesDeLaBase es la escala de las columnas de cantidades de cripto
// (NUMERIC(38,18), migracion 019).
const decimalesDeLaBase = 18

// validarCantidad rechaza una cantidad de cripto que no se puede operar.
//
// Los decimales se acotan a los de la base: con mas, `balance - $3` se
// redondea al guardarse y lo anotado dejaria de ser lo descontado.
func validarCantidad(cantidad decimal.Decimal) error {
	if !cantidad.IsPositive() {
		return fmt.Errorf("%w: must be positive", ErrMontoInvalido)
	}
	if !cantidad.Truncate(decimalesDeLaBase).Equal(cantidad) {
		return fmt.Errorf("%w: at most %d decimal places", ErrMontoInvalido, decimalesDeLaBase)
	}
	return nil
}

// saldoAlcanza es una comprobacion de CORTESIA: rechaza rapido, sin abrir un
// asiento ni dejar una fila fallida. Lee fuera de la transaccion, asi que no
// frena nada bajo concurrencia; lo que frena es la guarda de descontarActivo.
func (s *Service) saldoAlcanza(ctx context.Context, userID, simbolo string, cantidad decimal.Decimal) error {
	activo, err := s.repo.GetAsset(ctx, userID, simbolo)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrSaldoDeActivoInsuficiente, simbolo)
	}
	if err != nil {
		return fmt.Errorf("read %s balance: %w", simbolo, err)
	}
	if activo.Balance.LessThan(cantidad) {
		return fmt.Errorf("%w: %s", ErrSaldoDeActivoInsuficiente, simbolo)
	}
	return nil
}

func (s *Service) GetAssets(ctx context.Context, userID string) ([]AssetRecord, error) {
	return s.repo.GetAssets(ctx, userID)
}

func (s *Service) GetTransactions(ctx context.Context, userID string) ([]TransactionRecord, error) {
	return s.repo.GetTransactions(ctx, userID, 50)
}

// Buy compra cripto con fiat.
//
// El debito del fiat es el asiento; el abono del activo y la anotacion de la
// compra corren dentro de su transaccion (EnLaMismaTx), asi que confirman
// juntos o no confirma ninguno. Antes el abono iba despues y por fuera: una
// caida entre los dos pasos dejaba el fiat cobrado sin activo —y no hay
// conciliacion que lo levante, porque los activos no pasan por el libro—, y
// repetir la compra con la misma llave de idempotencia abonaba el activo otra
// vez sin cobrar nada.
func (s *Service) Buy(ctx context.Context, userID string, req *BuyRequest) (*TransactionRecord, error) {
	// req.Amount ya no se valida ni se usa: la cantidad de cripto la calcula el
	// servidor. Se sigue aceptando en el cuerpo para no romper a los clientes
	// desplegados, que todavia la mandan.
	if !req.FromAmount.IsPositive() {
		return nil, fmt.Errorf("%w: from_amount must be positive", ErrMontoInvalido)
	}
	currency := req.FromCurrency
	if currency == "" {
		currency = "CRC"
	}
	fiatMinor := toMinor(req.FromAmount)
	if fiatMinor <= 0 {
		return nil, fmt.Errorf("%w: from_amount is less than one centimo", ErrMontoInvalido)
	}
	// Lo que el libro cobra, al centimo. La cantidad sale de aqui y no del
	// monto pedido: con mas de dos decimales, los dos numeros no coinciden.
	pagado := decimal.New(fiatMinor, -2)

	// El precio y la cantidad de cripto los pone el servidor. Lo que decide el
	// cliente es cuanto de SU plata gasta, que es lo unico suyo que hay aqui.
	usd, err := s.precioEnDolares(ctx, req.Asset)
	if err != nil {
		return nil, err
	}
	precio, err := s.precioParaLiquidar(ctx, usd, req.Price, currency)
	if err != nil {
		return nil, err
	}
	cantidad := pagado.Div(precio)
	if !cantidad.IsPositive() {
		return nil, fmt.Errorf("%w: from_amount too small for one unit of %s", ErrMontoInvalido, req.Asset)
	}

	idem := req.IdempotencyKey
	if idem == "" {
		idem = "crypto:buy:" + uuid.New().String()
	}

	compra := &TransactionRecord{
		UserID:   userID,
		Type:     "buy",
		Asset:    req.Asset,
		Amount:   cantidad,
		Price:    precio,
		Total:    pagado,
		Currency: currency,
		Fee:      decimal.Zero,
		Status:   "completed",
	}
	nombre := getAssetName(req.Asset)
	// El costo promedio del activo va SIEMPRE en dolares, que es como lo lee
	// la pantalla para la ganancia. `precio` esta en la moneda del pago: una
	// compra en colones promediaba 500.000 con las de 1.000 en dolares.
	costoUSD := usd
	// El saldo, el tope, el segundo factor y la idempotencia del fiat viven en
	// CreateTransaction; el abono solo ocurre si el cobro confirma.
	fila, err := s.tx.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:             transaction.TypeCryptoBuy,
		Amount:           fiatMinor,
		Currency:         currency,
		Fee:              0,
		CounterpartyType: "crypto",
		CounterpartyName: req.Asset,
		Description:      fmt.Sprintf("Buy %s", req.Asset),
		IdempotencyKey:   idem,
		Internal:         true,
		EnLaMismaTx: func(ctx context.Context, dbtx pgx.Tx, txID string) error {
			compra.ID = txID
			return s.repo.ComprarEnTx(ctx, dbtx, nombre, compra, costoUSD)
		},
	})
	if err != nil {
		return nil, fmt.Errorf("buy %s: %w", req.Asset, err)
	}
	return s.anotado(ctx, userID, fila, compra), nil
}

// Sell vende cripto a cambio de fiat.
//
// El descuento del activo, el credito del fiat y la anotacion de la venta
// confirman juntos o no confirma ninguno: el descuento y la anotacion corren
// dentro de la transaccion del asiento (EnLaMismaTx), y el credito es el
// asiento. Antes eran pasos sueltos —descontar, acreditar y, si fallaba el
// credito, devolver el activo a mano—, y el descuento iba por el abono con un
// delta negativo, que el CHECK de saldo de la base rechaza SIEMPRE. Vender
// nunca funciono en produccion.
func (s *Service) Sell(ctx context.Context, userID string, req *SellRequest) (*TransactionRecord, error) {
	if err := validarCantidad(req.Amount); err != nil {
		return nil, err
	}
	currency := req.ToCurrency
	if currency == "" {
		currency = "CRC"
	}

	// Lo que el cliente decide es cuanto cripto vende; cuanto fiat recibe por
	// el lo dice el servidor. Al reves era acreditarse el monto que uno quiera.
	usd, err := s.precioEnDolares(ctx, req.Asset)
	if err != nil {
		return nil, err
	}
	precio, err := s.precioParaLiquidar(ctx, usd, req.Price, currency)
	if err != nil {
		return nil, err
	}
	fiatMinor := toMinor(req.Amount.Mul(precio))
	if fiatMinor <= 0 {
		return nil, fmt.Errorf("%w: worth less than one centimo", ErrMontoInvalido)
	}

	idem := req.IdempotencyKey
	if idem == "" {
		idem = "crypto:sell:" + uuid.New().String()
	}

	venta := &TransactionRecord{
		UserID: userID,
		Type:   "sell",
		Asset:  req.Asset,
		Amount: req.Amount,
		Price:  precio,
		// Lo que acredita el libro, al centimo. El producto sin redondear podia
		// traer mas decimales de los que entraron a la billetera.
		Total:    decimal.New(fiatMinor, -2),
		Currency: currency,
		Fee:      decimal.Zero,
		Status:   "completed",
	}
	pedido := &transaction.CreateTransactionRequest{
		Type:             transaction.TypeCryptoSell,
		Amount:           fiatMinor,
		Currency:         currency,
		Fee:              0,
		CounterpartyType: "crypto",
		CounterpartyName: req.Asset,
		Description:      fmt.Sprintf("Sell %s", req.Asset),
		IdempotencyKey:   idem,
		Internal:         true,
		// La venta toma el id de la fila de `transactions` a la que cuelga el
		// asiento: asi la repeticion con la misma llave encuentra la venta que ya
		// se hizo en vez de inventar otra. Un reintento por conflicto vuelve a
		// correr esto sobre una transaccion nueva, con el mismo id.
		EnLaMismaTx: func(ctx context.Context, dbtx pgx.Tx, txID string) error {
			venta.ID = txID
			return s.repo.VenderEnTx(ctx, dbtx, venta)
		},
	}

	// Comprobacion de cortesia del saldo. Antes no corria nunca con llave del
	// cliente —y la pantalla manda llave SIEMPRE—, asi que la unica guarda para
	// una persona real era la de dentro del asiento, que llega a la misma
	// respuesta abriendo una transaccion, escribiendo la fila del libro y
	// dejandola rotulada 'failed' —visible en el historial— para una venta que
	// nunca movio nada.
	//
	// El saldo se lee PRIMERO y la llave DESPUES, solo si el saldo no alcanza.
	// Son dos lecturas sueltas contra la base y el pedido original puede estar
	// todavia en vuelo —que es justo para lo que existe la llave del cliente:
	// la red que se corto sin traer la respuesta—, asi que puede commitear
	// entre una lectura y la otra. Al reves, la llave se leeria 'todavia no
	// completada' y un instante despues el saldo YA descontado, y esta
	// comprobacion contestaria "no te alcanza" a una venta que si ocurrio, sin
	// llegar nunca a la relectura de idempotencia que devuelve la venta vieja.
	// En este orden eso no puede pasar: el descuento del activo y el rotulo
	// 'completed' confirman en la MISMA transaccion, asi que un saldo que ya
	// vio el descuento va seguido de una llave que ve la respuesta.
	//
	// Preguntar por la llave solo cuando el saldo no alcanza tambien conserva
	// el orden de motivos que decide CreateTransaction: si la llave ya tiene
	// otro movimiento, lo que corresponde es ErrLlaveReutilizada, no un "no te
	// alcanza" que nadie puede arreglar poniendo mas saldo. Y una llave sin
	// fila, o con fila 'failed' o 'pending', no responde nada: su asiento no
	// confirmo, el activo sigue entero y ahi la comprobacion dice la verdad.
	if errSaldo := s.saldoAlcanza(ctx, userID, req.Asset, req.Amount); errSaldo != nil {
		responde, err := s.tx.LlaveYaTieneRespuesta(ctx, userID, pedido)
		if err != nil {
			return nil, err
		}
		if !responde {
			return nil, errSaldo
		}
	}

	fila, err := s.tx.CreateTransaction(ctx, userID, pedido)
	if err != nil {
		return nil, fmt.Errorf("sell %s: %w", req.Asset, err)
	}
	return s.anotado(ctx, userID, fila, venta), nil
}

// anotado devuelve el movimiento de cripto que cuelga de la fila `fila` del
// libro, tal como quedo en la base.
//
// Se lee en vez de devolver lo calculado en esta llamada porque, si fue la
// repeticion de un movimiento que ya confirmo, el gancho no corrio aqui y lo
// que vale es lo que se anoto aquella vez, con su precio. Si la lectura falla,
// el dinero igual ya se movio: se responde exito con lo calculado y el id de la
// fila, no un error que invite a reintentar.
func (s *Service) anotado(ctx context.Context, userID string, fila *transaction.TransactionRecord, calculado *TransactionRecord) *TransactionRecord {
	if mov, err := s.repo.GetTransaction(ctx, userID, fila.ID); err == nil {
		return mov
	}
	calculado.ID = fila.ID
	if calculado.CreatedAt.IsZero() {
		calculado.CreatedAt = fila.CreatedAt
	}
	return calculado
}

func (s *Service) Convert(ctx context.Context, userID string, req *ConvertRequest) (*TransactionRecord, error) {
	if err := validarCantidad(req.FromAmount); err != nil {
		return nil, err
	}

	llave := req.IdempotencyKey
	if llave == "" {
		llave = "crypto:convert:" + uuid.New().String()
	}

	// La comprobacion de cortesia del saldo, en el mismo orden que la del
	// envio (ver Send): primero el saldo, y la llave solo si no alcanza. Un
	// reintento de una conversion que ya se hizo encuentra el saldo gastado; si
	// su llave ya tiene movimiento, sigue de largo hasta la relectura de
	// ConvertirEnUnaTx, que devuelve la conversion hecha en vez de un "no te
	// alcanza".
	if errSaldo := s.saldoAlcanza(ctx, userID, req.FromAsset, req.FromAmount); errSaldo != nil {
		previo, err := s.repo.MovimientoPorLlave(ctx, userID, req.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		if previo == nil {
			return nil, errSaldo
		}
	}

	// Cuanto se recibe del otro activo lo decide la relacion entre los dos
	// precios de mercado, no el cliente: si no, convertir era acreditarse el
	// activo que uno quisiera en la cantidad que quisiera.
	precioOrigen, err := s.precioEn(ctx, req.FromAsset, "USD")
	if err != nil {
		return nil, err
	}
	precioDestino, err := s.precioEn(ctx, req.ToAsset, "USD")
	if err != nil {
		return nil, err
	}
	cantidadDestino := req.FromAmount.Mul(precioOrigen).Div(precioDestino)
	if !cantidadDestino.IsPositive() {
		return nil, fmt.Errorf("%w: from_amount too small to convert into %s", ErrMontoInvalido, req.ToAsset)
	}

	tx := &TransactionRecord{
		ID:             uuid.New().String(),
		UserID:         userID,
		Type:           "convert",
		Asset:          fmt.Sprintf("%s→%s", req.FromAsset, req.ToAsset),
		Amount:         req.FromAmount,
		Price:          precioDestino,
		Total:          cantidadDestino,
		Currency:       req.ToAsset,
		Status:         "completed",
		IdempotencyKey: llave,
	}
	// Los dos activos y el movimiento, en una sola transaccion. Antes eran tres
	// escrituras sueltas: si fallaba la del activo de destino, el de origen ya
	// estaba descontado y no llegaba nada a cambio.
	toName := getAssetName(req.ToAsset)
	hecho, repetido, err := s.repo.ConvertirEnUnaTx(ctx, userID,
		req.FromAsset, req.ToAsset, toName,
		req.FromAmount, cantidadDestino, precioDestino, tx)
	if err != nil {
		return nil, err
	}
	if repetido {
		// Se devuelve la conversion como se hizo, con lo que se recibio
		// entonces: si el precio se movio desde el primer toque, recalcular
		// diria que llego otra cantidad de la que llego.
		if err := mismaOperacion(hecho, tx); err != nil {
			return nil, err
		}
		return hecho, nil
	}

	return tx, nil
}

// mismaOperacion comprueba que el movimiento ya escrito bajo una llave sea el
// que se esta pidiendo: el mismo tipo, el mismo activo (en la conversion, el
// par) y la misma cantidad. El precio y lo recibido no entran: un reintento
// legitimo llega con el precio ya movido.
//
// El tipo entra porque el indice unico de la llave abarca todos los
// movimientos: la llave de una conversion usada para apartar no es un
// reintento del apartado.
func mismaOperacion(hecho, pedido *TransactionRecord) error {
	if hecho == nil {
		return fmt.Errorf("%w: la llave ya se uso", ErrLlaveDeOtraOperacion)
	}
	if hecho.Type != pedido.Type ||
		hecho.Asset != pedido.Asset ||
		!hecho.Amount.Equal(pedido.Amount) ||
		hecho.CounterpartyUserID != pedido.CounterpartyUserID {
		return ErrLlaveDeOtraOperacion
	}
	return nil
}

func (s *Service) GetStakingPositions(ctx context.Context, userID string) ([]StakingRecord, error) {
	return s.repo.GetStakingPositions(ctx, userID)
}

// Server-side staking rates: the client-sent APY is ignored so a caller can
// never inflate the recorded rate. These are the program's target rates;
// earnings accrual is not live yet (Earned stays zero until it is).
//
// El mapa es tambien la lista de lo que se puede stakear: un activo que no
// esta aqui se rechaza. USDT y USDC salieron por decision del dueno: anunciar
// rendimiento sobre monedas atadas al dolar roza la captacion, y ademas nadie
// podia conseguirlas —no se cotizan ni se venden en la aplicacion—. Antes,
// cualquier activo fuera del mapa se aceptaba con tasa cero. Las posiciones
// que ya existan de un activo retirado se siguen listando y retirando: quitar
// la oferta no es quedarse con lo apartado.
var stakingAPY = map[string]float64{
	"ETH": 4.5,
	"SOL": 7.2,
}

func (s *Service) Stake(ctx context.Context, userID string, req *StakeRequest) (*StakingRecord, error) {
	apy, disponible := stakingAPY[req.Asset]
	if !disponible {
		return nil, fmt.Errorf("%w: %s", ErrStakingNoDisponible, req.Asset)
	}
	if err := validarCantidad(req.Amount); err != nil {
		return nil, err
	}

	llave := req.IdempotencyKey
	if llave == "" {
		llave = "crypto:stake:" + uuid.New().String()
	}

	// Cortesia del saldo, en el mismo orden que en Convert y en Send.
	if errSaldo := s.saldoAlcanza(ctx, userID, req.Asset, req.Amount); errSaldo != nil {
		previo, err := s.repo.MovimientoPorLlave(ctx, userID, req.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		if previo == nil {
			return nil, errSaldo
		}
	}

	record := &StakingRecord{
		UserID:    userID,
		Asset:     req.Asset,
		Amount:    req.Amount,
		APY:       apy,
		StartDate: time.Now(),
		Locked:    req.Locked,
		LockDays:  req.LockDays,
		Earned:    decimal.Zero,
		Status:    "active",
	}
	// El descuento del activo y la posicion, juntos: sueltos, un fallo al
	// escribir la posicion dejaba el saldo apartado sin nada que lo respalde.
	hecho, repetido, err := s.repo.ApartarParaStakingEnUnaTx(ctx, record, llave)
	if err != nil {
		return nil, err
	}
	if repetido {
		return s.posicionYaAbierta(ctx, userID, hecho, req)
	}

	return record, nil
}

// posicionYaAbierta resuelve el reintento de un apartado: la llave ya tiene
// movimiento, y lo que se devuelve es la posicion que ese movimiento abrio
// (comparten id).
//
// El plazo se compara contra la posicion y no contra el movimiento, que no lo
// guarda: la misma llave con el mismo activo y la misma cantidad, pero a plazo
// en vez de flexible, es otra posicion, y devolver la flexible seria decir
// "listo" por algo que nunca se hizo.
func (s *Service) posicionYaAbierta(ctx context.Context, userID string, hecho *TransactionRecord, req *StakeRequest) (*StakingRecord, error) {
	if err := mismaOperacion(hecho, movimientoDeStaking(userID, "stake", req.Asset, req.Amount)); err != nil {
		return nil, err
	}
	pos, err := s.repo.GetStakingByID(ctx, hecho.ID, userID)
	if err != nil {
		// Un reintento no aparta dos veces aunque esto falle —la llave ya
		// esta escrita—, asi que el error puede salir tal cual: el proximo
		// intento vuelve a caer en la relectura.
		return nil, fmt.Errorf("stake %s: releer la posicion %s: %w", req.Asset, hecho.ID, err)
	}
	if pos.Locked != req.Locked || pos.LockDays != req.LockDays {
		return nil, ErrLlaveDeOtraOperacion
	}
	// La llave sobrevive a su posicion: la pantalla la conserva mientras la
	// persona reintenta, y un retiro no la descarta. Devolver la posicion
	// retirada seria contestar "listo" por algo que ya no esta apartado.
	if pos.Status != "active" {
		return nil, ErrApartadoYaRetirado
	}
	return pos, nil
}

func (s *Service) Unstake(ctx context.Context, userID, positionID string) error {
	// Un id que no es UUID no puede ser una posicion: sin esto llegaba a la
	// base y volvia como un error de sintaxis. A la base va la forma canonica,
	// porque uuid.Parse acepta escrituras (urn:uuid:...) que Postgres no.
	id, err := uuid.Parse(positionID)
	if err != nil {
		return ErrPosicionNoEncontrada
	}
	positionID = id.String()
	pos, err := s.repo.GetStakingByID(ctx, positionID, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPosicionNoEncontrada
	}
	if err != nil {
		return fmt.Errorf("read staking position: %w", err)
	}
	if pos.Status != "active" {
		return ErrPosicionNoActiva
	}
	if pos.Locked {
		unlockAt := pos.StartDate.AddDate(0, 0, pos.LockDays)
		if time.Now().Before(unlockAt) {
			return fmt.Errorf("%w until %s", ErrPosicionBloqueada, unlockAt.Format("2006-01-02"))
		}
	}
	return s.repo.CompleteStakingAndRelease(ctx, positionID, userID)
}

func (s *Service) GetPriceAlerts(ctx context.Context, userID string) ([]PriceAlertRecord, error) {
	return s.repo.GetPriceAlerts(ctx, userID)
}

// AddPriceAlert crea una alerta activa. Del pedido solo se toman el activo, el
// precio objetivo y la direccion: el id, el dueno, el estado y las fechas los
// pone el servidor. Antes se guardaba el cuerpo tal cual, y un id del cliente
// podia chocar con otra fila o no ser un UUID.
func (s *Service) AddPriceAlert(ctx context.Context, userID string, req *CrearAlertaRequest) (*PriceAlertRecord, error) {
	alert := &PriceAlertRecord{
		Asset:       req.Asset,
		TargetPrice: req.TargetPrice,
		Direction:   req.Direction,
	}
	if err := s.validarAlerta(ctx, alert); err != nil {
		return nil, err
	}
	alert.UserID = userID
	if err := s.repo.AddPriceAlert(ctx, alert); err != nil {
		return nil, err
	}
	alert.Active = true
	alert.Status = AlertaActiva
	return alert, nil
}

func (s *Service) RemovePriceAlert(ctx context.Context, userID, alertID string) error {
	// Quitar una alerta que no existe no hace nada y responde exito; un id que
	// no es UUID tampoco puede existir, asi que se trata igual en vez de
	// dejarlo llegar a la base. A la base va la forma canonica.
	id, err := uuid.Parse(alertID)
	if err != nil {
		return nil
	}
	return s.repo.DeactivatePriceAlert(ctx, id.String(), userID)
}

func (s *Service) GetPrices(ctx context.Context, symbols []string) (map[string]*PriceData, error) {
	return s.prices.GetPrices(ctx, symbols)
}

func getAssetName(symbol string) string {
	names := map[string]string{
		"BTC":   "Bitcoin",
		"ETH":   "Ethereum",
		"SOL":   "Solana",
		"ADA":   "Cardano",
		"DOT":   "Polkadot",
		"AVAX":  "Avalanche",
		"LINK":  "Chainlink",
		"MATIC": "Polygon",
		"UNI":   "Uniswap",
		"ATOM":  "Cosmos",
	}
	if name, ok := names[symbol]; ok {
		return name
	}
	return symbol
}
