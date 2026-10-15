package escrow

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/notification"
)

// Un escrow fondeado no vencia nunca: si el comprador se callaba, la plata
// quedaba retenida para siempre. Ver migrations/064_escrow_con_plazos.sql para
// la regla; en corto, cuando un plazo vence pierde quien tenia que actuar y no
// lo hizo.

// Notifier avisa a una persona dentro de la app. Lo satisface
// *notification.Service, el mismo que usan sinpe y los cobros QR.
type Notifier interface {
	// clave es un aviso del catalogo de notification (textos.go): el servicio
	// lo escribe en el idioma guardado de quien lo recibe.
	NotificarEnSuIdioma(ctx context.Context, userID, clave string, datos map[string]any, tag string) error
}

// ── Repositorio ─────────────────────────────────────────────────────────────

// fijarPlazoEntregaEnTx pone el plazo del vendedor al fondear, dentro de la
// transaccion del asiento: un acuerdo fondeado sin plazo es justamente el que
// no vence nunca.
func fijarPlazoEntregaEnTx(ctx context.Context, tx pgx.Tx, id string, dias int) (*Agreement, error) {
	return scanAgreement(tx.QueryRow(ctx, `
		UPDATE escrow_agreements
		   SET entregar_antes = NOW() + make_interval(days => $2),
		       aviso_vencimiento_at = NULL
		 WHERE id = $1::uuid
		 RETURNING `+agreementCols, id, dias))
}

// marcarVencimientoEnTx anota por que se cerro el acuerdo.
func marcarVencimientoEnTx(ctx context.Context, tx pgx.Tx, id, motivo string) (*Agreement, error) {
	return scanAgreement(tx.QueryRow(ctx, `
		UPDATE escrow_agreements SET cerrado_por_vencimiento = $2
		 WHERE id = $1::uuid
		 RETURNING `+agreementCols, id, motivo))
}

// MarcarEntrega registra que el vendedor entrego y arranca el plazo del
// comprador. Solo un acuerdo 'funded' sin entrega previa lo acepta.
func (r *Repository) MarcarEntrega(ctx context.Context, id, sellerID string, diasRevision int) (*Agreement, error) {
	a, err := scanAgreement(r.db.QueryRow(ctx, `
		UPDATE escrow_agreements
		   SET delivered_at = NOW(),
		       revisar_antes = NOW() + make_interval(days => $3),
		       aviso_vencimiento_at = NULL,
		       updated_at = NOW()
		 WHERE id = $1::uuid AND seller_id = $2::uuid
		   AND status = 'funded' AND delivered_at IS NULL
		   AND (entregar_antes IS NULL OR entregar_antes > NOW())
		 RETURNING `+agreementCols, id, sellerID, diasRevision))
	if errors.Is(err, ErrNotFound) {
		// La fila existe pero no esta para entregar (ya entregada, disputada,
		// cerrada, o con el plazo vencido) o no existe: se distingue para
		// devolver el codigo correcto.
		actual, gerr := r.Get(ctx, id)
		if gerr != nil {
			return nil, ErrNotFound
		}
		if actual.Status == StatusFunded && actual.DeliveredAt == nil && plazoVencido(actual.DeliverBy) {
			return nil, ErrPlazoVencido
		}
		return nil, ErrBadTransition
	}
	return a, err
}

// fijarPlazosFaltantes le pone plazo a todo acuerdo fondeado que no lo tenga.
//
// No deberia haber ninguno: Fund lo fija dentro del asiento y la migracion 064
// lo repuso en los que ya existian. Pero el camino de reparacion de
// moveAndTransition (ErrIdempotent) puede completar un fondeo SIN pasar por el
// gancho, y un acuerdo fondeado sin plazo es exactamente el defecto que esto
// corrige: no venceria nunca. Cuesta un UPDATE que casi siempre no toca nada.
func (r *Repository) fijarPlazosFaltantes(ctx context.Context, dias int) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE escrow_agreements
		   SET entregar_antes = NOW() + make_interval(days => $1)
		 WHERE status = 'funded' AND entregar_antes IS NULL AND delivered_at IS NULL`, dias)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// listarPorAvisar devuelve los acuerdos fondeados cuyo plazo vigente vence
// dentro de `antes` y a cuyas partes todavia no se les aviso.
func (r *Repository) listarPorAvisar(ctx context.Context, antes time.Duration, limite int) ([]Agreement, error) {
	return r.listar(ctx, `
		SELECT `+agreementCols+` FROM escrow_agreements
		 WHERE status = 'funded'
		   AND aviso_vencimiento_at IS NULL
		   AND COALESCE(revisar_antes, entregar_antes) <= NOW() + make_interval(secs => $1)
		   AND COALESCE(revisar_antes, entregar_antes) > NOW()
		 ORDER BY COALESCE(revisar_antes, entregar_antes)
		 LIMIT $2`, antes.Seconds(), limite)
}

// reclamarAviso marca el aviso como enviado. Devuelve false si otro barrido se
// adelanto: el aviso no se manda dos veces.
func (r *Repository) reclamarAviso(ctx context.Context, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE escrow_agreements SET aviso_vencimiento_at = NOW()
		 WHERE id = $1::uuid AND aviso_vencimiento_at IS NULL AND status = 'funded'`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// listarVencidos devuelve los acuerdos fondeados con el plazo vigente vencido.
