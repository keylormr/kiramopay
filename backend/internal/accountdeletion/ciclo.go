package accountdeletion

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/messaging"
)

// La linea de tiempo despues del dia 0: la reactivacion (dias 0 a 30), el cierre
// efectivo (dia 30) y la desasociacion (al vencer la conservacion). Los dos
// barridos los corre Poller; aqui va lo que hace cada uno.

// SeEliminaEl devuelve el dia 30 de la cuenta y si todavia se puede reactivar:
// la cuenta esta en 'pending_deletion' y el barrido no la cerro. Una cuenta sin
// solicitud responde la fecha cero y false. Lo usa el login (auth) para ofrecer
// la reactivacion.
//
// Vencido el dia 30 la puerta sigue abierta mientras la cuenta no se cierre: si
// el barrido no pudo cerrarla (aparecio algo pendiente: dinero que alguien
// mando, un acuerdo que otro abrio), la persona tiene que poder entrar a
// resolverlo. Cerrar esa puerta la dejaria sin acceso, con lo pendiente adentro
// y sin cierre. Una cuenta limpia la cierra el barrido a los minutos.
func (s *Service) SeEliminaEl(ctx context.Context, userID string) (time.Time, bool, error) {
	var (
		vence       *time.Time
		reactivable bool
	)
	err := s.pool.QueryRow(ctx, `
		SELECT deletion_due_at,
		       COALESCE(status = 'pending_deletion' AND deleted_at IS NULL, false)
		  FROM users WHERE id = $1::uuid`, userID,
	).Scan(&vence, &reactivable)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, fmt.Errorf("leer la solicitud: %w", err)
	}
	if vence == nil {
		return time.Time{}, false, nil
	}
	return *vence, reactivable, nil
}

// Reactivar cancela el proceso de una cuenta que el barrido no cerro: vuelve a
// 'active', reabre el libro y cancela la solicitud web si la habia. Despues del
// commit quita la marca del middleware y avisa por correo. false sin error si ya
// no se puede (la cerro el barrido, operaciones la bloqueo mientras tanto) o no
// habia nada que reactivar.
func (s *Service) Reactivar(ctx context.Context, userID string) (bool, error) {
	var (
		ok     bool
		correo string
	)
	err := s.conReintentos(ctx, func(tx pgx.Tx) error {
		var err error
		correo = correoDe(ctx, tx, userID)
		ok, err = reactivarEnTx(ctx, tx, userID)
		return err
	})
	if err != nil || !ok {
		return ok, err
	}
	s.desmarcar(userID)
	subject, text, html := messaging.AccountReactivatedEmail()
	s.enviarAviso(userID, correo, subject, text, html, "aviso de reactivacion no enviado")
	return true, nil
}

// maxPaginasPorBarrido acota cuantos lotes recorre un barrido del dia 30: con
// lotes de 100, dos mil cuentas por pasada.
const maxPaginasPorBarrido = 20

// CerrarVencidas cierra las cuentas cuyo dia 30 ya llego en now, en lotes de
// limite. Devuelve cuantas cerro. Cada cuenta va en su propia transaccion: una
// que falla no frena a las demas, y el error de la primera que fallo se devuelve
// al final. Una cuenta con algo pendiente no se cierra y queda en el log para
// operaciones.
//
// Recorre por id y por paginas, no "las mas viejas primero": una cuenta que no
// se puede cerrar seguiria siendo la mas vieja en cada pasada, y con un lote
// entero de ellas ninguna otra se cerraria nunca.
func (s *Service) CerrarVencidas(ctx context.Context, now time.Time, limite int) (int, error) {
	if limite <= 0 {
		limite = 100
	}
	cerradas := 0
	var primero error
	desde := "00000000-0000-0000-0000-000000000000"
	for pagina := 0; pagina < maxPaginasPorBarrido; pagina++ {
		ids, err := s.vencidasDesde(ctx, now, desde, limite)
		if err != nil {
			return cerradas, err
		}
		n, err := s.cerrarLote(ctx, now, ids)
		cerradas += n
		if err != nil && primero == nil {
			primero = err
		}
		if len(ids) < limite {
			break
		}
		desde = ids[len(ids)-1]
	}
	return cerradas, primero
}

