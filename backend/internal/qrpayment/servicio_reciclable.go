package qrpayment

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ── La identidad permanente ─────────────────────────────────────────────────

// GetOrCreateMyCode devuelve el codigo permanente de una persona en una moneda,
// creandolo la primera vez que abre "Cobrar".
//
// Las personas no se backfillean en la migracion —son muchas y la mayoria nunca
// va a cobrar—, asi que el codigo nace aqui, perezosamente.
func (s *Service) GetOrCreateMyCode(ctx context.Context, userID, currency string) (*QRPaymentCode, error) {
	return s.repo.GetOrCreateStaticCode(ctx, userID, "", "", currency, "p2p_receive")
}

// GetOrCreateMerchantCode devuelve el codigo del mostrador. Es el que se imprime
// y se pega: no cambia jamas.
func (s *Service) GetOrCreateMerchantCode(
	ctx context.Context, userID, merchantID, locationID, currency string,
) (*QRPaymentCode, error) {
	// Cualquier miembro del equipo puede cobrar para el local: la plata cae en
	// la billetera DEL COMERCIO, asi que un cajero generando el rotulo no mueve
	// nada a su propio bolsillo.
	role, merchant, err := s.roleFor(ctx, merchantID, userID)
	if err != nil {
		return nil, fmt.Errorf("merchant profile not found")
	}
	if role == "" {
		return nil, fmt.Errorf("merchant does not belong to user")
	}
	if merchant.VerificationStatus != "verified" {
		return nil, fmt.Errorf("merchant is pending verification")
	}
	if locationID != "" {
		loc, err := s.repo.GetLocation(ctx, merchantID, locationID)
		if err != nil || !loc.Active {
			return nil, fmt.Errorf("location not found")
		}
	}
	// El creator_id del rotulo es el DUENO, no quien toco el boton: el rotulo
	// sobrevive al empleado que lo imprimio.
	return s.repo.GetOrCreateStaticCode(ctx, merchant.UserID, merchantID, locationID, currency, "merchant_dynamic")
}

// RevokeCode retira un codigo permanente propio. Un codigo permanente es un
// identificador estable que circula impreso: el afiche se fotografia, el local
// cierra, el empleado se lleva el rotulo. Sin esta salida, un codigo emitido una
// vez no se puede apagar nunca.
func (s *Service) RevokeCode(ctx context.Context, userID, codeID string) error {
	code, err := s.repo.GetQRCodeByID(ctx, codeID)
	if err != nil {
		return ErrQRInvalido
	}
	if code.MerchantID != "" {
		// El rotulo del local lo retira quien puede cobrar por el.
		role, _, err := s.roleFor(ctx, code.MerchantID, userID)
		if err != nil || role == "" {
			return ErrQRInvalido
		}
		return s.repo.RevocarCodigo(ctx, codeID, code.CreatorID)
	}
	return s.repo.RevocarCodigo(ctx, codeID, userID)
}

// ── Cobros ──────────────────────────────────────────────────────────────────

// CreateCharge emite un cobro sobre un codigo permanente.
//
// Cambiar el monto NO edita la fila: se reemplaza el cobro. El viejo pasa a
// 'superseded', nace el nuevo y queda el rastro de que se pidio 5.000 y luego
// 7.500. En un producto de dinero esa historia vale mas que ahorrarse una fila.
func (s *Service) CreateCharge(ctx context.Context, userID string, req *CreateChargeRequest) (*QRCharge, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	code, err := s.repo.GetQRCodeByID(ctx, req.QRCodeID)
	if err != nil {
		return nil, ErrQRInvalido
	}
	if code.Status != EstadoCodigoActivo {
		return nil, ErrQRRevocado
	}
	if err := s.puedeCobrarCon(ctx, userID, code); err != nil {
		return nil, err
	}

	canal := req.Channel
	if canal != CanalEnlace {
		canal = CanalMostrador
	}
	duracion := DuracionCobroMostrador
	if canal == CanalEnlace {
		duracion = DuracionCobroEnlace
	}
	// La moneda la fija el codigo, nunca el pedido: es la misma regla que impide
	// que un pagador salde una factura en dolares con colones.
	moneda := code.Currency

	cobro := &QRCharge{
		ID:         uuid.New().String(),
		QRCodeID:   code.ID,
		MerchantID: code.MerchantID,
		LocationID: code.LocationID,
		CreatedBy:  userID,
		Amount:     req.Amount,
		Currency:   moneda,
		Note:       req.Note,
		Channel:    canal,
		Status:     EstadoCobroPendiente,
		ExpiresAt:  time.Now().Add(duracion),
	}
	tipo := "p2p_request"
	if code.MerchantID != "" {
		tipo = "merchant_fixed"
	}
	// El payload del cobro es PROPIO y lleva el monto adentro, con la forma
	// KP: de siempre. Que sea propio es lo que impide que el cliente de atras en
	// la fila reclame el cobro del de adelante; que lleve el monto es lo que
	// impide que una aplicacion vieja pague algo que no vio.
	cobro.QRData = fmt.Sprintf("KP:%s:%s:%d:%s:x%s", tipo, cobro.ID[:8], cobro.Amount, moneda, generateQRToken())

	if req.Replaces == "" {
		if err := s.repo.CrearCobro(ctx, s.repo.db, cobro); err != nil {
			return nil, err
		}
		return cobro, nil
	}

	// El cobro que se reemplaza tiene que colgar del MISMO codigo. Sin esta
	// comprobacion, cualquiera con un codigo propio podria cerrar el cobro de
	// otro con solo conocer su id.
	viejo, err := s.repo.GetCharge(ctx, req.Replaces)
	if err != nil || viejo.QRCodeID != code.ID {
		return nil, ErrQRInvalido
	}

	// Reemplazo: cerrar el viejo y abrir el nuevo en una transaccion. Si el
	// viejo ya se pago, NO se crea el nuevo — decirle "cancelado" al cajero
	// sobre una venta que acaba de entrar es como se llega a cobrar dos veces.
	tx, err := s.repo.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := s.repo.CerrarCobro(ctx, tx, req.Replaces, EstadoCobroReemplazado, cobro.ID); err != nil {
		return nil, err
	}
	if err := s.repo.CrearCobro(ctx, tx, cobro); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return cobro, nil
}

