package accountdeletion

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/messaging"
	"github.com/kiramopay/backend/internal/user"
)

// La respuesta escrita a una solicitud de eliminacion (Ley 8968 art. 7,
// Reglamento arts. 18 y 22) no es de mejor esfuerzo (decision del dueno del
// 2026-10-20; ver la migracion 083):
//
//   - Se encola en la MISMA transaccion que la solicitud (encolarRespuesta): si
//     la solicitud quedo, la respuesta tambien.
//   - El primer intento sale apenas se confirma (entregarAhora); los demas los
//     hace el barrido (EntregarRespuestas), con espera creciente.
//   - Cada intento reserva la fila antes de mandar (entregarUna): con la API
//     escalada, o con el primer intento y el barrido a la vez, no sale dos veces.
//   - Sin a donde mandarla, o si a las 48 horas sigue sin salir, pasa a
//     operaciones (RespuestasSinEntregar), que la entrega por otro medio y deja
//     constancia de como (MarcarRespuestaEntregada). Para eso puede ver el
//     contacto completo (ContactoDeRespuesta), y cada vista queda auditada.
//   - Toda solicitud web verificada tiene su respuesta, tambien la rechazada, y
//     el plazo legal se cuenta desde la verificacion aunque operaciones la
//     atienda dias despues (decision del dueno del 2026-10-20).

// Tipos de respuesta.
const (
	// RespuestaPlazoIniciado: empezo el plazo de 30 dias.
	RespuestaPlazoIniciado = "scheduled"
	// RespuestaBloqueada: la solicitud web no pudo empezar; se dice que resolver.
	RespuestaBloqueada = "blocked"
	// RespuestaRechazada: la solicitud web no se atiende por esta via. No dice
	// por que: la cuenta puede estar bajo revision.
	RespuestaRechazada = "rejected"
	// RespuestaSinDecidir: la solicitud web de una cuenta en revision, recien
	// verificada, espera a operaciones. No hay nada que mandar todavia: al
	// procesarla o rechazarla se completa esta misma fila (responder).
	RespuestaSinDecidir = "undecided"
)

// Por que una respuesta no salio. Es un codigo y nunca el texto del proveedor:
// un rebote de SMTP trae la direccion adentro.
const (
	MotivoSinCanal     = "no_channel"
	MotivoEnvioFallido = "send_failed"
)

const (
	// plazoParaOperaciones: a las 48 horas sin salir se ocupa una persona. Le
	// deja tres de los cinco dias habiles para entregarla por otro medio.
	plazoParaOperaciones = 48 * time.Hour
	// margenParaOperaciones son esos tres dias, corridos y no habiles, contados
	// hacia atras desde el plazo. Una sin decidir pasa sola al panel cuando le
	// quedan menos. Y una respuesta que nace con menos pasa a operaciones al
	// primer fallo: la de una solicitud verificada antes de que existiera la
	// bandeja, que no tiene su fila sin decidir y la recibe al atenderla, dias
	// despues. Las demas nacen con la verificacion y llegan antes a las 48 horas.
	// Corridos a proposito: con un fin de semana en medio escala antes, no despues.
	margenParaOperaciones = 72 * time.Hour
	// reservaDeEnvio aparta la fila mientras se manda. Es mas que avisoTimeout:
	// nadie la toma mientras el envio sigue vivo.
	reservaDeEnvio = 2 * time.Minute
	// esperaSinCanal: sin a donde mandarla no hay nada que reintentar pronto.
	esperaSinCanal = 6 * time.Hour
	// esperaMaxima es la espera entre intentos una vez agotadas las cortas.
	esperaMaxima = 6 * time.Hour
	// maxNota acota la nota con que operaciones dice como la entrego.
	maxNota = 500
	// diasDeLasEnviadasSinConfirmar: cuanto queda a la vista de operaciones una
	// respuesta que salio al correo dado solo para la respuesta (decision del
	// dueno del 2026-10-20).
	diasDeLasEnviadasSinConfirmar = 30
	// presupuestoDelBarrido acota cuanto manda un barrido: corre bajo el lock
	// del lider, y un proveedor lento no debe demorar el siguiente cierre del
	// dia 30. Lo que no alcanzo a salir queda para el proximo tick.
	presupuestoDelBarrido = 2 * time.Minute
)

