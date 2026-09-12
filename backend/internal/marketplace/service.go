package marketplace

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// HistoryRecorder makes a marketplace charge visible in the user's transaction
// list. Best-effort: failing to record never fails the order.
// HistoryRecorder anota el movimiento en el historial del usuario y presta el
// control de tope diario del servicio de transacciones. Van juntas: lo que
// debita la billetera tiene que anotarse donde el tope se cuenta Y consultar
// ese mismo tope, o el tope deja de significar lo que dice.
type HistoryRecorder interface {
	RecordHistory(ctx context.Context, userID string, req *transaction.CreateTransactionRequest) error
	CheckLimits(ctx context.Context, userID, currency string, amountMinor int64) error
	// Las versiones que corren dentro de la transaccion del asiento. Ver
	// chargeWallet: el cobro, la fila del pedido o del viaje y el historial se
	// confirman juntos o no se confirman.
	RecordHistoryEnTx(ctx context.Context, tx pgx.Tx, userID, walletID string, req *transaction.CreateTransactionRequest) error
	CheckLimitsEnTx(ctx context.Context, tx pgx.Tx, userID, currency string, amountMinor int64) error
}

// ErrSinIntegracion se devuelve al intentar COBRAR un viaje o un pedido sin
// integracion con el socio.
//
// El precio del viaje lo inventa este mismo archivo (rand) y el chofer sale
// de una lista fija: cobrarlo debita la billetera de verdad contra un monto
// que nadie cotizo, deja la plata en SYSTEM:EXTERNAL y no hay reverso. Es la
// politica que el repositorio ya aplica en sinpe.Send (se niega a enviar a
// quien no es usuario) y en el registro de rieles de payouts (no se registra
// el de prueba en produccion porque debita y no desembolsa). Pedir el viaje y
// verlo sigue funcionando: lo que se rechaza es el cobro.
var ErrSinIntegracion = errors.New("sin integracion con el socio: el cobro no se puede entregar")

type Service struct {
	repo    *Repository
	ledger  *ledger.Engine
	history HistoryRecorder
	// cobros habilita el debito. Falso mientras el precio y el socio sean
	// simulados; se enciende por entorno igual que los rieles de payouts.
	cobros bool
}

// Options configura el servicio. CobrosActivos solo debe ser verdadero donde
// exista una integracion real que cotice y entregue.
type Options struct {
	CobrosActivos bool
}

func NewService(repo *Repository, eng *ledger.Engine, history HistoryRecorder, opts *Options) *Service {
	s := &Service{repo: repo, ledger: eng, history: history}
	if opts != nil {
		s.cobros = opts.CobrosActivos
	}
	return s
}

