package payment

import (
	"context"
	"errors"
	"fmt"

	"github.com/kiramopay/backend/internal/transaction"
)

// ErrSinConvenio se devuelve cuando se intenta pagar un recibo o recargar un
// telefono y no hay integracion con la empresa ni con el operador.
//
// Sin convenio, cobrar es debitar la billetera de verdad y dejar la plata en
// la reserva: nadie la recibe, el recibo que se emite no vale nada y no
// hay camino de reverso. Es exactamente el caso que este repositorio ya
// rechaza en otros dos lugares —sinpe.Send se niega a enviar a quien no es
// usuario ("tomar la plata y mostrar pendiente para siempre es peor que decir
// que no") y cmd/api/main.go se niega a registrar el riel de prueba de payouts
// en produccion porque "debita la billetera real pero nunca desembolsa"—.
// Estas dos rutas se habian saltado esa politica.
var ErrSinConvenio = errors.New("sin convenio con el proveedor: el cobro no se puede entregar")

// Los rechazos de la entrada, con codigo propio en el handler. Salian como
// PAYMENT_FAILED / RECHARGE_FAILED con la frase en ingles, igual que un fallo
// del servidor.
var (
	// ErrProveedorInvalido: no hay un proveedor activo con ese codigo.
	ErrProveedorInvalido = errors.New("invalid provider")
	// ErrOperadorInvalido: el operador no es uno de los que se recargan.
	ErrOperadorInvalido = errors.New("invalid operator")
	// ErrLlaveInvalida: la llave de idempotencia no cabe en el libro. Se
	// rechaza antes de mover nada; reventaba en la base.
	ErrLlaveInvalida = errors.New("invalid idempotency key")
)

// largoMaximoDeLaLlave deja lugar al prefijo (llaveDelLibro) dentro de la
// columna de la llave de `transactions`, VARCHAR(120).
const largoMaximoDeLaLlave = 100

// llaveDelLibro es la llave con que el pago viaja al motor de transferencias.
// El prefijo la separa de las de otros modulos: la misma llave que la pantalla
// uso para un SINPE no puede contestar por un recibo. Sin llave no hay
// idempotencia, como antes: una app vieja que no la manda cobra cada vez.
func llaveDelLibro(tipo, llave string) string {
	if llave == "" {
		return ""
	}
	return tipo + ":" + llave
}

// catalogoDeProveedores es lo que el catalogo necesita del repositorio. Una
// interfaz, para probar el endpoint sin base de datos.
type catalogoDeProveedores interface {
	ListActiveProviders(ctx context.Context) ([]ProviderInfo, error)
}

// Operadores son los operadores a los que Recharge acepta recargar, en el orden
// en que se ofrecen. Una sola lista para el catalogo y para Recharge: un
// operador que la pantalla ofrece y el servidor rechaza (INVALID_OPERATOR) es el
// mismo defecto que tenian las empresas.
var Operadores = []OperatorInfo{
	{Code: "kolbi", Name: "Kölbi (ICE)"},
	{Code: "claro", Name: "Claro"},
	{Code: "movistar", Name: "Movistar"},
}

// nombreDelOperador busca un operador por su codigo.
func nombreDelOperador(codigo string) (string, bool) {
	for _, op := range Operadores {
		if op.Code == codigo {
			return op.Name, true
		}
	}
	return "", false
}

type Service struct {
	repo      *Repository
	catalogo  catalogoDeProveedores
	txService *transaction.Service
	// convenios habilita el cobro. Falso mientras no exista integracion real;
	// se enciende por entorno igual que el registro de rieles de payouts, para
	// que las demos fuera de produccion sigan funcionando.
	convenios bool
}

// Options configura el servicio. ConveniosActivos solo debe ser verdadero
// donde exista una integracion que de verdad entregue el pago.
type Options struct {
	ConveniosActivos bool
}

func NewService(repo *Repository, txService *transaction.Service, opts *Options) *Service {
	s := &Service{repo: repo, txService: txService}
	if repo != nil {
		s.catalogo = repo
	}
	if opts != nil {
		s.convenios = opts.ConveniosActivos
	}
	return s
}

// ConveniosActivos dice si el cobro de recibos y recargas se puede entregar.
//
// Lo expone para que el asistente NO ofrezca esas dos acciones cuando no hay
// convenio: cada oferta imposible termina en ErrSinConvenio y quema una de las
// dos preguntas diarias del plan gratuito. Sale de aqui, y no de una segunda
// bandera en el asistente, para que las dos no puedan quedar diciendo cosas
// distintas.
func (s *Service) ConveniosActivos() bool { return s.convenios }

// Catalog arma lo que la pantalla de Servicios ofrece: las empresas activas, los
// operadores de recarga y si el cobro se puede entregar.
func (s *Service) Catalog(ctx context.Context) (*Catalog, error) {
	providers, err := s.catalogo.ListActiveProviders(ctx)
	if err != nil {
		return nil, err
	}
	if providers == nil {
		providers = []ProviderInfo{}
	}
	return &Catalog{
		AgreementsActive: s.convenios,
		Providers:        providers,
		Operators:        Operadores,
	}, nil
}