// sinMasIntentos es el turno de una respuesta que el barrido ya no reintenta: la
// de una cuenta cerrada sin a donde mandarla, que queda solo para operaciones.
var sinMasIntentos = time.Date(9999, time.December, 31, 0, 0, 0, 0, time.UTC)

// esperas entre un intento fallido y el siguiente, por numero de intento.
var esperas = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 3 * time.Hour}

func esperaTras(intentos int) time.Duration {
	if intentos >= 1 && intentos <= len(esperas) {
		return esperas[intentos-1]
	}
	return esperaMaxima
}

// zonaDeCostaRica es donde se cuentan los dias habiles. Sin horario de verano.
var zonaDeCostaRica = time.FixedZone("CR", -6*3600)

// responderAntesDe es el plazo legal para responder: cinco dias habiles
// (Ley 8968 art. 7, Reglamento art. 18), contados en Costa Rica. Los feriados
// no se descuentan, asi que el plazo calculado queda igual o antes que el
// legal, nunca despues.
func responderAntesDe(desde time.Time) time.Time {
	t := desde.In(zonaDeCostaRica)
	for habiles := 0; habiles < 5; {
		t = t.AddDate(0, 0, 1)
		if d := t.Weekday(); d != time.Saturday && d != time.Sunday {
			habiles++
		}
	}
	return t
}

// conservaHasta es hasta cuando se guarda lo que la Ley 7786 obliga: cinco
// anos desde el dia 30. La respuesta dice siempre cinco: la marca de diez anos
// la pone cumplimiento y no se le comunica a la persona.
func conservaHasta(dia30 time.Time) time.Time {
	return dia30.AddDate(anosDeConservacion, 0, 0)
}

var (
	// ErrRespuestaNoEncontrada: el panel pide una respuesta que no existe.
	ErrRespuestaNoEncontrada = errors.New("respuesta no encontrada")
	// ErrRespuestaCerrada: ya se entrego o se cancelo.
	ErrRespuestaCerrada = errors.New("la respuesta ya no esta pendiente")
	// ErrNotaRequerida: marcarla entregada a mano exige decir como.
	ErrNotaRequerida = errors.New("escribe como se entrego la respuesta")
	// ErrNotaLarga: la nota pasa de maxNota caracteres.
	ErrNotaLarga = errors.New("la nota es demasiado larga")
	// ErrRespuestaFueraDelPanel: la respuesta no esta pendiente en el panel (ya
	// salio, se cancelo, o el barrido todavia la esta reintentando).
	ErrRespuestaFueraDelPanel = errors.New("la respuesta no esta pendiente en el panel")
	// ErrRespuestaSinDecidir: la respuesta espera que operaciones atienda la
	// solicitud; no hay nada que entregar por otro medio.
	ErrRespuestaSinDecidir = errors.New("la respuesta espera que se atienda la solicitud")
)

// nuevaRespuesta es lo que se encola.
type nuevaRespuesta struct {
	tipo        string
	seEliminaEl *time.Time
	bloqueos    []string
	// correoDado es el que dio una persona cuya cuenta no tiene correo, solo
	// para esta respuesta. Va cifrado, y nadie lo confirmo: la fila lo marca.
	correoDado string
	// desde es cuando se pidio, de donde corre el plazo legal: la verificacion
	// de la solicitud web. Vacio, ahora.
	desde time.Time
}

// encolarRespuesta deja la respuesta en la bandeja, dentro de la transaccion de
// la solicitud. Devuelve su id, para el primer intento.
func encolarRespuesta(ctx context.Context, tx pgx.Tx, userID string, r nuevaRespuesta) (string, error) {
	bloqueos := r.bloqueos
	if bloqueos == nil {
		bloqueos = []string{}
	}
	desde := r.desde
	if desde.IsZero() {
		desde = time.Now()
	}
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO account_deletion_responses
		       (user_id, kind, deletion_due_at, blockers, email_enc, email_unconfirmed, respond_by)
		VALUES ($1::uuid, $2, $3, $4, CASE WHEN $5::text = '' THEN NULL ELSE fn_pii_encrypt($5::text) END,
		        $5::text <> '', $6)
		RETURNING id::text`,
		userID, r.tipo, r.seEliminaEl, bloqueos, r.correoDado, responderAntesDe(desde),
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("encolar la respuesta escrita: %w", err)
	}
	return id, nil
}

// encolarSinDecidir deja la respuesta de la solicitud web de una cuenta en
// revision apenas se verifica, con el plazo desde ahi (decision del dueno del
// 2026-10-22). No sale nada hasta que operaciones la procesa o la rechaza, que
// completan esta misma fila (responder); si nadie la atiende, escalarSinDecidir
// la pasa al panel antes del plazo.
func encolarSinDecidir(ctx context.Context, tx pgx.Tx, userID, solicitudID string, verificada time.Time) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO account_deletion_responses (user_id, kind, request_id, respond_by, next_attempt_at)
		VALUES ($1::uuid, $2, $3::uuid, $4, $5)`,
		userID, RespuestaSinDecidir, solicitudID, responderAntesDe(verificada), sinMasIntentos); err != nil {
		return fmt.Errorf("encolar la respuesta sin decidir: %w", err)
	}
	return nil
}