// CancelCharge cancela un cobro pendiente. Cero filas afectadas se interpreta
// leyendo el estado real: sobre un cobro pagado responde ErrCobroYaPagado y
// nunca "cancelado".
func (s *Service) CancelCharge(ctx context.Context, userID, chargeID string) error {
	cobro, err := s.repo.GetCharge(ctx, chargeID)
	if err != nil {
		return ErrQRInvalido
	}
	if err := s.puedeAdministrarCobro(ctx, userID, cobro); err != nil {
		return err
	}
	return s.repo.CerrarCobro(ctx, s.repo.db, chargeID, EstadoCobroCancelado, "")
}

// GetCharge es el respaldo del WebSocket: con la pantalla del cobro abierta, el
// cajero pregunta cada pocos segundos por si el socket esta caido.
func (s *Service) GetCharge(ctx context.Context, userID, chargeID string) (*QRCharge, error) {
	cobro, err := s.repo.GetCharge(ctx, chargeID)
	if err != nil {
		return nil, ErrQRInvalido
	}
	if err := s.puedeAdministrarCobro(ctx, userID, cobro); err != nil {
		return nil, err
	}
	return cobro, nil
}

func (s *Service) ListCharges(ctx context.Context, userID, estado string) ([]QRCharge, error) {
	return s.repo.ListarCobros(ctx, userID, estado, 50)
}

// puedeCobrarCon: quien emite un cobro sobre un codigo tiene que poder cobrar
// con el.
func (s *Service) puedeCobrarCon(ctx context.Context, userID string, code *QRPaymentCode) error {
	if code.MerchantID == "" {
		if code.CreatorID != userID {
			return ErrQRInvalido
		}
		return nil
	}
	role, merchant, err := s.roleFor(ctx, code.MerchantID, userID)
	if err != nil || role == "" {
		return ErrQRInvalido
	}
	if merchant.VerificationStatus != "verified" {
		return fmt.Errorf("merchant is pending verification")
	}
	return nil
}

func (s *Service) puedeAdministrarCobro(ctx context.Context, userID string, cobro *QRCharge) error {
	if cobro.CreatedBy == userID {
		return nil
	}
	if cobro.MerchantID == "" {
		return ErrQRInvalido
	}
	// Un cajero abre el cobro y se va; el que sigue en la caja tiene que poder
	// cancelarlo. Cualquier miembro del equipo del local sirve.
	role, _, err := s.roleFor(ctx, cobro.MerchantID, userID)
	if err != nil || role == "" {
		return ErrQRInvalido
	}
	return nil
}

// ── Resolucion del payload ──────────────────────────────────────────────────

// objetivo es lo que resuelve una cadena escaneada: o un cobro concreto, o la
// identidad permanente, o una fila vieja.
type objetivo struct {
	code   *QRPaymentCode
	charge *QRCharge
	kind   string // code | charge | legacy
}