// chargeWallet debita la billetera por un pedido o un viaje, contra
// SYSTEM:EXTERNAL (la contraparte del socio). La liquidacion al socio necesita
// una integracion y no existe; esto deja el gasto real registrado.
//
// idemKey es la llave de idempotencia del asiento: una llave ESTABLE (por
// viaje) hace que un cobro repetido choque en el libro y no debite dos veces.
//
// enTx es la escritura del modulo —confirmar el viaje, insertar el pedido— y
// corre DENTRO de la transaccion del asiento, junto con el tope y la fila del
// historial. Antes el cobro se confirmaba primero y lo demas iba despues, por
// fuera: si el pedido no se podia insertar, la persona quedaba cobrada sin
// pedido, y el historial se escribia con el error descartado.
func (s *Service) chargeWallet(
	ctx context.Context, userID string, amountMinor int64, label, idemKey string,
	enTx func(ctx context.Context, tx pgx.Tx) error,
) error {
	// Una sola guarda cubre viaje y pedido: los dos cobros pasan por aqui.
	if !s.cobros {
		return ErrSinIntegracion
	}
	if amountMinor <= 0 {
		return nil
	}
	bal, err := s.repo.WalletBalance(ctx, userID, "CRC")
	if err != nil {
		return fmt.Errorf("balance check: %w", err)
	}
	if bal < amountMinor {
		return fmt.Errorf("insufficient balance")
	}
	// Mismo tope que las transferencias y el escrow. Esta es la comprobacion
	// rapida; la que decide corre dentro del asiento, donde dos cobros
	// simultaneos ya no pueden leer la misma suma.
	if s.history != nil {
		if err := s.history.CheckLimits(ctx, userID, "CRC", amountMinor); err != nil {
			return err
		}
	}
	if _, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    label,
		IdempotencyKey: idemKey,
		TxID:           uuid.NewString(),
		CreatedBy:      userID,
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: userID}, Side: ledger.Debit, AmountMinor: amountMinor, Currency: "CRC"},
			{Account: ledger.Account{SystemCode: ledger.SystemExternalCRC}, Side: ledger.Credit, AmountMinor: amountMinor, Currency: "CRC"},
		},
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			// El tope antes de anotar el propio cobro, o la suma lo contaria
			// dos veces.
			if s.history != nil {
				if err := s.history.CheckLimitsEnTx(ctx, tx, userID, "CRC", amountMinor); err != nil {
					return err
				}
			}
			if enTx != nil {
				if err := enTx(ctx, tx); err != nil {
					return err
				}
			}
			if s.history != nil {
				return s.history.RecordHistoryEnTx(ctx, tx, userID, "", &transaction.CreateTransactionRequest{
					Type:             "marketplace",
					Amount:           amountMinor,
					Currency:         "CRC",
					CounterpartyType: "marketplace",
					CounterpartyName: label,
					Description:      label,
					IdempotencyKey:   idemKey,
				})
			}
			return nil
		},
	}); err != nil {
		if errors.Is(err, ledger.ErrIdempotent) {
			// Ya se cobro con esta llave, y con el cobro —en la misma
			// transaccion— se escribio lo demas.
			return nil
		}
		if errors.Is(err, transaction.ErrDailyLimitExceeded) {
			return transaction.ErrDailyLimitExceeded
		}
		if errors.Is(err, transaction.ErrMonthlyLimitExceeded) {
			return transaction.ErrMonthlyLimitExceeded
		}
		if errors.Is(err, errViajeNoConfirmable) {
			return errViajeNoConfirmable
		}
		return fmt.Errorf("marketplace charge: %w", err)
	}
	return nil
}

// ConfirmRide charges the rider the estimated price and marks the ride confirmed.
func (s *Service) ConfirmRide(ctx context.Context, userID, rideID string) (*RideRequestRecord, error) {
	// Antes de leer nada: sin integracion no hay cobro, y confirmar un viaje
	// es exactamente el paso que cobra.
	if !s.cobros {
		return nil, ErrSinIntegracion
	}
	ride, err := s.repo.GetRideRequest(ctx, rideID, userID) // scoped: non-owner -> not found
	if err != nil {
		return nil, fmt.Errorf("ride not found")
	}
	if ride.Status != "searching" {
		return nil, fmt.Errorf("ride already confirmed")
	}
	// Llave estable por viaje: una confirmacion repetida (reintento, llamada
	// concurrente) choca en el libro y no debita dos veces.
	//
	// La confirmacion del viaje va DENTRO del asiento. Antes se cobraba primero
	// y se confirmaba despues, por fuera: si ese UPDATE fallaba, el viaje
	// quedaba cobrado y sin confirmar. Ahora un viaje que ya no se puede
	// confirmar (otra confirmacion gano) revierte el cobro.
	if err := s.chargeWallet(ctx, userID, ride.EstimatedPrice, "Viaje "+ride.PartnerCode, "marketplace:ride:"+rideID,
		func(ctx context.Context, tx pgx.Tx) error {
			return s.repo.ConfirmRideRowEnTx(ctx, tx, rideID)
		}); err != nil {
		return nil, err
	}
	// Return the live status (the trip clock just started, so 'arriving' with the
	// full ETA), consistent with what the tracker reads on its next poll.
	ride.Status = "confirmed"
	ride.ElapsedSeconds = 0
	applyLiveRideStatus(ride)
	return ride, nil
}