// responder deja la respuesta de una solicitud: completa la que quedo sin
// decidir al verificarla, que conserva su plazo, o encola una nueva si no la hay
// (la via de la app, o una solicitud verificada antes de que existiera). La
// completada sale ya: vuelve a contar sus intentos y deja el panel hasta que
// falle.
func responder(ctx context.Context, tx pgx.Tx, userID, solicitudID string, r nuevaRespuesta) (string, error) {
	if solicitudID != "" {
		bloqueos := r.bloqueos
		if bloqueos == nil {
			bloqueos = []string{}
		}
		var id string
		err := tx.QueryRow(ctx, `
			UPDATE account_deletion_responses
			   SET kind = $2, deletion_due_at = $3, blockers = $4,
			       attempts = 0, next_attempt_at = NOW(), last_error = NULL, escalated_at = NULL
			 WHERE request_id = $1::uuid AND kind = $5 AND delivered_at IS NULL AND cancelled_at IS NULL
			RETURNING id::text`, solicitudID, r.tipo, r.seEliminaEl, bloqueos, RespuestaSinDecidir).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("completar la respuesta sin decidir: %w", err)
		}
	}
	return encolarRespuesta(ctx, tx, userID, r)
}

// cancelarSinDecidir cancela la respuesta sin decidir que le quede a una
// solicitud ya cerrada: la cubre otra que todavia no habia salido, o no hay a
// quien responder.
func cancelarSinDecidir(ctx context.Context, tx pgx.Tx, solicitudID string) error {
	if _, err := tx.Exec(ctx, `
		UPDATE account_deletion_responses SET cancelled_at = NOW()
		 WHERE request_id = $1::uuid AND kind = $2 AND delivered_at IS NULL AND cancelled_at IS NULL`,
		solicitudID, RespuestaSinDecidir); err != nil {
		return fmt.Errorf("cancelar la respuesta sin decidir: %w", err)
	}
	return nil
}

// escalarSinDecidir pasa al panel las respuestas sin decidir a las que ya no les
// quedan tres dias de plazo: nadie proceso ni rechazo la solicitud, y operaciones
// tiene que atenderla antes de que venza.
func (s *Service) escalarSinDecidir(ctx context.Context, now time.Time) error {
	filas, err := s.pool.Query(ctx, `
		UPDATE account_deletion_responses
		   SET escalated_at = $1
		 WHERE kind = $2 AND escalated_at IS NULL AND delivered_at IS NULL AND cancelled_at IS NULL
		   AND respond_by <= $1::timestamptz + $3::interval
		RETURNING id::text`, now, RespuestaSinDecidir, fmt.Sprintf("%d seconds", int(margenParaOperaciones.Seconds())))
	if err != nil {
		return fmt.Errorf("escalar las respuestas sin decidir: %w", err)
	}
	ids, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("escalar las respuestas sin decidir: %w", err)
	}
	for _, id := range ids {
		s.logger.Error("respuesta escrita sin decidir: pasa al panel de operaciones", "response", id)
	}
	return nil
}

