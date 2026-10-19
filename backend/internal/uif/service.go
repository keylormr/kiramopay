package uif

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	repo         *Repository
	thresholds   Thresholds
	auditLogger  *audit.Logger
	tipoDeCambio func(ctx context.Context, moneda string) (float64, error)
	ahora        func() time.Time
}

type Options struct {
	Thresholds  *Thresholds
	AuditLogger *audit.Logger
	// TipoDeCambio reemplaza la venta de referencia del BCCR por un numero fijo
	// por moneda (unidades de la moneda por dolar), el mismo para cualquier dia.
	// Es para las pruebas. Sin el, el servicio dolariza cada monto con la venta
	// de referencia del dia en que ocurrio (Repository.VentaDeReferencia). Sin
	// tipo de cambio un movimiento en otra moneda no se puede comparar con el
	// umbral y se abre un caso manual: nunca se deja pasar en silencio.
	TipoDeCambio func(ctx context.Context, moneda string) (float64, error)
	// Ahora es el reloj del servicio; nil es time.Now. Decide el dia y el mes
	// calendario de cada evaluacion y que mes cierra el cierre automatico.
	Ahora func() time.Time
}

func NewService(repo *Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	th := DefaultThresholds()
	if opts.Thresholds != nil {
		th = opts.Thresholds.conLosDeLey()
	}
	ahora := opts.Ahora
	if ahora == nil {
		ahora = time.Now
	}
	return &Service{repo: repo, thresholds: th, auditLogger: opts.AuditLogger,
		tipoDeCambio: opts.TipoDeCambio, ahora: ahora}
}

const (
	sentidoSalida  = "salida"
	sentidoEntrada = "entrada"
)

// movimiento es lo que se evalua.
type movimiento struct {
	userID, txID, sentido, moneda string
	monto                         int64
	// precioDeEjecucion: el monto ya esta en dolares al precio al que se ejecuto
	// la operacion (cripto). No pasa por un tipo de cambio.
	precioDeEjecucion bool
}

// Report implements transaction.UIFReporter. It is called best-effort AFTER an
// outgoing transaction is posted; the running totals already include this
// transaction, so the prior total is (total - amount). Failures are logged,
// never propagated — UIF recording must not roll back a settled payment, but a
// failure to record is a compliance gap worth surfacing.
func (s *Service) Report(ctx context.Context, userID, txID, currency string, amountMinor int64) {
	s.evaluar(ctx, movimiento{userID: userID, txID: txID, sentido: sentidoSalida, moneda: currency, monto: amountMinor})
}

// ReportEntrada es Report para lo que ENTRA a la billetera. Las transacciones
// multiples cuentan cualquier medio de pago (SUGEF 13-19 art. 20) y, mientras
// no se decida si entradas y salidas se suman, se miden las dos por separado y
// el bruto.
func (s *Service) ReportEntrada(ctx context.Context, userID, txID, currency string, amountMinor int64) {
	s.evaluar(ctx, movimiento{userID: userID, txID: txID, sentido: sentidoEntrada, moneda: currency, monto: amountMinor})
}

// ReportCripto es Report para un envio de cripto: el monto es su valor en
// dolares al precio de ejecucion de la operacion, y asi queda registrado.
func (s *Service) ReportCripto(ctx context.Context, userID, txID string, usdMinor int64) {
	s.evaluar(ctx, movimiento{userID: userID, txID: txID, sentido: sentidoSalida, moneda: "USD", monto: usdMinor,
		precioDeEjecucion: true})
}