// ── Partners ─────────────────────────────────────────────────────────────────

func (s *Service) GetPartners(ctx context.Context, userID string) ([]PartnerRecord, []string, error) {
	partners, err := s.repo.GetPartners(ctx)
	if err != nil {
		return nil, nil, err
	}

	connected, err := s.repo.GetConnectedPartners(ctx, userID)
	if err != nil {
		return nil, nil, err
	}

	return partners, connected, nil
}

func (s *Service) ConnectPartner(ctx context.Context, userID, partnerCode string) error {
	return s.repo.ConnectPartner(ctx, userID, partnerCode)
}

func (s *Service) DisconnectPartner(ctx context.Context, userID, partnerCode string) error {
	return s.repo.DisconnectPartner(ctx, userID, partnerCode)
}

// ── Ride Requests ────────────────────────────────────────────────────────────

// driverProfile is a simulated partner driver. Real driver matching happens on
// the partner's platform; until that integration exists we assign a believable
// driver at request time so the ride is complete end-to-end (the rider sees a
// real driver, vehicle and plate persisted with the ride).
type driverProfile struct {
	Name   string
	Car    string
	Plate  string
	Rating float64
}

var driverPool = []driverProfile{
	{"Carlos Ramírez", "Toyota Corolla", "SJB-412", 4.92},
	{"María Fernández", "Hyundai Elantra", "BCR-738", 4.88},
	{"José Mora", "Nissan Sentra", "CLM-193", 4.95},
	{"Ana Solís", "Kia Rio", "MOT-264", 4.81},
	{"Luis Vargas", "Honda Civic", "SJP-590", 4.90},
	{"Daniela Castro", "Toyota Yaris", "BMV-117", 4.97},
	{"Roberto Jiménez", "Mazda 3", "CRC-845", 4.86},
	{"Marcela Rojas", "Suzuki Swift", "GTO-301", 4.93},
}

func (s *Service) CreateRideRequest(ctx context.Context, userID string, req *CreateRideRequest) (*RideRequestRecord, error) {
	if req.Pickup == "" || req.Destination == "" {
		return nil, fmt.Errorf("pickup and destination are required")
	}

	// Simulate estimated price (2500-15000 CRC) and time
	estimatedPrice := int64(2500+rand.Intn(12500)) * 100 // in centimos
	estimatedMins := 8 + rand.Intn(25)
	distance := fmt.Sprintf("%.1f km", 1.5+rand.Float64()*15.0)
	driver := driverPool[rand.Intn(len(driverPool))]

	ride := &RideRequestRecord{
		ID:             uuid.New().String(),
		UserID:         userID,
		PartnerCode:    req.PartnerCode,
		Pickup:         req.Pickup,
		Destination:    req.Destination,
		EstimatedPrice: estimatedPrice,
		EstimatedTime:  fmt.Sprintf("%d min", estimatedMins),
		Distance:       distance,
		Status:         "searching",
		DriverName:     driver.Name,
		DriverRating:   driver.Rating,
		DriverCar:      driver.Car,
		DriverPlate:    driver.Plate,
		CreatedAt:      time.Now(),
	}

	if err := s.repo.CreateRideRequest(ctx, ride); err != nil {
		return nil, err
	}

	return ride, nil
}

// Live trip progress after confirmation. Like the food order, status is a
// deterministic function of elapsed time vs the trip ETA, anchored on creation
// (the rider confirms within seconds of requesting). Only confirmed/arriving/
// in_progress rides progress; searching (unconfirmed) and terminal states are
// returned as stored. Keep these fractions in sync with the mock adapter
// (src/api/adapters/mock/marketplace.mock.ts).
const (
	rideFracInProgress = 0.15 // arriving -> in_progress (driver reaches pickup)
	rideFracCompleted  = 1.00 // in_progress -> completed
)