// respuestaPendiente devuelve la respuesta de ese tipo que todavia no salio, o
// vacio si no hay.
func respuestaPendiente(ctx context.Context, tx pgx.Tx, userID, tipo string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		SELECT id::text FROM account_deletion_responses
		 WHERE user_id = $1::uuid AND kind = $2 AND delivered_at IS NULL AND cancelled_at IS NULL
		 ORDER BY created_at DESC LIMIT 1`, userID, tipo).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("leer la respuesta pendiente: %w", err)
	}
	return id, nil
}

// entregarAhora hace el primer intento por fuera de la peticion. La respuesta ya
// esta en la bandeja: si este intento no llega a correr (el proceso cae), la
// manda el barrido.
func (s *Service) entregarAhora(id string) {
	if id == "" || s.email == nil {
		return
	}
	// #nosec G118 -- intentionally detached: the request context dies with the
	// response; the row is already queued and entregarUna bounds the send.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), reservaDeEnvio)
		defer cancel()
		if _, err := s.entregarUna(ctx, id, time.Now()); err != nil {
			s.logger.Warn("primer intento de la respuesta escrita fallido; la reintenta el barrido", "response", id, "err", err.Error())
		}
	}()
}

// EntregarRespuestas manda las respuestas pendientes cuyo turno llego en now,
// en lotes de limite. Devuelve cuantas entrego. Un envio que falla no es un
// error: queda registrado y vuelve a su turno. El error es el de la base, el
// primero que hubo.
func (s *Service) EntregarRespuestas(ctx context.Context, now time.Time, limite int) (int, error) {
	if limite <= 0 {
		limite = 100
	}
	entregadas := 0
	var primero error
	if err := s.escalarSinDecidir(ctx, now); err != nil {
		primero = err
	}
	inicio := time.Now()
	hasta := inicio.Add(presupuestoDelBarrido)
	for pagina := 0; pagina < maxPaginasPorBarrido; pagina++ {
		// Cada fila que se intenta corre su turno hacia adelante, asi que la
		// pagina siguiente ya no la trae.
		// Una sin decidir no tiene nada que mandar.
		filas, err := s.pool.Query(ctx, `
			SELECT id::text FROM account_deletion_responses
			 WHERE delivered_at IS NULL AND cancelled_at IS NULL AND next_attempt_at <= $1
			   AND kind <> 'undecided'
			 ORDER BY next_attempt_at, id
			 LIMIT $2`, now, limite)
		if err != nil {
			return entregadas, fmt.Errorf("leer la bandeja: %w", err)
		}
		ids, err := pgx.CollectRows(filas, pgx.RowTo[string])
		if err != nil {
			return entregadas, fmt.Errorf("leer la bandeja: %w", err)
		}
		for _, id := range ids {
			if time.Now().After(hasta) {
				return entregadas, primero
			}
			// La reserva y la constancia se miden desde este envio, no desde el
			// inicio del barrido: con envios lentos la diferencia llega a minutos.
			ok, err := s.entregarUna(ctx, id, now.Add(time.Since(inicio)))
			if err != nil {
				if primero == nil {
					primero = err
				}
				continue
			}
			if ok {
				entregadas++
			}
		}
		if len(ids) < limite {
			break
		}
	}
	return entregadas, primero
}

// entregarUna reserva la respuesta, la manda y deja constancia. true si salio.
// false sin error: ya no estaba pendiente, la tomo otro, o el envio fallo y
// quedo registrado para su proximo turno.
func (s *Service) entregarUna(ctx context.Context, id string, now time.Time) (bool, error) {
	var (
		tipo       string
		dia30      *time.Time
		bloqueos   []string
		creada     time.Time
		vence      time.Time
		intentos   int
		yaEscalada bool
		cerrada    bool
		destino    string
	)
	// La reserva corre el turno hacia adelante antes de mandar: otra instancia,
	// o el barrido mientras corre el primer intento, ya no la encuentra. El
	// primer intento no mira el turno (attempts = 0): un reloj del servidor de
	// la base apenas adelantado no lo deja para el barrido.
	err := s.pool.QueryRow(ctx, `
		UPDATE account_deletion_responses r
		   SET attempts = r.attempts + 1, next_attempt_at = $2::timestamptz + $3::interval
		  FROM users u
		 WHERE r.id = $1::uuid AND u.id = r.user_id
		   AND r.delivered_at IS NULL AND r.cancelled_at IS NULL AND r.kind <> 'undecided'
		   AND (r.next_attempt_at <= $2 OR r.attempts = 0)
		RETURNING r.kind, r.deletion_due_at, r.blockers, r.created_at, r.respond_by, r.attempts,
		          r.escalated_at IS NOT NULL, u.deleted_at IS NOT NULL,
		          COALESCE(NULLIF(fn_pii_decrypt(r.email_enc), ''), NULLIF(fn_pii_decrypt(u.email_enc), ''), '')`,
		id, now, fmt.Sprintf("%d seconds", int(reservaDeEnvio.Seconds())),
	).Scan(&tipo, &dia30, &bloqueos, &creada, &vence, &intentos, &yaEscalada, &cerrada, &destino)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reservar la respuesta %s: %w", id, err)
	}

	if destino == "" || s.email == nil {
		proximo := now.Add(esperaSinCanal)
		if cerrada && destino == "" {
			// Cerrada la cuenta, su correo ya no existe ni va a volver: no hay
			// nada que reintentar. Queda en el panel de operaciones.
			proximo = sinMasIntentos
		}
		return false, s.registrarFallo(ctx, id, now, MotivoSinCanal, true, yaEscalada, proximo)
	}
	subject, text, html := contenidoDeLaRespuesta(tipo, dia30, bloqueos)
	envio, cancel := context.WithTimeout(ctx, avisoTimeout)
	errEnvio := s.email.SendEmail(envio, destino, subject, text, html)
	cancel()
	if errEnvio != nil {
		// El error del proveedor puede traer la direccion; al log va sin ella.
		s.logger.Warn("respuesta escrita no enviada; se reintenta", "response", id, "attempt", intentos,
			"err", sinDireccion(errEnvio.Error(), destino))
		return false, s.registrarFallo(ctx, id, now, MotivoEnvioFallido, pasaAOperaciones(now, creada, vence), yaEscalada, now.Add(esperaTras(intentos)))
	}
	// Si esto falla, la respuesta vuelve a salir en su proximo turno: mejor dos
	// veces que ninguna.
	if _, err := s.pool.Exec(ctx, `
		UPDATE account_deletion_responses
		   SET delivered_at = $2, delivered_via = 'email', email_enc = NULL, last_error = NULL
		 WHERE id = $1::uuid AND delivered_at IS NULL AND cancelled_at IS NULL`, id, now); err != nil {
		return true, fmt.Errorf("constancia de la respuesta %s: %w", id, err)
	}
	return true, nil
}

// pasaAOperaciones dice si una respuesta que no pudo salir pasa al panel: a las
// 48 horas, o antes si el plazo legal (vence) ya no deja a operaciones sus tres
// dias. La que nace tarde (una solicitud verificada antes de la bandeja,
// atendida dias despues) tiene el plazo encima y pasa al primer fallo.
func pasaAOperaciones(now, creada, vence time.Time) bool {
	return now.Sub(creada) >= plazoParaOperaciones || !now.Before(vence.Add(-margenParaOperaciones))
}

// sinDireccion quita la direccion de un error del proveedor, con cualquier
// capitalizacion: un rebote la devuelve normalizada.
func sinDireccion(texto, direccion string) string {
	if direccion == "" {
		return texto
	}
	return regexp.MustCompile(`(?i)`+regexp.QuoteMeta(direccion)).ReplaceAllLiteralString(texto, "[correo]")
}

// registrarFallo deja el motivo y el proximo turno. escalar la pasa a
// operaciones; la primera vez queda un error en el log.
func (s *Service) registrarFallo(ctx context.Context, id string, now time.Time, motivo string, escalar, yaEscalada bool, proximo time.Time) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE account_deletion_responses
		   SET last_error = $2, next_attempt_at = $3,
		       escalated_at = CASE WHEN $4 THEN COALESCE(escalated_at, $5) ELSE escalated_at END
		 WHERE id = $1::uuid AND delivered_at IS NULL AND cancelled_at IS NULL`,
		id, motivo, proximo, escalar, now); err != nil {
		return fmt.Errorf("registrar el fallo de la respuesta %s: %w", id, err)
	}
	if escalar && !yaEscalada {
		s.logger.Error("respuesta escrita sin entregar: pasa al panel de operaciones", "response", id, "reason", motivo)
	}
	return nil
}