// evaluar registra el movimiento con su equivalente en dolares y lo compara con
// el umbral en cada regla. Un caso por movimiento, el de la regla mas fuerte:
//
//  1. single_threshold: el movimiento solo iguala o supera el umbral.
//  2. structuring: las salidas del dia cruzan el umbral con el.
//  3. multiples_mes: salidas, entradas o bruto del mes calendario cruzan el
//     umbral con el. Es el acumulado regulatorio; si dispara junto con una de
//     las dos de arriba, la razon de ese caso lo dice y el caso guarda el mes.
//  4. estructuracion_30d: alerta interna, las salidas de 30 dias moviles.
//
// La lista definitiva de lo que hay que registrar por mes la arma el cierre
// (CerrarMes), con la venta del ultimo dia del mes.
//
// El movimiento queda registrado cuando la evaluacion termina, y solo entonces:
// si algo falla a mitad de camino (la base no responde, el contexto del pago se
// cancela), el aviso repetido de un reintento la rehace. Si el reintento no
// llega, el cierre lo cuenta.
func (s *Service) evaluar(ctx context.Context, m movimiento) {
	if m.txID != "" {
		ya, err := s.repo.yaEvaluado(ctx, m.txID, m.sentido)
		if err != nil {
			slog.Warn("uif: no se pudo saber si el movimiento ya se evaluo", "user", m.userID, "tx", m.txID,
				"err", err.Error())
			return
		}
		if ya {
			return
		}
	}
	ahora := s.ahora()
	hoy := diaCR(ahora)
	mes := MesDe(ahora)
	conv := s.nuevaConversion(ctx, m.userID)

	var amountUSD int64
	var cot Cotizacion
	var errTasa error
	if m.precioDeEjecucion {
		amountUSD, cot = m.monto, Cotizacion{PorDolar: 1, Fecha: hoy, Fuente: FuentePrecioDeEjecucion}
	} else if amountUSD, cot, errTasa = conv.aDolares(m.moneda, m.monto, hoy); errTasa == nil {
		alarmarSiEsVieja(m.userID, m.moneda, cot, hoy)
	}
	if cortada(conv, m) {
		return
	}
	reg := registro{
		userID: m.userID, txID: m.txID, sentido: m.sentido, moneda: m.moneda, monto: m.monto,
		mes: mes.PrimerDia(), conTasa: errTasa == nil, usd: amountUSD, cot: cot,
	}
	if errTasa != nil {
		// Nunca silencio: si no se puede comparar con el umbral, lo decide una
		// persona.
		s.cerrarConCaso(ctx, reg, &Report{
			UserID:      m.userID,
			TxID:        m.txID,
			ReportType:  TypeManual,
			AmountMinor: m.monto,
			Currency:    m.moneda,
			Reason: fmt.Sprintf("no hay tipo de cambio oficial para %s: el movimiento de %s %s no se pudo "+
				"comparar con el umbral de US$%s. Revisarlo a mano.", m.moneda, dolares(m.monto), m.moneda,
				dolares(s.thresholds.SingleUSD)),
			Status: StatusPending,
		})
		return
	}

	filasMes, err := s.repo.movimientosPorDia(ctx, m.userID, mes.Inicio, mes.Fin)
	if err != nil {
		slog.Warn("uif: movimientos del mes fallaron", "user", m.userID, "err", err.Error())
		return
	}
	salidasMes := conv.sumar(soloSentido(filasMes, sentidoSalida))
	entradasMes := conv.sumar(soloSentido(filasMes, sentidoEntrada))
	if cortada(conv, m) {
		return
	}
	cruces, salUSD, entUSD := s.crucesDelMes(m.sentido, amountUSD, salidasMes, entradasMes)

	rep := &Report{
		UserID:         m.userID,
		TxID:           m.txID,
		AmountMinor:    m.monto,
		Currency:       m.moneda,
		Mes:            fecha(mes.PrimerDia()),
		SalidasMesUSD:  salUSD,
		EntradasMesUSD: entUSD,
		Status:         StatusPending,
	}

	var res Result
	var dia, treinta total
	if m.sentido == sentidoSalida {
		delDiaPorMoneda, err := s.repo.salidasDelDia(ctx, m.userID, ahora)
		if err != nil {
			slog.Warn("uif: daily total query failed", "user", m.userID, "err", err.Error())
			return
		}
		rep.DailyTotalMinor = delDiaPorMoneda[m.moneda]
		dia = conv.sumar(delDia(delDiaPorMoneda, hoy))
		res = s.thresholds.Evaluate(amountUSD, previo(dia, amountUSD))

		if !res.Reportable && len(cruces) == 0 {
			filas30, err := s.repo.movimientosPorDia(ctx, m.userID, ahora.Add(-30*24*time.Hour), ahora.Add(24*time.Hour))
			if err != nil {
				slog.Warn("uif: salidas de 30 dias fallaron", "user", m.userID, "err", err.Error())
				return
			}
			salidas30 := soloSentido(filas30, sentidoSalida)
			treinta = conv.sumar(salidas30)
			if r30 := s.thresholds.EvaluateAcumulado(amountUSD, previo(treinta, amountUSD)); r30.Reportable {
				res = r30
				rep.Acumulado30Minor = montoEn(salidas30, m.moneda)
			}
		}
		if cortada(conv, m) {
			return
		}
	}

	switch {
	case res.Reportable:
	case len(cruces) > 0:
		res = Result{Reportable: true, Type: TypeMultiplesMes, Reason: s.razonDelMes(mes, cruces, salidasMes, entradasMes)}
	default:
		if s.siFaltaUnaMoneda(ctx, rep, dia, salidasMes, entradasMes, treinta) {
			s.registrar(ctx, reg)
		}
		return
	}

	rep.ReportType = res.Type
	razon := res.Reason
	// Si disparo un total, de que esta hecho: las columnas del caso guardan
	// solo la moneda del movimiento, y sin esto el oficial no podia rehacer la
	// cuenta de un total que junta dolares y colones.
	switch res.Type {
	case TypeStructuring:
		razon += deQueEstaHecho(dia)
	case TypeEstructuracion30:
		razon += deQueEstaHecho(treinta)
	}
	if res.Type != TypeMultiplesMes {
		if len(cruces) > 0 {
			razon += "; ademas, " + s.razonDelMes(mes, cruces, salidasMes, entradasMes)
		} else if faltan := unirFaltan(salidasMes, entradasMes); len(faltan) > 0 {
			// El acumulado regulatorio no se pudo medir entero: que no se pierda
			// detras de un caso de otra regla.
			razon += "; los movimientos del mes " + mes.String() + " no se pudieron sumar enteros: no hay tipo de " +
				"cambio oficial para " + strings.Join(faltan, ", ")
		}
	}
	if m.moneda != "USD" {
		razon += fmt.Sprintf("; el movimiento: %s %s = US$%s al tipo de cambio oficial de %s %s por dolar (%s del %s)",
			dolares(m.monto), m.moneda, dolares(amountUSD), tasaLegible(cot.PorDolar), m.moneda,
			cot.Fuente, fecha(cot.Fecha))
	}
	rep.Reason = razon
	s.cerrarConCaso(ctx, reg, rep)
}