// deriveRideStatus returns the live status for a confirmed ride from its
// DB-computed ElapsedSeconds and ETA. searching (unconfirmed) and terminal
// states (completed, cancelled) are returned verbatim.
func deriveRideStatus(ride *RideRequestRecord) string {
	switch ride.Status {
	case "searching", "completed", "cancelled":
		return ride.Status
	}
	totalSecs := float64(parseEtaMinutes(ride.EstimatedTime) * 60)
	if totalSecs <= 0 {
		return "completed"
	}
	switch f := float64(ride.ElapsedSeconds) / totalSecs; {
	case f < rideFracInProgress:
		return "arriving"
	case f < rideFracCompleted:
		return "in_progress"
	default:
		return "completed"
	}
}

// applyLiveRideStatus mutates the record: sets the live status and the minutes
// left until arrival at the destination.
func applyLiveRideStatus(ride *RideRequestRecord) {
	ride.Status = deriveRideStatus(ride)
	if ride.Status != "arriving" && ride.Status != "in_progress" {
		ride.MinutesRemaining = 0
		return
	}
	remaining := parseEtaMinutes(ride.EstimatedTime) - int(ride.ElapsedSeconds/60)
	if remaining < 0 {
		remaining = 0
	}
	ride.MinutesRemaining = remaining
}

func (s *Service) GetRideRequest(ctx context.Context, rideID, userID string) (*RideRequestRecord, error) {
	ride, err := s.repo.GetRideRequest(ctx, rideID, userID)
	if err != nil {
		return nil, err
	}
	wasNonTerminal := ride.Status != "completed" && ride.Status != "cancelled"
	applyLiveRideStatus(ride)
	// Once the trip is due, persist completed so it survives without the tracker
	// open. Best-effort and idempotent (guarded UPDATE, no money moves).
	if wasNonTerminal && ride.Status == "completed" {
		mins := parseEtaMinutes(ride.EstimatedTime)
		_ = s.repo.MarkRideCompletedIfDue(ctx, ride.ID, mins)
		t := ride.CreatedAt.Add(time.Duration(mins) * time.Minute)
		ride.CompletedAt = &t
	}
	return ride, nil
}

// UpdateRideStatus mueve el estado de un viaje que YA paso por el cobro.
//
// 'confirmed' salio de la lista: confirmar es el paso que cobra, y su unico
// camino es POST /marketplace/rides/{id}/confirm. Mientras estuvo aqui, un
// PATCH dejaba el viaje confirmado GRATIS, y ConfirmRide despues lo rechazaba
// con "ride already confirmed" — o sea que ese viaje ya no se podia cobrar
// nunca mas. Los demas destinos existen pero no pueden aplicarse a un viaje que
// sigue en 'searching', porque llevarlo a 'in_progress' o 'completed' por esta
// via es el mismo agujero con otro nombre.
//
// 'searching' tampoco es destino valido: devolver un viaje confirmado a ese
// estado lo dejaria listo para confirmarse otra vez.
func (s *Service) UpdateRideStatus(ctx context.Context, rideID, status string) error {
	validStatuses := map[string]bool{
		"arriving": true, "in_progress": true, "completed": true, "cancelled": true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid ride status: %s", status)
	}
	// Cancelar un viaje que todavia busca chofer es legitimo: no se cobro nada
	// y no hay nada que entregar.
	if status == "cancelled" {
		return s.repo.UpdateRideStatus(ctx, rideID, status)
	}
	return s.repo.UpdateRideStatusPagado(ctx, rideID, status)
}