// contenidoDeLaRespuesta arma el correo segun el tipo.
func contenidoDeLaRespuesta(tipo string, dia30 *time.Time, bloqueos []string) (subject, text, html string) {
	switch {
	case tipo == RespuestaRechazada:
		return messaging.DeletionRejectedEmail()
	case tipo == RespuestaBloqueada || dia30 == nil:
		return messaging.DeletionBlockedEmail(motivosDe(bloqueos))
	}
	return messaging.AccountDeletionRequestedEmail(*dia30, conservaHasta(*dia30))
}

// motivosDe pasa los codigos de bloqueo a las frases del correo.
func motivosDe(bloqueos []string) []string {
	motivos := make([]string, 0, len(bloqueos))
	for _, c := range bloqueos {
		if f, ok := frasesDeBloqueo[c]; ok {
			motivos = append(motivos, f)
		} else {
			motivos = append(motivos, "hay algo pendiente en tu cuenta")
		}
	}
	return motivos
}

// RespuestaPendiente es una respuesta que paso a operaciones, tal como la ve el
// panel: lo que hay que decirle a la persona, el plazo, y la cuenta
// enmascarada (null si ya no se puede leer, por ejemplo cerrada).
type RespuestaPendiente struct {
	ID               string     `json:"id"`
	Tipo             string     `json:"kind"`
	CreadaEn         time.Time  `json:"created_at"`
	ResponderAntesDe time.Time  `json:"respond_by"`
	Intentos         int        `json:"attempts"`
	Motivo           string     `json:"reason"`
	SeEliminaEl      *time.Time `json:"deletion_due_at,omitempty"`
	ConservaHasta    *time.Time `json:"retained_until,omitempty"`
	Bloqueos         []string   `json:"blockers"`
	// UserID y CuentaCerrada dejan atender la de una cuenta ya cerrada, que no
	// tiene tarjeta enmascarada.
	UserID        string `json:"user_id"`
	CuentaCerrada bool   `json:"account_closed"`
	// CorreoSinConfirmar: va al correo que la persona dio solo para la
	// respuesta, que nadie confirmo. Que el proveedor lo acepte no dice que sea
	// suyo.
	CorreoSinConfirmar bool                `json:"unconfirmed_email"`
	Cuenta             *user.AdminUserView `json:"account"`
}