// resolverQR enruta por el PRIMER CARACTER del ultimo campo del payload, que no
// es ambiguo porque ni 'i' ni 'x' son digitos hexadecimales:
//
//	i… → identidad permanente (qr_payment_codes)
//	x… → cobro (qr_charges)
//	24 hex sin prefijo → fila vieja, camino de compatibilidad
func (s *Service) resolverQR(ctx context.Context, qrData string) (*objetivo, error) {
	partes := strings.Split(qrData, ":")
	if len(partes) >= 6 && strings.HasPrefix(partes[5], "x") {
		cobro, err := s.repo.GetChargeByData(ctx, qrData)
		if err != nil {
			return nil, ErrQRInvalido
		}
		code, err := s.repo.GetQRCodeByID(ctx, cobro.QRCodeID)
		if err != nil {
			return nil, ErrQRInvalido
		}
		return &objetivo{code: code, charge: cobro, kind: "charge"}, nil
	}

	code, err := s.repo.GetQRCodeByData(ctx, qrData)
	if err != nil {
		return nil, ErrQRInvalido
	}
	kind := "legacy"
	if code.Status == EstadoCodigoActivo {
		kind = "code"
	}
	return &objetivo{code: code, kind: kind}, nil
}

// ResolveQR contesta a QUIEN se le esta por pagar, antes de que la hoja muestre
// un boton de pagar.
//
// Hoy la hoja de pago muestra el monto y NADA sobre quien lo recibe. Con un
// codigo permanente pegado en un mostrador eso deja de ser aceptable: el fraude
// que habilita un rotulo pegado es tapar el de uno con el de otro.
func (s *Service) ResolveQR(ctx context.Context, qrData string) (*ResolvedQR, error) {
	obj, err := s.resolverQR(ctx, qrData)
	if err != nil {
		return nil, err
	}
	if obj.code.Status == EstadoCodigoRevocado {
		return nil, ErrQRRevocado
	}

	res := &ResolvedQR{
		Kind:     obj.kind,
		Currency: obj.code.Currency,
		QRCodeID: obj.code.ID,
	}
	if obj.charge != nil {
		res.Amount = obj.charge.Amount
		res.Note = obj.charge.Note
		res.ChargeID = obj.charge.ID
		res.Status = obj.charge.Status
		exp := obj.charge.ExpiresAt
		res.ExpiresAt = &exp
	} else {
		// Un codigo permanente es siempre de monto abierto; una fila vieja
		// puede traer monto adentro.
		res.Amount = obj.code.Amount
		res.Note = obj.code.Note
		res.ExpiresAt = obj.code.ExpiresAt
	}

	if obj.code.MerchantID != "" {
		if m, err := s.repo.GetMerchant(ctx, obj.code.MerchantID); err == nil {
			res.MerchantName = m.Name
		}
		res.LocationName = s.repo.NombreDeSucursal(ctx, obj.code.LocationID)
	} else {
		res.PayeeName = s.displayName(ctx, obj.code.CreatorID)
	}
	return res, nil
}

// ── El nonce del pagador ────────────────────────────────────────────────────

const nonceMax = 32