func (s *Service) ListUserRides(ctx context.Context, userID string) ([]RideRequestRecord, error) {
	rides, err := s.repo.ListUserRides(ctx, userID, 50)
	if err != nil {
		return nil, err
	}
	// Override status in memory only (no per-row writes inside the list path);
	// the single-ride GetRideRequest persists the completed backfill.
	for i := range rides {
		applyLiveRideStatus(&rides[i])
	}
	return rides, nil
}

// ── Food Orders ──────────────────────────────────────────────────────────────

func (s *Service) CreateFoodOrder(ctx context.Context, userID string, req *CreateFoodOrderRequest) (*FoodOrderRecord, error) {
	// Igual que ConfirmRide: crear el pedido es el paso que cobra.
	if !s.cobros {
		return nil, ErrSinIntegracion
	}
	if req.RestaurantName == "" || len(req.Items) == 0 {
		return nil, fmt.Errorf("restaurant name and at least one item required")
	}

	var subtotal int64
	var items []FoodOrderItemRecord
	for _, item := range req.Items {
		subtotal += item.Price * int64(item.Quantity)
		items = append(items, FoodOrderItemRecord{
			ID:       uuid.New().String(),
			Name:     item.Name,
			Quantity: item.Quantity,
			Price:    item.Price,
		})
	}

	deliveryFee := int64(150000) // 1500 CRC in centimos
	total := subtotal + deliveryFee

	estimatedMins := 25 + rand.Intn(20)

	order := &FoodOrderRecord{
		ID:                uuid.New().String(),
		UserID:            userID,
		PartnerCode:       req.PartnerCode,
		RestaurantName:    req.RestaurantName,
		Subtotal:          subtotal,
		DeliveryFee:       deliveryFee,
		Total:             total,
		Status:            "preparing",
		EstimatedDelivery: fmt.Sprintf("%d min", estimatedMins),
		MinutesRemaining:  estimatedMins,
		CreatedAt:         time.Now(),
	}

	// El pedido se inserta DENTRO del asiento del cobro. Antes se cobraba
	// primero y el pedido se insertaba despues, en otra transaccion: si el
	// insert fallaba, la persona quedaba cobrada SIN pedido. La llave del cobro
	// es la del pedido, asi que ademas un mismo pedido no se puede cobrar dos
	// veces.
	if err := s.chargeWallet(ctx, userID, total, "Pedido "+req.RestaurantName, "marketplace:pedido:"+order.ID,
		func(ctx context.Context, tx pgx.Tx) error {
			return insertarPedido(ctx, tx, order, items)
		}); err != nil {
		return nil, err
	}

	return order, nil
}

// Live delivery progress. The order status is a deterministic function of the
// elapsed fraction of its ETA, so every device (and the history list) computes
// the same status for the same instant. Keep these fractions in sync with the
// mock adapter (src/api/adapters/mock/marketplace.mock.ts).
const (
	foodFracReady     = 0.40 // preparing -> ready
	foodFracOnTheWay  = 0.75 // ready -> on_the_way
	foodFracDelivered = 1.00 // on_the_way -> delivered
)

// parseEtaMinutes reads the leading integer of an "NN min" / "NN-MM min" string.
// Falls back to 30 when empty/unparseable and clamps to a >=1 floor.
func parseEtaMinutes(s string) int {
	n := 0
	seen := false
	for _, r := range s {
		if r < '0' || r > '9' {
			if seen {
				break
			}
			continue
		}
		seen = true
		n = n*10 + int(r-'0')
	}
	if !seen || n < 1 {
		return 30
	}
	return n
}

// deriveFoodStatus returns the live status for a non-terminal order from its
// DB-computed ElapsedSeconds and ETA. Persisted terminal states (delivered,
// cancelled) are returned verbatim and never resurrected.
func deriveFoodStatus(o *FoodOrderRecord) string {
	if o.Status == "delivered" || o.Status == "cancelled" {
		return o.Status
	}
	totalSecs := float64(parseEtaMinutes(o.EstimatedDelivery) * 60)
	if totalSecs <= 0 {
		return "delivered"
	}
	switch f := float64(o.ElapsedSeconds) / totalSecs; {
	case f < foodFracReady:
		return "preparing"
	case f < foodFracOnTheWay:
		return "ready"
	case f < foodFracDelivered:
		return "on_the_way"
	default:
		return "delivered"
	}
}