// vencidasDesde lee un lote de cuentas vencidas sin cerrar, con id mayor que
// desde.
func (s *Service) vencidasDesde(ctx context.Context, now time.Time, desde string, limite int) ([]string, error) {
	filas, err := s.pool.Query(ctx, `SELECT id::text FROM users
		 WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL AND deletion_due_at <= $1
		   AND id > $2::uuid
		 ORDER BY id
		 LIMIT $3`, now, desde, limite)
	if err != nil {
		return nil, fmt.Errorf("leer candidatas: %w", err)
	}
	defer filas.Close()
	var ids []string
	for filas.Next() {
		var id string
		if err := filas.Scan(&id); err != nil {
			return nil, fmt.Errorf("leer candidata: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, filas.Err()
}

// cerrarLote cierra cada cuenta del lote en su propia transaccion.
func (s *Service) cerrarLote(ctx context.Context, now time.Time, ids []string) (int, error) {
	cerradas := 0
	var primero error
	for _, id := range ids {
		var (
			cerrada  bool
			bloqueos []Bloqueo
			correo   string
		)
		err := s.conReintentos(ctx, func(tx pgx.Tx) error {
			var err error
			// El correo se lee antes de la tumba, para el aviso del cierre.
			correo = correoDe(ctx, tx, id)
			cerrada, bloqueos, err = cerrarEnTx(ctx, tx, id, now)
			return err
		})
		if err != nil {
			s.logger.Error("cierre de cuenta fallido", "user", id, "err", err.Error())
			if primero == nil {
				primero = fmt.Errorf("cerrar %s: %w", id, err)
			}
			continue
		}
		if len(bloqueos) > 0 {
			s.logger.Warn("cuenta por eliminar con algo pendiente: no se cierra", "user", id, "blockers", codigosDeBloqueo(bloqueos))
			continue
		}
		if cerrada {
			cerradas++
			subject, text, html := messaging.AccountDeletedEmail()
			s.enviarAviso(id, correo, subject, text, html, "aviso de cuenta eliminada no enviado")
		}
	}
	return cerradas, primero
}

// DesasociarVencidas desasocia, hasta limite, lo conservado de las cuentas cuya
// conservacion vencio en now. Devuelve cuantas desasocio. Mismo criterio que
// CerrarVencidas: una transaccion por cuenta.
func (s *Service) DesasociarVencidas(ctx context.Context, now time.Time, limite int) (int, error) {
	ids, err := s.candidatas(ctx, `SELECT id::text FROM users
		 WHERE `+sqlConservacionVencidaEn1+`
		 ORDER BY retention_until
		 LIMIT $2`, now, limite)
	if err != nil {
		return 0, err
	}
	hechas := 0
	var primero error
	for _, id := range ids {
		var hecha bool
		err := s.conReintentos(ctx, func(tx pgx.Tx) error {
			var err error
			hecha, err = desasociarEnTx(ctx, tx, id, now)
			return err
		})
		if err != nil {
			s.logger.Error("desasociacion fallida", "user", id, "err", err.Error())
			if primero == nil {
				primero = fmt.Errorf("desasociar %s: %w", id, err)
			}
			continue
		}
		if hecha {
			hechas++
		}
	}
	return hechas, primero
}

// sqlConservacionVencidaEn1 es sqlConservacionVencida con la fecha en $1, para
// la consulta de candidatas (que lleva el limite en $2).
const sqlConservacionVencidaEn1 = `retention_until IS NOT NULL AND dissociated_at IS NULL
	AND retention_until <= $1
	AND (retention_extended_at IS NULL OR deleted_at + interval '` + intervaloConservacionExtensa + `' <= $1)
	AND ` + sqlSinCasoAbierto

// candidatas lee los ids de un barrido. now va en $1 y el limite en $2.
func (s *Service) candidatas(ctx context.Context, sql string, now time.Time, limite int) ([]string, error) {
	if limite <= 0 {
		limite = 100
	}
	filas, err := s.pool.Query(ctx, sql, now, limite)
	if err != nil {
		return nil, fmt.Errorf("leer candidatas: %w", err)
	}
	defer filas.Close()
	var ids []string
	for filas.Next() {
		var id string
		if err := filas.Scan(&id); err != nil {
			return nil, fmt.Errorf("leer candidata: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, filas.Err()
}

// correoDe descifra el correo de la cuenta; vacio si no tiene o no se puede.
func correoDe(ctx context.Context, tx pgx.Tx, userID string) string {
	var correo *string
	if err := tx.QueryRow(ctx, `SELECT fn_pii_decrypt(email_enc) FROM users WHERE id = $1::uuid`, userID).Scan(&correo); err != nil || correo == nil {
		return ""
	}
	return *correo
}

func codigosDeBloqueo(bloqueos []Bloqueo) []string {
	out := make([]string, 0, len(bloqueos))
	for _, b := range bloqueos {
		out = append(out, b.Codigo)
	}
	return out
}
