package crypto

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/shopspring/decimal"
)

// Enviar cripto a otra persona de KiramoPay.
//
// Esta cripto no vive en ninguna cadena: es un saldo en crypto_assets. Asi que
// un envio no es una transaccion de red, es pasar el activo de una fila a otra
// —y por eso el destinatario tiene que ser alguien de KiramoPay, identificado
// escaneando SU codigo QR. No hay "direccion" que poner, porque no hay a donde
// mandarlo fuera de aqui, y la pantalla no puede decir lo contrario.
//
// La comision es de KiramoPay, no "de red": no hay red que cobre nada. Se cobra
// en el MISMO activo y la paga quien envia, asi que a quien recibe le llega
// exactamente lo que vio en la pantalla del que envio.

const (
	// tasaDeComision es la comision de KiramoPay por un envio entre personas:
	// 0,25 % de lo que se envia. Decision del dueno.
	tasaDeComision = "0.0025"
	// porcentajeVisible es la misma comision como porcentaje, para que la
	// pantalla lo muestre sin llevarlo escrito a mano y no pueda desincronizarse
	// del numero con que de verdad se cobra.
	porcentajeVisible = "0.25"
)

var (
	comisionDeEnvio     = decimal.RequireFromString(tasaDeComision)
	comisionEnPorciento = decimal.RequireFromString(porcentajeVisible)
)

var (
	// ErrEnvioNoDisponible: al servicio no se le dio con que resolver un QR, asi
	// que no puede saber a quien le llegaria. Antes que adivinar un destinatario,
	// no se envia.
	ErrEnvioNoDisponible = errors.New("enviar cripto no esta disponible")

	// ErrNoTePodesEnviar: el QR escaneado es el propio. No mueve nada y cobraria
	// la comision, que es cobrar por nada.
	ErrNoTePodesEnviar = errors.New("no podes enviarte cripto a vos mismo")
)

// Destinatarios resuelve de QUIEN es un codigo QR y como se llama una persona.
// Lo satisface *qrpayment.Service, que es quien sabe leer los codigos.
//
// El envio depende de qrpayment a proposito: los codigos QR tienen un solo
// lector en la aplicacion. Un segundo lector aqui seria una segunda definicion
// de que codigos valen, y la primera que se quedara vieja aceptaria codigos
// revocados.
type Destinatarios interface {
	PersonaDelQR(ctx context.Context, qrData string) (*qrpayment.PersonaDelQR, error)
	NombreDe(ctx context.Context, userID string) string
}

// MFAEnforcer exige el segundo factor en montos altos — el mismo contrato que
// usan transaction, escrow y payout.
type MFAEnforcer interface {
	IsMFARequired(amountMinor int64, currency string) bool
	HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error)
}

// UIFReporter recibe el aviso, sin poder fallar la operacion, de que salio
// valor de una cuenta (umbrales de la UIF).
type UIFReporter interface {
	Report(ctx context.Context, userID, txID, currency string, amountMinor int64)
}

// Avisos le dice a quien recibe que le llego algo. Lo satisface
// *notification.Service, el mismo que usan sinpe y los cobros por QR.
type Avisos interface {
	NotifyUser(ctx context.Context, userID, title, body, tag string) error
}