// nonceValido: 1..32 caracteres de [A-Za-z0-9._-].
//
// El tope de 32 no es arbitrario. La llave completa mide
// 3+1+36+1+36+1+32 = 110, la pata del receptor le agrega ":recv" para llegar a
// 115, y la columna de transactions es VARCHAR(120). Al libro va la de 110, y
// por eso la migracion 062 amplia journal_postings a 160.
func nonceValido(n string) bool {
	if n == "" || len(n) > nonceMax {
		return false
	}
	for _, c := range n {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '.', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}

const prefijoLlaveQR = "qr2"

// VentanaReplayLegacy: cuanto tiempo despues de un pago se acepta que una
// aplicacion SIN NONCE este reintentando por red en vez de queriendo pagar otra
// vez.
//
// Se descarta a proposito la ventana de 30 segundos: contra un timeout de
// cliente de 20 s, un reintento que cruce el borde cobraria DOS VECES, y el
// doble cobro es la unica falla que un cliente de soda no perdona. Dos minutos
// falla siempre hacia no cobrar de mas.
const VentanaReplayLegacy = 2 * time.Minute

// llaveDePago arma la llave de idempotencia del intento.
//
// La regla, que es una sola: la llave nombra UN INTENTO de UN pagador. Siempre
// lleva el payer_id adentro y siempre lleva algo que cambia entre un pago y el
// siguiente.
//
// Antes era `qr:<qrID>:<payerID>`. Con un codigo reciclable eso significa "este
// pagador le paga a este mostrador UNA VEZ EN LA VIDA": el segundo pago
// encuentra la fila vieja, CreateTransfer la devuelve sin error y la pantalla
// dice "pagado" sin mover un centimo. Hoy no se nota solo porque la pantalla
// genera un QR nuevo en cada toque.
func llaveDePago(obj *objetivo, payerID, nonce string) string {
	if obj.charge != nil {
		// Un cobro es de un solo uso por naturaleza y se reclama atomicamente,
		// asi que no necesita nonce — y no debe aceptarlo: aceptarlo dejaria que
		// un pagador hostil convierta un cobro en dos cargos.
		return prefijoLlaveQR + ":" + obj.charge.ID + ":" + payerID + ":c"
	}
	if nonce != "" {
		return prefijoLlaveQR + ":" + obj.code.ID + ":" + payerID + ":" + nonce
	}
	// Sin nonce (aplicacion vieja) la llave es fija: ese codigo se le puede
	// pagar una sola vez. Es una degradacion hacia cobrar de menos, nunca de
	// mas, y el segundo intento lo dice en voz alta en vez de fingir exito.
	return prefijoLlaveQR + ":" + obj.code.ID + ":" + payerID + ":legacy"
}

// ── El barrido de cobros vencidos ───────────────────────────────────────────

// ExpirarCobrosVencidos lo llama el poller.
func (s *Service) ExpirarCobrosVencidos(ctx context.Context) (int64, error) {
	return s.repo.ExpirarCobrosVencidos(ctx, 500)
}

// avisarCobro le dice al cobrador que le pagaron.
//
// Un mostrador vive de saber "ya entro". En todo el paquete no habia una sola
// llamada a notificaciones: el unico riel que avisaba era SINPE. Con un rotulo
// pegado no hay hoja que cerrar, asi que sin esto el rotulo no sirve.
//
// Va DESPUES del COMMIT y nunca dentro del gancho: la documentacion de
// EnLaMismaTx lo prohibe, porque un reintento por conflicto lo ejecutaria otra
// vez y no hay forma de desenviar un aviso.
func (s *Service) avisarCobro(ctx context.Context, destinos []string, p *QRPaymentRecord) {
	if s.notifier == nil {
		return
	}
	vistos := map[string]bool{}
	cuerpo := fmt.Sprintf("%s %s", p.Currency, formatearMonto(p.Amount))
	if p.Note != "" {
		cuerpo += " — " + p.Note
	}
	for _, uid := range destinos {
		if uid == "" || vistos[uid] {
			continue
		}
		vistos[uid] = true
		_ = s.notifier.NotifyUser(ctx, uid, "Pago recibido", cuerpo, "qr_cobro")
	}
}

func formatearMonto(centimos int64) string {
	return fmt.Sprintf("%d.%02d", centimos/100, centimos%100)
}

// traducirReclamo convierte el "no se pudo reclamar" del gancho en el motivo
// concreto, releyendo el estado del cobro.
func (s *Service) traducirReclamo(ctx context.Context, chargeID string, err error) error {
	if !errors.Is(err, ErrCobroNoReclamable) {
		return err
	}
	cobro, e := s.repo.GetCharge(ctx, chargeID)
	if e != nil {
		return ErrQRInvalido
	}
	switch cobro.Status {
	case EstadoCobroPagado:
		return ErrCobroYaPagado
	case EstadoCobroCancelado:
		return ErrCobroCancelado
	case EstadoCobroReemplazado:
		return ErrCobroReemplazado
	case EstadoCobroVencido:
		return ErrCobroVencido
	}
	// Sigue 'pending' pero no matcheo: vencio entre la lectura y el UPDATE.
	if time.Now().After(cobro.ExpiresAt) {
		return ErrCobroVencido
	}
	return ErrCobroYaPagado
}

// ganchoEnLaMismaTx arma el gancho que corre DENTRO de la transaccion del
// asiento: reclama el cobro (o el codigo viejo de un solo uso) y escribe la
// venta, las dos cosas antes del COMMIT.
//
// El id de la venta se genera FUERA del closure a proposito: Post reintenta
// hasta ocho veces y el closure vuelve a correr sobre una transaccion nueva; con
// el id afuera el resultado es determinista. El txID, en cambio, llega de
// adentro: es la fila del emisor, que CreateTransfer acaba de escribir.
func (s *Service) ganchoEnLaMismaTx(
	obj *objetivo, payment *QRPaymentRecord, payerID string, corrio *bool,
	errDelModulo *error,
) func(context.Context, pgx.Tx, string) error {
	return func(ctx context.Context, tx pgx.Tx, txID string) error {
		payment.TxID = txID
		if obj.charge != nil {
			if err := ReclamarCobroEnTx(ctx, tx, obj.charge.ID, payerID, txID); err != nil {
				*errDelModulo = err
				return err
			}
		} else if obj.code.SingleUse && obj.code.Status != EstadoCodigoActivo {
			// Fila vieja de un solo uso: el mismo reclamo con guarda. Esto
			// arregla el doble pago tambien para los QR que sigan circulando.
			if err := ReclamarLegacyEnTx(ctx, tx, obj.code.ID); err != nil {
				*errDelModulo = err
				return err
			}
		}
		if err := crearPagoEn(ctx, tx, payment); err != nil {
			*errDelModulo = err
			return err
		}
		*corrio = true
		return nil
	}
}
