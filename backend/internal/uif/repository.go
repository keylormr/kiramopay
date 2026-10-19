package uif

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/transaction"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// outgoingTypesSQL son los tipos de movimiento que sacan valor de la billetera y
// por lo tanto suman al agregado diario de la UIF.
//
// NO se escribe a mano: sale de transaction.TiposDeSalida, la misma lista que usa
// el tope diario de gasto. Estaban duplicadas y se desincronizaron — al agregarse
// escrow, payouts y marketplace, esta se quedo con la lista vieja y la deteccion
// de estructuracion dejo de ver ese dinero, sin fallar ni avisar.
var outgoingTypesSQL = transaction.ListaSQLDeSalidas()

// incomingTypesSQL son los que traen valor: las entradas del mes. Tambien sale
// de transaction, por la misma razon.
var incomingTypesSQL = transaction.ListaSQLDeEntradas()

// SalidasDelDiaPorMoneda suma las salidas completadas de HOY, por moneda,
// incluido el movimiento recien confirmado. El agregado del dia junta todas las
// monedas por su equivalente en dolares; esta consulta trae cada una por su
// lado para convertirla.
func (r *Repository) SalidasDelDiaPorMoneda(ctx context.Context, userID string) (map[string]int64, error) {
	return r.salidasDelDia(ctx, userID, time.Now())
}

// salidasDelDia corta en el dia UTC de `ahora`: el mismo corte que
// `created_at::date = CURRENT_DATE` en el servidor, que corre en UTC, pero con
// el reloj del servicio.
func (r *Repository) salidasDelDia(ctx context.Context, userID string, ahora time.Time) (map[string]int64, error) {
	a := ahora.UTC()
	desde := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	rows, err := r.db.Query(ctx,
		`SELECT currency, COALESCE(SUM(amount), 0) FROM transactions
		  WHERE user_id = $1::uuid AND status = 'completed'
		    AND created_at >= $2 AND created_at < $3
		    AND type IN `+outgoingTypesSQL+`
		  GROUP BY currency`,
		userID, desde, desde.AddDate(0, 0, 1),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var moneda string
		var total int64
		if err := rows.Scan(&moneda, &total); err != nil {
			return nil, err
		}
		out[moneda] = total
	}
	return out, rows.Err()
}

// sumaDia es lo que una persona movio en un sentido, en una moneda y en un dia
// de Costa Rica.
type sumaDia struct {
	sentido string // sentidoSalida | sentidoEntrada
	moneda  string
	dia     time.Time // fecha civil, medianoche UTC (ver diaCR)
	monto   int64
}

// sqlMovimientosPorDia suma salidas y entradas completadas por sentido, moneda
// y dia de Costa Rica. El dia sale de aritmetica sobre el instante, igual que en
// el resumen de movimientos: created_at es TIMESTAMP sin zona en produccion (la
// hora de pared en UTC) y TIMESTAMPTZ en el esquema de pruebas, y
// extract(epoch) da lo mismo con los dos; AT TIME ZONE no. Los bordes van como
// instantes en UTC por la misma razon. created_date es la llave de particion y
// lleva la fecha del servidor: se acota con un dia de margen a cada lado para
// que la base pode las particiones que no tocan el rango.
var sqlMovimientosPorDia = `SELECT CASE WHEN type IN ` + outgoingTypesSQL + ` THEN 'salida' ELSE 'entrada' END,
	       COALESCE(currency, 'CRC'),
	       floor((extract(epoch FROM created_at) + $4::bigint) / 86400)::bigint,
	       COALESCE(SUM(amount), 0)::bigint
	  FROM transactions
	 WHERE user_id = $1::uuid AND status = 'completed'
	   AND created_at >= $2 AND created_at < $3
	   AND created_date >= $5::date AND created_date <= $6::date
	   AND (type IN ` + outgoingTypesSQL + ` OR type IN ` + incomingTypesSQL + `)
	 GROUP BY 1, 2, 3`