// cortada dice si la evaluacion se tiene que detener porque la base no
// respondio al leer una tasa. No es una moneda sin tasa: el movimiento queda sin
// registrar para que un reintento lo evalue.
func cortada(conv *conversion, m movimiento) bool {
	if conv.fallo == nil {
		return false
	}
	slog.Warn("uif: evaluacion cortada, queda para el reintento", "user", m.userID, "tx", m.txID,
		"err", conv.fallo.Error())
	return true
}

// cerrarConCaso abre el caso y, si quedo guardado, registra el movimiento: la
// evaluacion termino.
func (s *Service) cerrarConCaso(ctx context.Context, reg registro, rep *Report) {
	if s.crearCaso(ctx, rep) {
		s.registrar(ctx, reg)
	}
}

// registrar guarda el registro del movimiento al terminar su evaluacion. Si
// falla, el caso ya quedo: un reintento evalua otra vez y el caso repetido no se
// inserta.
func (s *Service) registrar(ctx context.Context, reg registro) {
	if reg.txID == "" {
		return
	}
	if _, err := s.repo.registrarMovimiento(ctx, reg); err != nil {
		slog.Warn("uif: no se pudo registrar el movimiento", "user", reg.userID, "tx", reg.txID, "err", err.Error())
	}
}

// crucesDelMes mide las tres cosas del mes que se comparan con el umbral
// —salidas, entradas y bruto— y dice cuales cruzan con este movimiento. Solo
// puede cruzar lo que el movimiento mueve: una salida no cambia las entradas.
// Devuelve tambien los dos totales del mes, con el movimiento.
func (s *Service) crucesDelMes(sentido string, amountUSD int64, sal, ent total) ([]string, int64, int64) {
	u := s.thresholds.MensualUSD
	var cruces []string
	salidas, entradas := sal.usd, ent.usd
	if sentido == sentidoSalida {
		antes := previo(sal, amountUSD)
		salidas = antes + amountUSD
		if cruza(antes, salidas, u) {
			cruces = append(cruces, fmt.Sprintf("las salidas del mes (US$%s)", dolares(salidas)))
		}
	} else {
		antes := previo(ent, amountUSD)
		entradas = antes + amountUSD
		if cruza(antes, entradas, u) {
			cruces = append(cruces, fmt.Sprintf("las entradas del mes (US$%s)", dolares(entradas)))
		}
	}
	if bruto := salidas + entradas; cruza(bruto-amountUSD, bruto, u) {
		cruces = append(cruces, fmt.Sprintf("el bruto del mes, salidas mas entradas (US$%s)", dolares(bruto)))
	}
	return cruces, salidas, entradas
}

func (s *Service) razonDelMes(mes Mes, cruces []string, sal, ent total) string {
	r := fmt.Sprintf("transacciones multiples del mes %s (SUGEF 13-19 art. 20): %s igualan o superan el umbral de US$%s",
		mes, strings.Join(cruces, " y "), dolares(s.thresholds.MensualUSD))
	if len(sal.partes) > 0 {
		r += "; salieron " + strings.Join(sal.partes, " + ")
	}
	if len(ent.partes) > 0 {
		r += "; entraron " + strings.Join(ent.partes, " + ")
	}
	if faltan := unirFaltan(sal, ent); len(faltan) > 0 {
		r += "; sin contar " + strings.Join(faltan, ", ") + ", que no tiene tipo de cambio oficial"
	}
	return r
}

func deQueEstaHecho(t total) string {
	r := "; el total: " + strings.Join(t.partes, " + ")
	if len(t.faltan) > 0 {
		r += "; sin contar " + strings.Join(t.faltan, ", ") + ", que no tiene tipo de cambio oficial"
	}
	return r
}