// applyLiveStatus mutates the record in place: sets the live status and the
// minutes left until delivery. Terminal orders are left as stored.
func applyLiveStatus(o *FoodOrderRecord) {
	o.Status = deriveFoodStatus(o)
	if o.Status == "delivered" || o.Status == "cancelled" {
		o.MinutesRemaining = 0
		return
	}
	remaining := parseEtaMinutes(o.EstimatedDelivery) - int(o.ElapsedSeconds/60)
	if remaining < 0 {
		remaining = 0
	}
	o.MinutesRemaining = remaining
}

// courierPool is a fixed roster of simulated delivery couriers (motorbikes).
type courierProfile = CourierInfo

var courierPool = []courierProfile{
	{"Diego Salas", "Honda CB125", "MOT-118"},
	{"Karla Méndez", "Yamaha YBR", "MOT-204"},
	{"Esteban Núñez", "Vespa Primavera", "MOT-377"},
	{"Priscilla Vega", "Suzuki GN125", "MOT-461"},
	{"Andrés Quirós", "Bajaj Pulsar", "MOT-529"},
	{"Natalia Brenes", "Honda Wave", "MOT-642"},
}

// deriveCourier picks a courier deterministically from the order id (stable
// across every read — a random pick would flicker between polls).
func deriveCourier(orderID string) courierProfile {
	h := fnv.New32a()
	_, _ = h.Write([]byte(orderID))
	// uint32 -> int is widening on the 64-bit server target, so the index stays
	// in range without a narrowing conversion of len().
	return courierPool[int(h.Sum32())%len(courierPool)]
}

// CourierFor returns the order's courier once it is on the way or delivered,
// and nil before that (the courier is not yet visible to the rider).
func (s *Service) CourierFor(orderID, status string) *CourierInfo {
	if status != "on_the_way" && status != "delivered" {
		return nil
	}
	c := deriveCourier(orderID)
	return &c
}

func (s *Service) GetFoodOrder(ctx context.Context, orderID, userID string) (*FoodOrderRecord, []FoodOrderItemRecord, error) {
	order, items, err := s.repo.GetFoodOrder(ctx, orderID, userID)
	if err != nil {
		return nil, nil, err
	}
	if order.Status != "delivered" && order.Status != "cancelled" {
		applyLiveStatus(order)
		// Once due, persist the terminal state so it survives without the tracker
		// open. Best-effort and idempotent (guarded UPDATE, no money moves).
		if order.Status == "delivered" {
			mins := parseEtaMinutes(order.EstimatedDelivery)
			_ = s.repo.MarkFoodOrderDeliveredIfDue(ctx, order.ID, mins)
			t := order.CreatedAt.Add(time.Duration(mins) * time.Minute)
			order.CompletedAt = &t
		}
	}
	return order, items, nil
}

func (s *Service) UpdateFoodOrderStatus(ctx context.Context, orderID, status string) error {
	validStatuses := map[string]bool{
		"preparing": true, "ready": true, "on_the_way": true,
		"delivered": true, "cancelled": true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid food order status: %s", status)
	}
	return s.repo.UpdateFoodOrderStatus(ctx, orderID, status)
}

func (s *Service) ListUserFoodOrders(ctx context.Context, userID string) ([]FoodOrderRecord, error) {
	orders, err := s.repo.ListUserFoodOrders(ctx, userID, 50)
	if err != nil {
		return nil, err
	}
	// Override status in memory only (no per-row writes inside the list path);
	// the single-order GetFoodOrder persists the terminal backfill.
	for i := range orders {
		applyLiveStatus(&orders[i])
	}
	return orders, nil
}