// Los disputados no aparecen: una disputa detiene el reloj.
func (r *Repository) listarVencidos(ctx context.Context, limite int) ([]Agreement, error) {
	return r.listar(ctx, `
		SELECT `+agreementCols+` FROM escrow_agreements
		 WHERE status = 'funded'
		   AND (   (delivered_at IS NULL     AND entregar_antes <= NOW())
		        OR (delivered_at IS NOT NULL AND revisar_antes  <= NOW()))
		 ORDER BY COALESCE(revisar_antes, entregar_antes)
		 LIMIT $1`, limite)
}

func (r *Repository) listar(ctx context.Context, sql string, args ...any) ([]Agreement, error) {
	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Agreement
	for rows.Next() {
		a, err := scanAgreement(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// plazoVencido dice si un plazo ya paso. Sin plazo, no vencio.
func plazoVencido(t *time.Time) bool {
	return t != nil && !time.Now().Before(*t)
}

// plazoVigente es el que corre ahora: el de revision si ya se entrego, si no el
// de entrega.
func plazoVigente(a *Agreement) *time.Time {
	if a.DeliveredAt != nil {
		return a.ReviewBy
	}
	return a.DeliverBy
}

// ── Servicio ────────────────────────────────────────────────────────────────

// MarcarEntregado lo llama el vendedor cuando ya entrego. Arranca el plazo del
// comprador para liberar o reclamar.
func (s *Service) MarcarEntregado(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.SellerID != callerID {
		if a.BuyerID == callerID {
			return nil, ErrNotSeller
		}
		return nil, ErrNotParty
	}
	out, err := s.repo.MarcarEntrega(ctx, id, callerID, s.plazos.DiasParaRevisar)
	if err != nil {
		return nil, err
	}
	s.audit(callerID, out, "escrow_entregado", "low", nil)
	s.emit(ctx, out, "escrow.delivered")
	s.avisar(ctx, out.BuyerID, notification.AvisoEscrowEntregaMarcada, datosDelAviso(out, out.ReviewBy))
	return out, nil
}

// VencerAcuerdos es el barrido: avisa a las partes de los plazos que estan por
// vencer y cierra los vencidos. Devuelve cuantos aviso y cuantos cerro.
//
// Lo corre el Poller, bajo el candado de cluster: con varias instancias, una
// sola barre. Aun asi cada paso esta protegido por su cuenta —el aviso se
// reclama con un UPDATE condicional y el cierre pasa por la misma transicion
// guardada que las acciones manuales— asi que dos barridos simultaneos no
// avisan dos veces ni mueven dos veces.
func (s *Service) VencerAcuerdos(ctx context.Context, limite int) (avisados, cerrados int, err error) {
	if limite <= 0 {
		limite = 100
	}
	if n, ferr := s.repo.fijarPlazosFaltantes(ctx, s.plazos.DiasParaEntregar); ferr != nil {
		return 0, 0, fmt.Errorf("fijar plazos faltantes: %w", ferr)
	} else if n > 0 {
		s.audit("", &Agreement{}, "escrow_plazo_repuesto", "medium",
			map[string]interface{}{"acuerdos": n})
	}

	porAvisar, err := s.repo.listarPorAvisar(ctx, s.plazos.AvisoAntes, limite)
	if err != nil {
		return 0, 0, fmt.Errorf("listar por avisar: %w", err)
	}
	for i := range porAvisar {
		a := &porAvisar[i]
		ok, rerr := s.repo.reclamarAviso(ctx, a.ID)
		if rerr != nil || !ok {
			continue
		}
		s.avisarVencimientoProximo(ctx, a)
		avisados++
	}

	vencidos, err := s.repo.listarVencidos(ctx, limite)
	if err != nil {
		return avisados, 0, fmt.Errorf("listar vencidos: %w", err)
	}
	for i := range vencidos {
		if _, verr := s.cerrarPorVencimiento(ctx, &vencidos[i]); verr != nil {
			// Un acuerdo que otra accion cerro entre la lectura y el cierre
			// no es un error del barrido: ya no esta fondeado.
			if !errors.Is(verr, ErrBadTransition) {
				s.audit("", &vencidos[i], "escrow_vencimiento_fallido", "high",
					map[string]interface{}{"error": verr.Error()})
			}
			continue
		}
		cerrados++
	}
	return avisados, cerrados, nil
}

// cerrarPorVencimiento mueve la plata hacia quien no le toca perder:
//   - sin entrega marcada, vuelve al comprador;
//   - con entrega marcada y sin reclamo, va al vendedor.
//
// Usa el mismo nucleo que liberar y reembolsar a mano, con la misma llave de
// idempotencia: un acuerdo se libera o se reembolsa UNA vez en su vida, lo haga
// una persona, el arbitro o el barrido. Sin segundo factor, porque no hay una
// persona del otro lado: la accion la manda la regla que las dos partes
// aceptaron al fondear.
func (s *Service) cerrarPorVencimiento(ctx context.Context, a *Agreement) (*Agreement, error) {
	motivo, to, accion := VencioEntrega, StatusRefunded, "refund"
	debit, credit := escrowAccount(a.Currency), ledger.Account{UserID: a.BuyerID}
	if a.DeliveredAt != nil {
		motivo, to, accion = VencioRevision, StatusReleased, "release"
		credit = ledger.Account{UserID: a.SellerID}
	}
	return s.moverYTransicionar(ctx, a, StatusFunded, to, accion, debit, credit,
		func(ctx context.Context, tx pgx.Tx, _ *Agreement) (*Agreement, error) {
			return marcarVencimientoEnTx(ctx, tx, a.ID, motivo)
		},
		func(done *Agreement) {
			s.audit("", done, "escrow_vencido", "high", map[string]interface{}{"motivo": motivo})
			s.avisarCierrePorVencimiento(ctx, done)
		})
}

// ── Avisos ──────────────────────────────────────────────────────────────────

func (s *Service) avisar(ctx context.Context, userID, clave string, datos map[string]any) {
	if s.notifier == nil || userID == "" {
		return
	}
	// Best-effort: un aviso que no sale no puede frenar el movimiento de plata
	// que lo origino. La notificacion queda en el historial de la app, que es
	// lo que la persona lee al sincronizar.
	_ = s.notifier.NotificarEnSuIdioma(ctx, userID, clave, datos, "escrow")
}

func (s *Service) avisarVencimientoProximo(ctx context.Context, a *Agreement) {
	if a.DeliveredAt == nil {
		datos := datosDelAviso(a, a.DeliverBy)
		s.avisar(ctx, a.SellerID, notification.AvisoEscrowEntregaPorVencerVendedor, datos)
		s.avisar(ctx, a.BuyerID, notification.AvisoEscrowEntregaPorVencerComprador, datos)
		return
	}
	datos := datosDelAviso(a, a.ReviewBy)
	s.avisar(ctx, a.BuyerID, notification.AvisoEscrowRevisionPorVencerComprador, datos)
	s.avisar(ctx, a.SellerID, notification.AvisoEscrowRevisionPorVencerVendedor, datos)
}

func (s *Service) avisarCierrePorVencimiento(ctx context.Context, a *Agreement) {
	datos := datosDelAviso(a, nil)
	if a.ClosedByExpiry == VencioRevision {
		s.avisar(ctx, a.SellerID, notification.AvisoEscrowPagadoVendedor, datos)
		s.avisar(ctx, a.BuyerID, notification.AvisoEscrowPagadoComprador, datos)
		return
	}
	s.avisar(ctx, a.BuyerID, notification.AvisoEscrowDevueltoComprador, datos)
	s.avisar(ctx, a.SellerID, notification.AvisoEscrowDevueltoVendedor, datos)
}

// datosDelAviso son la descripcion, el monto y, si el aviso habla de un plazo,
// su fecha en la hora de Costa Rica. El catalogo la escribe con el formato del
// idioma de quien lo recibe; sin plazo, dice "sin fecha" en ese idioma.
func datosDelAviso(a *Agreement, plazo *time.Time) map[string]any {
	limite := time.Time{}
	if plazo != nil {
		limite = plazo.In(zonaCR)
	}
	return map[string]any{
		"descripcion": a.Description,
		"monto":       notification.Monto(a.AmountMinor, a.Currency),
		"limite":      limite,
	}
}

// zonaCR es la hora de Costa Rica. Si el sistema no trae la base de zonas, se
// usa el desfase fijo: el pais no tiene horario de verano.
var zonaCR = func() *time.Location {
	if z, err := time.LoadLocation("America/Costa_Rica"); err == nil {
		return z
	}
	return time.FixedZone("CST", -6*3600)
}()