// Logger es la superficie minima de log (compatible con slog); nil esta bien.
type Logger interface {
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

// Opciones lleva los colaboradores del envio. Sin ellos el resto de cripto
// —comprar, vender, convertir, staking, alertas— funciona igual; lo unico que
// no se puede hacer es enviar.
type Opciones struct {
	Destinatarios Destinatarios
	MFA           MFAEnforcer
	UIF           UIFReporter
	Avisos        Avisos
	Logger        Logger
}

// comisionDe calcula lo que cobra KiramoPay por enviar `cantidad`.
//
// Se recorta a los decimales de la base porque es lo que de verdad se va a
// descontar: con mas decimales, lo que la hoja de confirmacion promete y lo que
// el saldo pierde dejan de ser el mismo numero.
func comisionDe(cantidad decimal.Decimal) decimal.Decimal {
	return cantidad.Mul(comisionDeEnvio).Round(decimalesDeLaBase)
}

// PreviewSend responde lo que la hoja de confirmacion tiene que mostrar ANTES
// de enviar: a quien le va a llegar, cuanto le llega y cuanto baja del saldo.
//
// Los tres numeros los calcula el servidor, el mismo que despues cobra. Si la
// pantalla los calculara por su cuenta, el dia que la comision cambie habria
// dos versiones de la verdad y la persona veria una y pagaria la otra.
//
// No consulta el precio de mercado: la comision es en el mismo activo, asi que
// el precio no hace falta para nada de lo que se muestra aqui. Enviar si lo
// necesita, por el monitoreo y los topes.
func (s *Service) PreviewSend(ctx context.Context, userID string, req *SendRequest) (*SendPreview, error) {
	activo := normalizarActivo(req.Asset)
	if err := validarCantidad(req.Amount); err != nil {
		return nil, err
	}
	destino, err := s.destinatarioDe(ctx, userID, req.QRData)
	if err != nil {
		return nil, err
	}
	comision := comisionDe(req.Amount)
	return &SendPreview{
		RecipientName: destino.Nombre,
		Asset:         activo,
		Amount:        req.Amount,
		Fee:           comision,
		Total:         req.Amount.Add(comision),
		FeePercent:    comisionEnPorciento,
	}, nil
}

// Send mueve el activo de quien envia a quien recibe.
//
// Lo que baja del saldo es la cantidad MAS la comision; lo que llega es la
// cantidad limpia. Las dos patas, la comision y la fila del historial confirman
// juntas o no confirma ninguna (ver EnviarEnUnaTx): a diferencia de comprar y
// vender, aqui no hay ninguna pata de fiat, asi que el envio va por su propia
// transaccion y no por el gancho del libro.
//
// La fila del historial se escribe igual, en dolares, aunque no se mueva un
// centimo: el tope de gasto y el monitoreo de la UIF se calculan sobre esa
// tabla. Sin ella, enviar cripto seria el camino abierto para sacar valor sin
// que nada lo cuente ni lo mire.
func (s *Service) Send(ctx context.Context, userID string, req *SendRequest) (*TransactionRecord, error) {
	activo := normalizarActivo(req.Asset)
	if err := validarCantidad(req.Amount); err != nil {
		return nil, err
	}
	destino, err := s.destinatarioDe(ctx, userID, req.QRData)
	if err != nil {
		return nil, err
	}

	comision := comisionDe(req.Amount)
	total := req.Amount.Add(comision)

	llave := req.IdempotencyKey
	if llave == "" {
		llave = "crypto:send:" + uuid.New().String()
		// Con llave del cliente no se comprueba el saldo antes: el reintento de
		// un envio que ya se llevo el saldo diria "no te alcanza" sobre algo que
		// ya ocurrio, en vez de llegar a la relectura de idempotencia. La guarda
		// del descuento decide igual.
		if err := s.saldoAlcanza(ctx, userID, activo, total); err != nil {
			return nil, err
		}
	}

	// El precio no decide cuanto se envia —eso lo dice la persona, en el propio
	// activo— pero si cuanto VALE lo que sale, que es lo que miran el tope y la
	// UIF. Sin precio no se envia: contar cero seria dejar pasar por cripto lo
	// que por transferencia se frena.
	usd, err := s.precioEnDolares(ctx, activo)
	if err != nil {
		return nil, err
	}
	if err := comprobarDesviacion(req.Price, usd); err != nil {
		return nil, err
	}
	valorMinor := toMinor(req.Amount.Mul(usd))

	if err := s.exigirMFA(ctx, userID, valorMinor); err != nil {
		return nil, err
	}

	envio := &TransactionRecord{
		ID:                 uuid.New().String(),
		UserID:             userID,
		Type:               "send",
		Asset:              activo,
		Amount:             req.Amount,
		Price:              usd,
		Total:              total,
		Currency:           activo,
		Fee:                comision,
		Status:             "completed",
		CounterpartyUserID: destino.UserID,
		CounterpartyName:   destino.Nombre,
		IdempotencyKey:     llave,
	}
	recibo := &TransactionRecord{
		UserID:             destino.UserID,
		Type:               "receive",
		Asset:              activo,
		Amount:             req.Amount,
		Price:              usd,
		Total:              req.Amount,
		Currency:           activo,
		Fee:                decimal.Zero,
		Status:             "completed",
		CounterpartyUserID: userID,
		CounterpartyName:   s.nombreDeQuienEnvia(ctx, userID),
	}

	hecho, repetido, err := s.repo.EnviarEnUnaTx(ctx, &DatosDelEnvio{
		Envio:           envio,
		Recibo:          recibo,
		NombreDelActivo: getAssetName(activo),
		// El activo entra al promedio de costo de quien recibe al precio de hoy.
		// Sin precio, la pantalla de esa persona diria que le costo cero y toda
		// su ganancia seria falsa.
		PrecioUSD:      usd,
		AntesDeMover:   s.toparElGasto(userID, valorMinor),
		DespuesDeMover: s.anotarEnElHistorial(userID, envio, valorMinor, comision.Mul(usd)),
	})
	if err != nil {
		return nil, fmt.Errorf("send %s: %w", activo, err)
	}
	if repetido {
		// La misma llave ya tiene un envio escrito. Si describe otra cosa no es
		// un reintento: es una llave reusada, y devolver el envio viejo como si
		// fuera este seria contestar "listo" por algo que nunca se hizo.
		if err := mismoEnvio(hecho, envio); err != nil {
			return nil, err
		}
		return hecho, nil
	}

	s.avisarDelEnvio(ctx, envio)
	if s.uif != nil {
		s.uif.Report(ctx, userID, envio.ID, "USD", valorMinor)
	}
	return envio, nil
}

// destinatarioDe resuelve a quien pertenece el QR escaneado.
func (s *Service) destinatarioDe(ctx context.Context, userID, qrData string) (*qrpayment.PersonaDelQR, error) {
	if s.destinatarios == nil {
		return nil, ErrEnvioNoDisponible
	}
	if strings.TrimSpace(qrData) == "" {
		return nil, qrpayment.ErrQRInvalido
	}
	destino, err := s.destinatarios.PersonaDelQR(ctx, qrData)
	if err != nil {
		return nil, err
	}
	if destino.UserID == userID {
		return nil, ErrNoTePodesEnviar
	}
	return destino, nil
}

// exigirMFA pide el segundo factor si lo que sale pasa el umbral. El umbral se
// mide en dolares porque es la moneda en que se cotiza el activo.
func (s *Service) exigirMFA(ctx context.Context, userID string, valorMinor int64) error {
	if s.mfa == nil || !s.mfa.IsMFARequired(valorMinor, "USD") {
		return nil
	}
	ok, err := s.mfa.HasVerifiedMFA(ctx, userID, "high_value_tx")
	if err != nil {
		return fmt.Errorf("mfa check: %w", err)
	}
	if !ok {
		return transaction.ErrMFARequired
	}
	return nil
}

// toparElGasto comprueba el tope diario y el mensual DENTRO de la transaccion
// del envio, y tomando el candado de la billetera.
//
// El candado es lo unico que hace que el tope frene de verdad: sin el, dos
// envios simultaneos leen la misma suma del dia y los dos pasan. En el resto de
// la aplicacion lo toma el libro antes de preguntar; aqui no hay asiento que lo
// tome, asi que lo pide la comprobacion misma.
func (s *Service) toparElGasto(userID string, valorMinor int64) func(context.Context, pgx.Tx) error {
	if s.tx == nil || valorMinor <= 0 {
		return nil
	}
	return func(ctx context.Context, dbtx pgx.Tx) error {
		return s.tx.CheckLimitsConBloqueoEnTx(ctx, dbtx, userID, "USD", valorMinor)
	}
}

// anotarEnElHistorial escribe la fila de `transactions` del envio, en dolares,
// dentro de la misma transaccion que mueve el activo.
//
// Tiene que confirmar con el envio: una fila sin envio le cobraria tope a la
// persona por algo que no ocurrio, y un envio sin fila seria valor saliendo sin
// que el tope ni la UIF lo vean nunca.
func (s *Service) anotarEnElHistorial(userID string, envio *TransactionRecord, valorMinor int64, comisionUSD decimal.Decimal) func(context.Context, pgx.Tx) error {
	if s.tx == nil {
		return nil
	}
	return func(ctx context.Context, dbtx pgx.Tx) error {
		return s.tx.RecordHistoryEnTx(ctx, dbtx, userID, "", &transaction.CreateTransactionRequest{
			Type:             transaction.TypeCryptoSend,
			Amount:           valorMinor,
			Currency:         "USD",
			Fee:              toMinor(comisionUSD),
			CounterpartyType: "user",
			CounterpartyName: envio.CounterpartyName,
			Description:      fmt.Sprintf("Send %s %s", envio.Amount.String(), envio.Asset),
			// La fila cuelga del envio: la llave del envio no sirve aqui, porque
			// es de quien envia y esta tabla tiene su propio indice.
			IdempotencyKey: "crypto:send:" + envio.ID,
			Internal:       true,
		})
	}
}

// avisarDelEnvio le dice a quien recibe que le llego cripto. Es lo unico que
// esa persona tiene para enterarse: no hay nada que le avise desde una cadena,
// porque no hay cadena.
//
// Es de mejor esfuerzo, DESPUES de confirmar: un aviso que no sale no puede
// deshacer un envio que ya ocurrio.
func (s *Service) avisarDelEnvio(ctx context.Context, envio *TransactionRecord) {
	if s.avisos == nil {
		return
	}
	// El nombre es el de quien ENVIA, no el de la contraparte del envio —esa es
	// justamente la persona a la que se le avisa—. Si no se pudo leer, el aviso
	// dice solo lo que es cierto y no inventa un nombre.
	deQuien := s.nombreDeQuienEnvia(ctx, envio.UserID)
	cuerpo := fmt.Sprintf("Recibiste %s %s", envio.Amount.String(), envio.Asset)
	if deQuien != "" {
		cuerpo = fmt.Sprintf("%s de %s", cuerpo, deQuien)
	}
	if err := s.avisos.NotifyUser(ctx, envio.CounterpartyUserID, "Te enviaron cripto", cuerpo, "crypto_receive"); err != nil && s.logger != nil {
		s.logger.Warn("aviso de envio de cripto", "error", err.Error(), "user", envio.CounterpartyUserID)
	}
}

func (s *Service) nombreDeQuienEnvia(ctx context.Context, userID string) string {
	if s.destinatarios == nil {
		return ""
	}
	return s.destinatarios.NombreDe(ctx, userID)
}

// mismoEnvio comprueba que el envio ya escrito bajo esa llave sea el que se
// esta pidiendo. La llave la elige el cliente, asi que dos envios distintos
// pueden llegar con la misma por un error suyo; con eso, devolver el viejo
// seria decirle "enviado" a alguien que no recibio nada.
func mismoEnvio(hecho, pedido *TransactionRecord) error {
	if hecho == nil {
		return fmt.Errorf("%w: la llave ya se uso", ErrLlaveDeOtroEnvio)
	}
	if hecho.Asset != pedido.Asset ||
		!hecho.Amount.Equal(pedido.Amount) ||
		hecho.CounterpartyUserID != pedido.CounterpartyUserID {
		return ErrLlaveDeOtroEnvio
	}
	return nil
}

func normalizarActivo(asset string) string {
	return strings.ToUpper(strings.TrimSpace(asset))
}