func (s *Service) PayBill(ctx context.Context, userID string, req *PayBillRequest) (*PayBillResponse, error) {
	if !s.convenios {
		return nil, ErrSinConvenio
	}
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	if len(req.IdempotencyKey) > largoMaximoDeLaLlave {
		return nil, ErrLlaveInvalida
	}

	// Resolve provider
	_, providerName, err := s.repo.GetProviderByCode(ctx, req.ProviderCode)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrProveedorInvalido, req.ProviderCode)
	}

	// La llave cubre tambien la descripcion, que es la que dice el numero de
	// cliente: bajo la misma llave, el recibo de otro cliente no es el
	// reintento de este.
	txRecord, repetido, err := s.txService.CrearOReconocer(ctx, userID, &transaction.CreateTransactionRequest{
		Type:                    transaction.TypeBillPayment,
		Amount:                  req.Amount,
		Currency:                "CRC",
		Fee:                     0,
		CounterpartyType:        "service",
		CounterpartyName:        providerName,
		Description:             fmt.Sprintf("Pago %s - Cliente %s", providerName, req.ClientID),
		IdempotencyKey:          llaveDelLibro("bill", req.IdempotencyKey),
		LlaveCubreLaDescripcion: true,
		Internal:                true,
	})
	if err != nil {
		return nil, fmt.Errorf("process payment: %w", err)
	}

	// La repeticion no escribe otra fila: la de aquel pago es la que vale.
	if !repetido {
		_ = s.repo.AddPaymentHistory(ctx, &PaymentHistoryRecord{
			UserID:       userID,
			Type:         "bill",
			ProviderCode: req.ProviderCode,
			ProviderName: providerName,
			ClientID:     req.ClientID,
			Amount:       req.Amount,
			Status:       "completed",
		})
	}

	return &PayBillResponse{
		TransactionID: txRecord.ID,
		ReceiptNumber: fmt.Sprintf("RCP-%s", txRecord.ID[:8]),
		ProviderName:  providerName,
		Amount:        req.Amount,
		Status:        "completed",
		Replayed:      repetido,
	}, nil
}

func (s *Service) Recharge(ctx context.Context, userID string, req *RechargeRequest) (*RechargeResponse, error) {
	if !s.convenios {
		return nil, ErrSinConvenio
	}
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	if len(req.IdempotencyKey) > largoMaximoDeLaLlave {
		return nil, ErrLlaveInvalida
	}

	operatorName, ok := nombreDelOperador(req.Operator)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrOperadorInvalido, req.Operator)
	}

	// La llave cubre tambien la descripcion, que es la que dice el telefono:
	// bajo la misma llave, la recarga de otro numero no es el reintento de
	// esta.
	txRecord, repetido, err := s.txService.CrearOReconocer(ctx, userID, &transaction.CreateTransactionRequest{
		Type:                    transaction.TypeRecharge,
		Amount:                  req.Amount,
		Currency:                "CRC",
		Fee:                     0,
		CounterpartyType:        "service",
		CounterpartyName:        operatorName,
		CounterpartyPhone:       req.Phone,
		Description:             fmt.Sprintf("Recarga %s %s", operatorName, req.Phone),
		IdempotencyKey:          llaveDelLibro("recharge", req.IdempotencyKey),
		LlaveCubreLaDescripcion: true,
		Internal:                true,
	})
	if err != nil {
		return nil, fmt.Errorf("process recharge: %w", err)
	}

	// La repeticion no escribe otra fila: la de aquella recarga es la que vale.
	if !repetido {
		_ = s.repo.AddPaymentHistory(ctx, &PaymentHistoryRecord{
			UserID:       userID,
			Type:         "recharge",
			ProviderCode: req.Operator,
			ProviderName: operatorName,
			ClientID:     req.Phone,
			Amount:       req.Amount,
			Status:       "completed",
		})
	}

	return &RechargeResponse{
		TransactionID: txRecord.ID,
		Operator:      operatorName,
		Phone:         req.Phone,
		Amount:        req.Amount,
		Status:        "completed",
		Replayed:      repetido,
	}, nil
}

func (s *Service) GetSavedServices(ctx context.Context, userID string) ([]SavedServiceRecord, error) {
	return s.repo.GetSavedServices(ctx, userID)
}

func (s *Service) AddSavedService(ctx context.Context, userID, providerCode, clientID, nickname string) (*SavedServiceRecord, error) {
	providerID, providerName, err := s.repo.GetProviderByCode(ctx, providerCode)
	if err != nil {
		return nil, fmt.Errorf("provider not found")
	}

	record, err := s.repo.AddSavedService(ctx, userID, providerID, clientID, nickname)
	if err != nil {
		return nil, err
	}
	record.ProviderCode = providerCode
	record.ProviderName = providerName
	return record, nil
}

func (s *Service) GetPaymentHistory(ctx context.Context, userID string) ([]PaymentHistoryRecord, error) {
	return s.repo.GetPaymentHistory(ctx, userID, 50)
}