// siFaltaUnaMoneda abre un caso manual cuando ningun total cruza el umbral pero
// a alguno le falta una moneda que no se pudo convertir. Un total que no se
// pudo sumar entero no dice que no cruzo: hoy salieron ₡500.000 sin tipo de
// cambio para el colon y despues US$9.900, y el servicio solo veia los
// US$9.900. Devuelve false si el caso no se pudo guardar.
func (s *Service) siFaltaUnaMoneda(ctx context.Context, rep *Report, dia, salidasMes, entradasMes, treinta total) bool {
	var cual string
	var t total
	var umbral int64
	switch {
	case len(dia.faltan) > 0:
		cual, t, umbral = "las salidas del dia", dia, s.thresholds.DailyUSD
	case len(salidasMes.faltan) > 0 || len(entradasMes.faltan) > 0:
		// Uno por cliente y mes: mientras falte la tasa, cada movimiento que
		// sigue en el mes diria lo mismo.
		if ya, err := s.repo.hayMesIncompleto(ctx, rep.UserID, rep.Mes); err == nil && ya {
			return true
		}
		cual, umbral = prefijoMesIncompleto+rep.Mes[:7], s.thresholds.MensualUSD
		t = total{usd: salidasMes.usd + entradasMes.usd, faltan: unirFaltan(salidasMes, entradasMes),
			partes: append(append([]string{}, salidasMes.partes...), entradasMes.partes...)}
	case len(treinta.faltan) > 0:
		cual, t, umbral = "las salidas de los ultimos 30 dias", treinta, s.thresholds.Acumulado30USD
	default:
		return true
	}
	sin := "nada"
	if len(t.partes) > 0 {
		sin = strings.Join(t.partes, " + ")
	}
	rep.ReportType = TypeManual
	rep.Reason = fmt.Sprintf("%s no se pudieron sumar enteras: no hay tipo de cambio oficial para %s. "+
		"Sin esa moneda suman US$%s (%s), y el umbral es US$%s. Revisarlo a mano.",
		cual, strings.Join(t.faltan, ", "), dolares(t.usd), sin, dolares(umbral))
	return s.crearCaso(ctx, rep)
}

// prefijoMesIncompleto empieza la razon del caso manual de un mes que no se
// pudo sumar entero; hayMesIncompleto lo busca por el.
const prefijoMesIncompleto = "los movimientos del mes "

// crearCaso guarda el caso pendiente y deja la huella en la auditoria. Devuelve
// false si no se pudo guardar; un caso que ya existia cuenta como guardado.
func (s *Service) crearCaso(ctx context.Context, rep *Report) bool {
	nuevo, err := s.repo.CreateReport(ctx, rep)
	if err != nil {
		slog.Warn("uif: create report failed", "user", rep.UserID, "tx", rep.TxID, "err", err.Error())
		return false
	}
	if nuevo {
		s.auditarCaso(rep)
	}
	return true
}

func (s *Service) auditarCaso(rep *Report) {
	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       rep.UserID,
			Action:       "uif_report_created",
			ResourceType: "uif_report",
			ResourceID:   rep.ID,
			RiskLevel:    "high",
		})
	}
}

func (s *Service) ListReports(ctx context.Context, status string) ([]Report, error) {
	return s.repo.ListByStatus(ctx, status, 100)
}

// ErrRevisionPropia: quien revisa el caso es la persona del caso. Desde el PR
// 295 administra una cuenta personal, con movimientos que pueden abrir un caso;
// descartarse su propio caso es justo lo que la revision tiene que impedir. Lo
// revisa otro oficial.
var ErrRevisionPropia = errors.New("uif: a reviewer cannot review a case about their own account")

func (s *Service) ReviewReport(ctx context.Context, id, reviewerID string, req *ReviewRequest) error {
	switch req.Status {
	case StatusSubmitted, StatusDismissed, StatusReviewed:
	default:
		return fmt.Errorf("invalid review status %q", req.Status)
	}
	// La persona de un caso no cambia, asi que leerla antes del UPDATE no abre
	// una carrera. Un caso que no existe sigue: Review dice que no esta.
	persona, err := s.repo.PersonaDelCaso(ctx, id)
	if err != nil {
		return fmt.Errorf("read report: %w", err)
	}
	if persona != "" && persona == reviewerID {
		return ErrRevisionPropia
	}
	if err := s.repo.Review(ctx, id, reviewerID, req.Status, req.Notes); err != nil {
		return err
	}
	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       reviewerID,
			Action:       "uif_report_" + req.Status,
			ResourceType: "uif_report",
			ResourceID:   id,
			RiskLevel:    "medium",
		})
	}
	return nil
}