// RespuestaEnviadaSinConfirmar es una respuesta que ya salio por correo al que
// la persona dio solo para la respuesta, que nadie confirmo.
type RespuestaEnviadaSinConfirmar struct {
	ID            string              `json:"id"`
	Tipo          string              `json:"kind"`
	EntregadaEn   time.Time           `json:"delivered_at"`
	UserID        string              `json:"user_id"`
	CuentaCerrada bool                `json:"account_closed"`
	Cuenta        *user.AdminUserView `json:"account"`
}

// ContactoCompleto es el contacto sin enmascarar de una respuesta del panel:
// con lo enmascarado no se puede entregar por otro medio. Vacio lo que no hay.
type ContactoCompleto struct {
	Telefono string `json:"phone"`
	Correo   string `json:"email"`
	// CorreoParaRespuesta es el que la persona dio solo para la respuesta,
	// mientras exista: se borra al entregarla, al reactivar y el dia 30.
	CorreoParaRespuesta string `json:"response_email"`
}

// ContactoDeRespuesta devuelve el contacto completo de una respuesta que esta en
// el panel (escalada y sin entregar), para que operaciones la entregue por otro
// medio. Cada vista queda en la auditoria, en la misma transaccion: sin el
// registro no se devuelve nada. Una vista que no revela nada (no queda ningun
// contacto) sale vacia y no se audita.
//
// De una cuenta ya cerrada (dia 30), users solo guarda marcadores y el correo de
// la respuesta ya se borro: el telefono y el correo salen de
// closed_account_records, lo que se conserva por ley. USO LIMITADO, decision del
// dueno del 2026-10-22 que confirma con su asesor legal: solo para entregar esta
// respuesta escrita a la misma persona, solo administradores, y cada vista
// auditada como las demas. Es la unica lectura de closed_account_records fuera
// del cierre y la desasociacion; desasociado lo conservado, ya no hay contacto.
//
// Una respuesta sin decidir no tiene nada que entregar: ErrRespuestaSinDecidir.
//
// La vista de lo conservado lleva source = closed_account_record en la
// auditoria, para poder listar esos accesos aparte.
func (s *Service) ContactoDeRespuesta(ctx context.Context, id, adminID string) (*ContactoCompleto, error) {
	var out *ContactoCompleto
	err := s.conReintentos(ctx, func(tx pgx.Tx) error {
		out = nil
		var (
			userID, tipo           string
			enElPanel, cerrada     bool
			telefono, correo, dado *string
		)
		err := tx.QueryRow(ctx, `
			SELECT r.user_id::text, r.kind,
			       r.escalated_at IS NOT NULL AND r.delivered_at IS NULL AND r.cancelled_at IS NULL,
			       u.deleted_at IS NOT NULL,
			       fn_pii_decrypt(CASE WHEN u.deleted_at IS NULL THEN u.phone_enc ELSE c.phone_enc END),
			       fn_pii_decrypt(CASE WHEN u.deleted_at IS NULL THEN u.email_enc ELSE c.email_enc END),
			       fn_pii_decrypt(r.email_enc)
			  FROM account_deletion_responses r
			  JOIN users u ON u.id = r.user_id
			  LEFT JOIN closed_account_records c ON c.user_id = r.user_id
			 WHERE r.id = $1::uuid
			   FOR SHARE OF r`, id,
		).Scan(&userID, &tipo, &enElPanel, &cerrada, &telefono, &correo, &dado)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRespuestaNoEncontrada
		}
		if err != nil {
			return fmt.Errorf("leer el contacto: %w", err)
		}
		if !enElPanel {
			return ErrRespuestaFueraDelPanel
		}
		if tipo == RespuestaSinDecidir {
			return ErrRespuestaSinDecidir
		}
		c := &ContactoCompleto{Telefono: valorDe(telefono), Correo: valorDe(correo), CorreoParaRespuesta: valorDe(dado)}
		if *c == (ContactoCompleto{}) {
			out = c
			return nil
		}
		op := opciones{actor: adminID, respuesta: id}
		if cerrada {
			op.fuente = fuenteLoConservado
		}
		if err := auditar(ctx, tx, userID, "account_deletion_response_contact_viewed", op); err != nil {
			return err
		}
		out = c
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// fuenteLoConservado marca en la auditoria una vista que salio de
// closed_account_records.
const fuenteLoConservado = "closed_account_record"

// valorDe es el texto de una columna que puede venir NULL.
func valorDe(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// RespuestasSinEntregar lista las que pasaron a operaciones, la de plazo mas
// cercano primero.
func (s *Service) RespuestasSinEntregar(ctx context.Context, limite int) ([]RespuestaPendiente, error) {
	// Sin pedido son 50; pedir mas que el tope devuelve el tope. Antes volvia
	// al valor por defecto, y `limit=500` traia menos filas que `limit=100`.
	if limite <= 0 {
		limite = 50
	} else if limite > 100 {
		limite = 100
	}
	filas, err := s.pool.Query(ctx, `
		SELECT r.id::text, r.kind, r.created_at, r.respond_by, r.attempts, COALESCE(r.last_error, ''),
		       r.deletion_due_at, r.blockers, r.user_id::text, u.deleted_at IS NOT NULL, r.email_unconfirmed
		  FROM account_deletion_responses r
		  JOIN users u ON u.id = r.user_id
		 WHERE r.escalated_at IS NOT NULL AND r.delivered_at IS NULL AND r.cancelled_at IS NULL
		 ORDER BY r.respond_by, r.id
		 LIMIT $1`, limite)
	if err != nil {
		return nil, fmt.Errorf("listar las respuestas sin entregar: %w", err)
	}
	out := make([]RespuestaPendiente, 0, 8)
	for filas.Next() {
		var r RespuestaPendiente
		if err := filas.Scan(&r.ID, &r.Tipo, &r.CreadaEn, &r.ResponderAntesDe, &r.Intentos, &r.Motivo,
			&r.SeEliminaEl, &r.Bloqueos, &r.UserID, &r.CuentaCerrada, &r.CorreoSinConfirmar); err != nil {
			filas.Close()
			return nil, fmt.Errorf("leer la respuesta: %w", err)
		}
		if r.Bloqueos == nil {
			r.Bloqueos = []string{}
		}
		if r.SeEliminaEl != nil {
			hasta := conservaHasta(*r.SeEliminaEl)
			r.ConservaHasta = &hasta
		}
		out = append(out, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, fmt.Errorf("recorrer las respuestas: %w", err)
	}
	for i := range out {
		if out[i].CuentaCerrada {
			continue // ya no tiene tarjeta: el panel muestra el id
		}
		if v, err := s.users.GetAdminView(ctx, out[i].UserID); err == nil {
			out[i].Cuenta = v
		}
	}
	return out, nil
}

// EnviadasSinConfirmar lista las respuestas que salieron por correo en los
// ultimos 30 dias al que la persona dio solo para la respuesta: que el proveedor
// lo aceptara no prueba que le llego. Solo cuenta ese correo, no el de la cuenta
// aunque no este verificado, y no las que operaciones entrego por otro medio. La
// mas reciente primero, sin la direccion: se borro al entregarla.
func (s *Service) EnviadasSinConfirmar(ctx context.Context, limite int) ([]RespuestaEnviadaSinConfirmar, error) {
	// Sin pedido son 50; pedir mas que el tope devuelve el tope. Antes volvia
	// al valor por defecto, y `limit=500` traia menos filas que `limit=100`.
	if limite <= 0 {
		limite = 50
	} else if limite > 100 {
		limite = 100
	}
	filas, err := s.pool.Query(ctx, `
		SELECT r.id::text, r.kind, r.delivered_at, r.user_id::text, u.deleted_at IS NOT NULL
		  FROM account_deletion_responses r
		  JOIN users u ON u.id = r.user_id
		 WHERE r.email_unconfirmed AND r.delivered_via = 'email'
		   AND r.delivered_at >= NOW() - make_interval(days => $2::int)
		 ORDER BY r.delivered_at DESC, r.id
		 LIMIT $1`, limite, diasDeLasEnviadasSinConfirmar)
	if err != nil {
		return nil, fmt.Errorf("listar las enviadas a un correo sin confirmar: %w", err)
	}
	out := make([]RespuestaEnviadaSinConfirmar, 0, 8)
	for filas.Next() {
		var r RespuestaEnviadaSinConfirmar
		if err := filas.Scan(&r.ID, &r.Tipo, &r.EntregadaEn, &r.UserID, &r.CuentaCerrada); err != nil {
			filas.Close()
			return nil, fmt.Errorf("leer la enviada: %w", err)
		}
		out = append(out, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, fmt.Errorf("recorrer las enviadas: %w", err)
	}
	for i := range out {
		if out[i].CuentaCerrada {
			continue // ya no tiene tarjeta: el panel muestra el id
		}
		if v, err := s.users.GetAdminView(ctx, out[i].UserID); err == nil {
			out[i].Cuenta = v
		}
	}
	return out, nil
}

// MarcarRespuestaEntregada deja constancia de una respuesta que operaciones
// entrego por otro medio: quien, cuando y como. Queda en la auditoria.
func (s *Service) MarcarRespuestaEntregada(ctx context.Context, id, adminID, nota string) error {
	nota = strings.TrimSpace(nota)
	if nota == "" {
		return ErrNotaRequerida
	}
	if len([]rune(nota)) > maxNota {
		return ErrNotaLarga
	}
	return s.conReintentos(ctx, func(tx pgx.Tx) error {
		var (
			userID                           string
			entregada, cancelada, sinDecidir bool
		)
		err := tx.QueryRow(ctx, `
			SELECT user_id::text, delivered_at IS NOT NULL, cancelled_at IS NOT NULL, kind = $2
			  FROM account_deletion_responses WHERE id = $1::uuid FOR UPDATE`, id, RespuestaSinDecidir,
		).Scan(&userID, &entregada, &cancelada, &sinDecidir)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRespuestaNoEncontrada
		}
		if err != nil {
			return fmt.Errorf("leer la respuesta: %w", err)
		}
		if entregada || cancelada {
			return ErrRespuestaCerrada
		}
		// Sin decidir no hay nada que entregar: se atiende la solicitud.
		if sinDecidir {
			return ErrRespuestaSinDecidir
		}
		if _, err := tx.Exec(ctx, `
			UPDATE account_deletion_responses
			   SET delivered_at = NOW(), delivered_via = 'manual', delivered_by = $2::uuid,
			       delivery_note = $3, email_enc = NULL
			 WHERE id = $1::uuid`, id, adminID, nota); err != nil {
			return fmt.Errorf("marcar la respuesta entregada: %w", err)
		}
		return auditar(ctx, tx, userID, "account_deletion_response_delivered", opciones{actor: adminID, respuesta: id})
	})
}