// movimientosPorDia trae lo que la persona movio entre dos instantes; `hasta` no
// se incluye.
func (r *Repository) movimientosPorDia(ctx context.Context, userID string, desde, hasta time.Time) ([]sumaDia, error) {
	rows, err := r.db.Query(ctx, sqlMovimientosPorDia,
		userID, desde.UTC(), hasta.UTC(), int64(desfaseCR),
		fecha(desde.UTC().AddDate(0, 0, -1)), fecha(hasta.UTC().AddDate(0, 0, 1)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sumaDia
	for rows.Next() {
		var f sumaDia
		var dia int64
		if err := rows.Scan(&f.sentido, &f.moneda, &dia, &f.monto); err != nil {
			return nil, err
		}
		f.dia = time.Unix(dia*86400, 0).UTC()
		out = append(out, f)
	}
	return out, rows.Err()
}

// totalCliente es lo que un cliente movio en el mes en un sentido y una moneda.
type totalCliente struct {
	userID  string
	sentido string
	moneda  string
	monto   int64
}

// totalesDelMes junta, para el cierre, lo que cada cliente movio en el mes, por
// sentido y moneda. Recorre `transactions` y no los registros de la UIF: el
// cierre tiene que ver tambien lo que entro por caminos que no le avisan a la
// UIF (lo que cobra un vendedor en escrow, una devolucion).
func (r *Repository) totalesDelMes(ctx context.Context, mes Mes) ([]totalCliente, error) {
	rows, err := r.db.Query(ctx, `
		SELECT user_id::text,
		       CASE WHEN type IN `+outgoingTypesSQL+` THEN 'salida' ELSE 'entrada' END,
		       COALESCE(currency, 'CRC'), COALESCE(SUM(amount), 0)::bigint
		  FROM transactions
		 WHERE status = 'completed'
		   AND created_at >= $1 AND created_at < $2
		   AND created_date >= $3::date AND created_date <= $4::date
		   AND (type IN `+outgoingTypesSQL+` OR type IN `+incomingTypesSQL+`)
		 GROUP BY 1, 2, 3
		 ORDER BY 1, 2, 3`,
		mes.Inicio.UTC(), mes.Fin.UTC(),
		fecha(mes.Inicio.UTC().AddDate(0, 0, -1)), fecha(mes.Fin.UTC().AddDate(0, 0, 1)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []totalCliente
	for rows.Next() {
		var t totalCliente
		if err := rows.Scan(&t.userID, &t.sentido, &t.moneda, &t.monto); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// registro es lo que queda de cada movimiento evaluado: su equivalente en
// dolares, y con que tasa, de que fecha y de donde salio. Sin tasa, esos cuatro
// van vacios y el movimiento queda igual, con su moneda y su monto.
type registro struct {
	userID, txID, sentido, moneda string
	monto                         int64
	mes                           time.Time
	conTasa                       bool
	usd                           int64
	cot                           Cotizacion
}

// yaEvaluado dice si el movimiento ya tiene su registro: su evaluacion termino,
// y evaluarlo otra vez lo contaria dos veces.
func (r *Repository) yaEvaluado(ctx context.Context, txID, sentido string) (bool, error) {
	var ya bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM uif_movimientos WHERE tx_id = $1::uuid AND sentido = $2)`,
		txID, sentido).Scan(&ya)
	return ya, err
}

// registrarMovimiento guarda el registro cuando la evaluacion termino. Devuelve
// false si ya estaba: dos evaluaciones del mismo movimiento corrieron a la vez.
func (r *Repository) registrarMovimiento(ctx context.Context, g registro) (bool, error) {
	var usd *int64
	var tasa *float64
	var fechaTasa, fuente *string
	if g.conTasa {
		f := fecha(g.cot.Fecha)
		usd, tasa, fechaTasa, fuente = &g.usd, &g.cot.PorDolar, &f, &g.cot.Fuente
	}
	ct, err := r.db.Exec(ctx, `
		INSERT INTO uif_movimientos
		       (user_id, tx_id, sentido, moneda, monto_minor, usd_minor, tasa, tasa_fecha, tasa_fuente, mes)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date, $9, $10::date)
		ON CONFLICT (tx_id, sentido) DO NOTHING`,
		g.userID, g.txID, g.sentido, g.moneda, g.monto, usd, tasa, fechaTasa, fuente, fecha(g.mes))
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// VentaDeReferencia es el tipo de cambio con que la UIF dolariza un monto de un
// dia: la venta de referencia del BCCR publicada para ese dia o, si no hay, la
// ultima anterior. Una tasa vieja se acepta; quien la usa da la alarma.
//
// tipo_de_cambio_diario nacio con la migracion 080. Para un dia sin ninguna fila
// ahi —los anteriores a esa migracion, o los primeros segundos despues de
// desplegarla— se usa el historial de exchange_rates: la tasa vigente al final
// de ese dia.
//
// Si no hay ninguna tasa, el error es errSinTipoDeCambio. Cualquier otro es la
// base que no respondio, y quien convierte no lo puede tratar como una moneda
// sin tasa.
func (r *Repository) VentaDeReferencia(ctx context.Context, moneda string, dia time.Time) (Cotizacion, error) {
	var c Cotizacion
	err := r.db.QueryRow(ctx, `
		SELECT por_dolar::float8, fecha, fuente FROM tipo_de_cambio_diario
		 WHERE moneda = $1 AND fecha <= $2::date
		 ORDER BY fecha DESC LIMIT 1`, moneda, fecha(dia)).Scan(&c.PorDolar, &c.Fecha, &c.Fuente)
	if err == nil || !errors.Is(err, pgx.ErrNoRows) {
		return c, err
	}
	// El final del dia civil de Costa Rica, como instante.
	finDelDia := dia.AddDate(0, 0, 1).Add(-time.Duration(desfaseCR) * time.Second)
	var confirmada time.Time
	err = r.db.QueryRow(ctx, `
		SELECT rate::float8, updated_at FROM exchange_rates
		 WHERE from_currency = 'USD' AND to_currency = $1 AND effective_from < $2
		 ORDER BY effective_from DESC LIMIT 1`, moneda, finDelDia.UTC()).Scan(&c.PorDolar, &confirmada)
	if errors.Is(err, pgx.ErrNoRows) {
		return Cotizacion{}, fmt.Errorf("%w: ninguna tasa de %s hasta el %s", errSinTipoDeCambio, moneda, fecha(dia))
	}
	if err != nil {
		return Cotizacion{}, err
	}
	// exchange_rates agrega una fila solo cuando la tasa cambia, y sella
	// updated_at cada vez que la fuente la confirma igual: la tasa vale hasta su
	// ultima confirmacion. Fechada el dia en que entro en vigor, una tasa que no
	// se movio en semanas parecia vieja y daba la alarma.
	c.Fecha, c.Fuente = diaCR(confirmada), FuenteHistorial
	if c.Fecha.After(dia) {
		c.Fecha = dia
	}
	return c, nil
}

// ventasDelRango trae de una vez las ventas de la tabla diaria que sirven para
// los dias de `desde` a `hasta`: las de esos dias y la ultima anterior a
// `desde`, en orden.
func (r *Repository) ventasDelRango(ctx context.Context, moneda string, desde, hasta time.Time) ([]Cotizacion, error) {
	rows, err := r.db.Query(ctx, `
		SELECT por_dolar::float8, fecha, fuente FROM tipo_de_cambio_diario
		 WHERE moneda = $1 AND fecha <= $3::date
		   AND fecha >= COALESCE((SELECT max(fecha) FROM tipo_de_cambio_diario
		                           WHERE moneda = $1 AND fecha <= $2::date), $2::date)
		 ORDER BY fecha`, moneda, fecha(desde), fecha(hasta))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cotizacion
	for rows.Next() {
		var c Cotizacion
		if err := rows.Scan(&c.PorDolar, &c.Fecha, &c.Fuente); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// hayMesIncompleto dice si el cliente ya tiene, en ese mes, el caso manual de
// un total del mes que no se pudo sumar entero.
func (r *Repository) hayMesIncompleto(ctx context.Context, userID, mes string) (bool, error) {
	var ya bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM uif_reports
		                WHERE user_id = $1::uuid AND mes = $2::date AND report_type = $3
		                  AND tx_id IS NOT NULL AND starts_with(reason, $4))`,
		userID, mes, TypeManual, prefijoMesIncompleto).Scan(&ya)
	return ya, err
}

// casosDelMes cuenta los casos de un tipo que un cliente ya tiene en un mes.
func (r *Repository) casosDelMes(ctx context.Context, userID string, mes Mes, tipo string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM uif_reports
		 WHERE user_id = $1::uuid AND mes = $2::date AND report_type = $3`,
		userID, fecha(mes.PrimerDia()), tipo).Scan(&n)
	return n, err
}

// mesCerrado dice si el cierre de un mes ya quedo hecho.
func (r *Repository) mesCerrado(ctx context.Context, mes Mes) (bool, error) {
	var ya bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM uif_cierres WHERE mes = $1::date)`, fecha(mes.PrimerDia())).Scan(&ya)
	return ya, err
}

// guardarCierre escribe los casos del cierre y la marca del mes en UNA
// transaccion: o queda todo, o no queda nada y el proximo intento lo rehace.
// Durante un despliegue corren dos instancias a la vez; el candado consultivo
// hace que una sola cierre el mes y que la otra encuentre la marca. Devuelve
// true si el mes ya estaba cerrado, y los casos que se abrieron: al reprocesar
// un mes (su marca borrada a mano), los que ya existian no se repiten.
func (r *Repository) guardarCierre(ctx context.Context, mes Mes, tasas string, clientes int, casos []*Report) (bool, []*Report, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	primer := fecha(mes.PrimerDia())
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('uif_cierre:' || $1::text))`, primer); err != nil {
		return false, nil, err
	}
	var ya bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM uif_cierres WHERE mes = $1::date)`, primer).Scan(&ya); err != nil {
		return false, nil, err
	}
	if ya {
		return true, nil, nil
	}
	var nuevos []*Report
	for _, rep := range casos {
		nuevo, err := insertarCaso(ctx, tx, rep)
		if err != nil {
			return false, nil, err
		}
		if nuevo {
			nuevos = append(nuevos, rep)
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO uif_cierres (mes, tasas, clientes, casos) VALUES ($1::date, $2, $3, $4)`,
		primer, tasas, clientes, len(nuevos)); err != nil {
		return false, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, nil, err
	}
	return false, nuevos, nil
}

type ejecutor interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// CreateReport guarda un caso. Devuelve false si ya existia: uno de cada tipo
// por movimiento (uq_uif_reports_tx_single) y, en los del cierre, que no tienen
// movimiento, uno de cada tipo por cliente y mes (uq_uif_reports_cierre).
func (r *Repository) CreateReport(ctx context.Context, rep *Report) (bool, error) {
	return insertarCaso(ctx, r.db, rep)
}

func insertarCaso(ctx context.Context, q ejecutor, rep *Report) (bool, error) {
	if rep.ID == "" {
		rep.ID = uuid.New().String()
	}
	if rep.Status == "" {
		rep.Status = StatusPending
	}
	var salidasMes, entradasMes *int64
	if rep.Mes != "" {
		salidasMes, entradasMes = &rep.SalidasMesUSD, &rep.EntradasMesUSD
	}
	ct, err := q.Exec(ctx,
		`INSERT INTO uif_reports
		   (id, user_id, tx_id, report_type, amount_minor, currency, daily_total_minor, reason, status,
		    acumulado_30d_minor, mes, salidas_mes_usd_minor, entradas_mes_usd_minor)
		 VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7, $8, $9, NULLIF($10, 0),
		         NULLIF($11, '')::date, $12, $13)
		 ON CONFLICT DO NOTHING`,
		rep.ID, rep.UserID, rep.TxID, rep.ReportType, rep.AmountMinor,
		rep.Currency, rep.DailyTotalMinor, rep.Reason, rep.Status, rep.Acumulado30Minor,
		rep.Mes, salidasMes, entradasMes,
	)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

const reportCols = `id::text, user_id::text, COALESCE(tx_id::text,''), report_type,
	amount_minor, currency, daily_total_minor, reason, status,
	COALESCE(reviewer_id::text,''), COALESCE(reviewer_notes,''), created_at, reviewed_at,
	COALESCE(acumulado_30d_minor, 0), COALESCE(mes::text, ''),
	COALESCE(salidas_mes_usd_minor, 0), COALESCE(entradas_mes_usd_minor, 0)`

func scanReport(row pgx.Row) (*Report, error) {
	rep := &Report{}
	if err := row.Scan(
		&rep.ID, &rep.UserID, &rep.TxID, &rep.ReportType, &rep.AmountMinor,
		&rep.Currency, &rep.DailyTotalMinor, &rep.Reason, &rep.Status,
		&rep.ReviewerID, &rep.ReviewerNotes, &rep.CreatedAt, &rep.ReviewedAt,
		&rep.Acumulado30Minor, &rep.Mes, &rep.SalidasMesUSD, &rep.EntradasMesUSD,
	); err != nil {
		return nil, err
	}
	return rep, nil
}

func (r *Repository) GetReport(ctx context.Context, id string) (*Report, error) {
	return scanReport(r.db.QueryRow(ctx,
		`SELECT `+reportCols+` FROM uif_reports WHERE id = $1::uuid`, id))
}

// ListByStatus returns reports filtered by status ("" = all), newest first.
func (r *Repository) ListByStatus(ctx context.Context, status string, limit int) ([]Report, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT ` + reportCols + ` FROM uif_reports`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT %d`, limit)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Report{}
	for rows.Next() {
		rep, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rep)
	}
	return out, rows.Err()
}

// Review records a compliance decision (submitted/dismissed/reviewed).
// PersonaDelCaso devuelve la cuenta del caso, o "" si el caso no existe.
func (r *Repository) PersonaDelCaso(ctx context.Context, id string) (string, error) {
	var userID string
	err := r.db.QueryRow(ctx, `SELECT user_id::text FROM uif_reports WHERE id = $1::uuid`, id).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return userID, err
}

func (r *Repository) Review(ctx context.Context, id, reviewerID, status, notes string) error {
	ct, err := r.db.Exec(ctx,
		`UPDATE uif_reports
		 SET status = $2, reviewer_id = NULLIF($3,'')::uuid, reviewer_notes = NULLIF($4,''),
		     reviewed_at = NOW()
		 WHERE id = $1::uuid AND status = 'pending'`,
		id, status, reviewerID, notes,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("report not found or already reviewed")
	}
	return nil
}
