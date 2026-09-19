package transaction

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Pool returns the underlying pool (used by Service to begin its own tx).
func (r *Repository) Pool() *pgxpool.Pool { return r.db }

// counterpartyNameMax is the width of transactions.counterparty_name
// (migration 001). Names now come from sources with WIDER columns —
// qr_merchants.name is VARCHAR(200), and users.first_name + last_name can
// concatenate to 201 — so an over-long name would abort the INSERT with
// SQLSTATE 22001 and, since CreateTransfer aborts on any non-duplicate error,
// fail the whole payment. A display name is never worth failing money over:
// truncate it here, at the single choke point every caller goes through.
const counterpartyNameMax = 100

// puntosSuspensivos marca que el nombre se corto. VARCHAR(100) cuenta
// caracteres (la base es UTF-8), asi que los tres puntos entran en el tope.
const puntosSuspensivos = "..."

// truncateCounterpartyName cuts on RUNE boundaries: Postgres counts characters,
// not bytes, and slicing bytes would split a multi-byte rune (an accented name
// is routine here) into invalid UTF-8.
//
// Y corta en un limite de PALABRA, con puntos suspensivos. Antes cortaba en el
// caracter 100 exacto: la descripcion larga de un escrow aparecia en el
// historial como "...para ver que hac", a mitad de palabra y sin ninguna senal
// de que faltaba texto.
func truncateCounterpartyName(name string) string {
	if len(name) <= counterpartyNameMax {
		return name // fast path: ASCII-length under the cap is always fine
	}
	runes := []rune(name)
	if len(runes) <= counterpartyNameMax {
		return name
	}
	cabe := counterpartyNameMax - len(puntosSuspensivos)
	corte := runes[:cabe]
	// Si lo que sigue al corte es un espacio, no se partio ninguna palabra. Si
	// no, se retrocede hasta el ultimo espacio, sin sacrificar mas de la mitad
	// del texto: una sola palabra enorme se corta donde caiga.
	if !unicode.IsSpace(runes[cabe]) {
		for i := len(corte) - 1; i >= cabe/2; i-- {
			if unicode.IsSpace(corte[i]) {
				corte = corte[:i]
				break
			}
		}
	}
	// "Cena, ..." o "S.A. ..." se leen mal: los separadores del final sobran.
	texto := strings.TrimRightFunc(string(corte), func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune(",;:.-", r)
	})
	if texto == "" {
		texto = string(runes[:cabe])
	}
	return texto + puntosSuspensivos
}

// Create inserts a transaction in pending status with idempotency_key
// promoted to its own column (and metadata still preserved for legacy reads).
// If a row already exists for (user_id, idempotency_key), returns it with
// ErrDuplicate so the caller can short-circuit.
func (r *Repository) Create(ctx context.Context, userID, walletID string, req *CreateTransactionRequest) (*TransactionRecord, error) {
	return r.CreateTx(ctx, r.db, userID, walletID, req)
}

// CreateTx is the tx-aware version used by Service inside an open transaction.
func (r *Repository) CreateTx(
	ctx context.Context,
	q pgxQuerier,
	userID, walletID string,
	req *CreateTransactionRequest,
) (*TransactionRecord, error) {
	id := uuid.New().String()
	now := time.Now()
	createdDate := now.Format("2006-01-02")

	metadata := "{}"

	tx := &TransactionRecord{
		ID:                id,
		WalletID:          walletID,
		UserID:            userID,
		Type:              req.Type,
		Amount:            req.Amount,
		Currency:          req.Currency,
		Fee:               req.Fee,
		CounterpartyType:  req.CounterpartyType,
		CounterpartyName:  truncateCounterpartyName(req.CounterpartyName),
		CounterpartyPhone: req.CounterpartyPhone,
		Status:            StatusPending,
		Metadata:          metadata,
		CreatedAt:         now,
		CreatedDate:       createdDate,
	}

	idem := req.IdempotencyKey
	_, err := q.Exec(ctx,
		`INSERT INTO transactions
		   (id, wallet_id, user_id, type, amount, currency, fee,
		    counterparty_type, counterparty_name, counterparty_phone,
		    status, metadata, idempotency_key, created_at, created_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
		         jsonb_build_object('description', COALESCE($12,'')),
		         NULLIF($13,''), $14, $15)`,
		tx.ID, tx.WalletID, tx.UserID, tx.Type, tx.Amount, tx.Currency, tx.Fee,
		tx.CounterpartyType, tx.CounterpartyName, tx.CounterpartyPhone,
		tx.Status, req.Description, idem, tx.CreatedAt, tx.CreatedDate,
	)
	if err != nil {
		// Unique violation on (user_id, idempotency_key, created_date) → duplicate.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, ferr := r.FindByIdempotencyKey(ctx, userID, idem)
			if ferr == nil {
				return existing, ErrDuplicate
			}
		}
		return nil, fmt.Errorf("insert transaction: %w", err)
	}
	return tx, nil
}

// ErrDuplicate signals that an idempotent retry hit an existing row.
var ErrDuplicate = errors.New("transaction with this idempotency key already exists")

func (r *Repository) FindByID(ctx context.Context, id string) (*TransactionRecord, error) {
	tx := &TransactionRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, wallet_id, user_id, type, amount, currency, fee,
		        COALESCE(counterparty_type, ''), COALESCE(counterparty_name, ''),
		        COALESCE(counterparty_phone, ''), status,
		        COALESCE(external_reference, ''), COALESCE(metadata::text, '{}'),
		        created_at, processed_at, completed_at, created_date::text
		 FROM transactions WHERE id = $1`,
		id,
	).Scan(
		&tx.ID, &tx.WalletID, &tx.UserID, &tx.Type, &tx.Amount, &tx.Currency, &tx.Fee,
		&tx.CounterpartyType, &tx.CounterpartyName, &tx.CounterpartyPhone,
		&tx.Status, &tx.ExternalReference, &tx.Metadata,
		&tx.CreatedAt, &tx.ProcessedAt, &tx.CompletedAt, &tx.CreatedDate,
	)
	if err != nil {
		return nil, fmt.Errorf("find transaction: %w", err)
	}
	return tx, nil
}

// patronDeBusqueda arma el patron ILIKE del texto que escribio la persona.
// Devuelve "" cuando no hay nada que buscar.
//
// Los comodines se ESCAPAN: sin esto, alguien que busca "50%" no esta pidiendo
// "las filas que empiezan con 50", esta pidiendo un comodin en medio del
// patron, y la pantalla devuelve cosas que no tienen nada que ver con lo que
// escribio. El caracter de escape es la barra invertida, que es el que LIKE usa
// por omision en Postgres.
//
// El largo se acota en RUNAS y no en bytes: cortar a la mitad un caracter
// multibyte produce texto invalido.
func patronDeBusqueda(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if runas := []rune(s); len(runas) > maxLargoBusqueda {
		s = string(runas[:maxLargoBusqueda])
	}
	s = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
	return "%" + s + "%"
}

// maxLargoBusqueda acota el texto de busqueda. Un patron ILIKE gigante no
// encuentra nada util y si cuesta recorrerlo.
const maxLargoBusqueda = 100

func (r *Repository) ListByUser(ctx context.Context, userID string, req *ListTransactionsRequest) (*TransactionListResponse, error) {
	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	// One WHERE clause shared by the count and the page query, so the two can
	// never drift apart (they used to be built twice by hand).
	where := "user_id = $1"
	args := []interface{}{userID}
	addFilter := func(cond string, val interface{}) {
		args = append(args, val)
		where += fmt.Sprintf(" AND "+cond, len(args))
	}
	if req.Type != "" {
		addFilter("type = $%d", req.Type)
	}
	if req.Status != "" {
		addFilter("status = $%d", req.Status)
	}
	if req.Currency != "" {
		addFilter("currency = $%d", req.Currency)
	}
	if !req.From.IsZero() {
		addFilter("created_at >= $%d", req.From)
	}
	if !req.To.IsZero() {
		addFilter("created_at < $%d", req.To)
	}
	if patron := patronDeBusqueda(req.Search); patron != "" {
		// El mismo parametro en las cuatro columnas: por eso el verbo va
		// indexado ($%[1]d) y no posicional, addFilter pasa un solo argumento.
		//
		// counterparty_name y la descripcion son lo que la pantalla muestra
		// como titulo del movimiento; type entra para que "sinpe" encuentre
		// los envios y los recibos aunque el titulo no diga la palabra.
		//
		// ILIKE con comodin a ambos lados no puede usar indice, pero la
		// consulta ya viene acotada a UN usuario por el filtro de arriba: lo
		// que se recorre son las filas de esa persona, no la tabla.
		addFilter(`(COALESCE(counterparty_name, '') ILIKE $%[1]d
		         OR COALESCE(metadata->>'description', '') ILIKE $%[1]d
		         OR COALESCE(external_reference, '') ILIKE $%[1]d
		         OR type ILIKE $%[1]d)`, patron)
	}

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM transactions WHERE "+where, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count transactions: %w", err)
	}

	query := `SELECT id, wallet_id, user_id, type, amount, currency, fee,
	                 COALESCE(counterparty_type, ''), COALESCE(counterparty_name, ''),
	                 COALESCE(counterparty_phone, ''), status,
	                 COALESCE(external_reference, ''), COALESCE(metadata::text, '{}'),
	                 created_at, processed_at, completed_at, created_date::text
	          FROM transactions WHERE ` + where +
		// id breaks ties so the order is TOTAL: two rows sharing a created_at
		// (same-instant writes are routine — a transfer inserts both legs at
		// once) would otherwise come back in an arbitrary order that Postgres
		// may vary between the queries of a paginated read, silently dropping
		// one row and repeating another across page boundaries.
		fmt.Sprintf(" ORDER BY created_at DESC, id DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	queryArgs := append(append([]interface{}{}, args...), limit, offset)

	rows, err := r.db.Query(ctx, query, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("list transactions: %w", err)
	}
	defer rows.Close()

	var transactions []TransactionRecord
	for rows.Next() {
		var tx TransactionRecord
		if err := rows.Scan(
			&tx.ID, &tx.WalletID, &tx.UserID, &tx.Type, &tx.Amount, &tx.Currency, &tx.Fee,
			&tx.CounterpartyType, &tx.CounterpartyName, &tx.CounterpartyPhone,
			&tx.Status, &tx.ExternalReference, &tx.Metadata,
			&tx.CreatedAt, &tx.ProcessedAt, &tx.CompletedAt, &tx.CreatedDate,
		); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		transactions = append(transactions, tx)
	}

	if transactions == nil {
		transactions = []TransactionRecord{}
	}

	return &TransactionListResponse{
		Transactions: transactions,
		Total:        total,
		Limit:        limit,
		Offset:       offset,
	}, nil
}

// filtroResumen es el WHERE que comparten las dos consultas del resumen, para
// que los grupos y los principales nunca describan conjuntos distintos.
//
// $1 usuario, $2/$3 instantes del rango en UTC, $4/$5 fechas de particion; cada
// consulta agrega su propio $6. Postgres rechaza un parametro que la consulta no
// usa, asi que el desfase y el tope no pueden ir en el filtro comun.
// Solo cuenta 'completed': un movimiento pendiente o fallido no movio dinero.
const filtroResumen = `user_id = $1
	   AND status = 'completed'
	   AND created_at >= $2 AND created_at < $3
	   AND created_date >= $4 AND created_date < $5`

// sqlResumenGrupos suma por (dia de Costa Rica, tipo, moneda).
//
// El dia sale de sumar el desfase ($6) al instante y dividir entre 86400.
// extract(epoch) sobre un TIMESTAMP sin zona lee su hora de pared como UTC, que
// es como la guarda el servidor, y sobre un TIMESTAMPTZ lee el instante: la
// cuenta da lo mismo en produccion y en el esquema de pruebas.
var sqlResumenGrupos = `SELECT floor((extract(epoch FROM created_at) + $6::bigint) / 86400)::bigint AS dia,
	       type,
	       COALESCE(currency, 'CRC') AS moneda,
	       COUNT(*)::int,
	       COALESCE(SUM(ABS(amount)), 0)::bigint
	  FROM transactions
	 WHERE ` + filtroResumen + `
	 GROUP BY 1, 2, 3
	 ORDER BY 1, 2, 3`

// sqlResumenPrincipales devuelve los $6 movimientos mas grandes de cada
// (tipo, moneda). El desempate por fecha e id hace el orden TOTAL: dos montos
// iguales no pueden cambiar de lugar entre una consulta y otra.
var sqlResumenPrincipales = `SELECT id, wallet_id, user_id, type, amount, moneda, fee,
	       counterparty_type, counterparty_name, counterparty_phone, status,
	       external_reference, metadata, created_at, processed_at, completed_at, created_date
	  FROM (
	        SELECT id, wallet_id, user_id, type, amount, COALESCE(currency, 'CRC') AS moneda, fee,
	               COALESCE(counterparty_type, '') AS counterparty_type,
	               COALESCE(counterparty_name, '') AS counterparty_name,
	               COALESCE(counterparty_phone, '') AS counterparty_phone,
	               status,
	               COALESCE(external_reference, '') AS external_reference,
	               COALESCE(metadata::text, '{}') AS metadata,
	               created_at, processed_at, completed_at, created_date::text AS created_date,
	               ROW_NUMBER() OVER (
	                   PARTITION BY type, COALESCE(currency, 'CRC')
	                   ORDER BY amount DESC, created_at DESC, id DESC
	               ) AS puesto
	          FROM transactions
	         WHERE ` + filtroResumen + `
	       ) principales
	 WHERE puesto <= $6
	 ORDER BY amount DESC, created_at DESC, id DESC`

// sqlPrimerMovimiento busca el primer movimiento completado de la persona, en
// cualquier fecha. Ordena por la llave de particion primero para que la base
// recorra el indice (user_id, created_date) de cada particion y se detenga en
// la primera fila, en vez de leer todo el historial.
var sqlPrimerMovimiento = `SELECT floor((extract(epoch FROM created_at) + $2::bigint) / 86400)::bigint
	  FROM transactions
	 WHERE user_id = $1
	   AND status = 'completed'
	 ORDER BY created_date, created_at
	 LIMIT 1`

// PrimerDiaConMovimientos devuelve el dia civil (con el desfase dado) del
// primer movimiento completado del usuario, o nil si no tiene ninguno.
func (r *Repository) PrimerDiaConMovimientos(ctx context.Context, userID string, desfaseSegundos int64) (*string, error) {
	var dia int64
	err := r.db.QueryRow(ctx, sqlPrimerMovimiento, userID, desfaseSegundos).Scan(&dia)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("summary first date: %w", err)
	}
	fecha := fechaDeDiaEpoch(dia)
	return &fecha, nil
}

// GruposResumen suma los movimientos completados del rango por dia, tipo y
// moneda.
func (r *Repository) GruposResumen(ctx context.Context, userID string, rango RangoResumen) ([]GrupoResumen, error) {
	rows, err := r.db.Query(ctx, sqlResumenGrupos,
		userID, rango.Inicio, rango.Fin, rango.ParticionDesde, rango.ParticionHasta, rango.DesfaseSegundos)
	if err != nil {
		return nil, fmt.Errorf("summary groups: %w", err)
	}
	defer rows.Close()

	grupos := []GrupoResumen{}
	for rows.Next() {
		var (
			dia int64
			g   GrupoResumen
		)
		if err := rows.Scan(&dia, &g.Type, &g.Currency, &g.Count, &g.Amount); err != nil {
			return nil, fmt.Errorf("scan summary group: %w", err)
		}
		g.Fecha = fechaDeDiaEpoch(dia)
		grupos = append(grupos, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("summary groups: %w", err)
	}
	return grupos, nil
}

// PrincipalesResumen devuelve los movimientos completados mas grandes del
// rango, hasta porTipo por cada (tipo, moneda).
func (r *Repository) PrincipalesResumen(ctx context.Context, userID string, rango RangoResumen, porTipo int) ([]TransactionRecord, error) {
	rows, err := r.db.Query(ctx, sqlResumenPrincipales,
		userID, rango.Inicio, rango.Fin, rango.ParticionDesde, rango.ParticionHasta, porTipo)
	if err != nil {
		return nil, fmt.Errorf("summary top: %w", err)
	}
	defer rows.Close()

	top := []TransactionRecord{}
	for rows.Next() {
		var tx TransactionRecord
		if err := rows.Scan(
			&tx.ID, &tx.WalletID, &tx.UserID, &tx.Type, &tx.Amount, &tx.Currency, &tx.Fee,
			&tx.CounterpartyType, &tx.CounterpartyName, &tx.CounterpartyPhone,
			&tx.Status, &tx.ExternalReference, &tx.Metadata,
			&tx.CreatedAt, &tx.ProcessedAt, &tx.CompletedAt, &tx.CreatedDate,
		); err != nil {
			return nil, fmt.Errorf("scan summary top: %w", err)
		}
		top = append(top, tx)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("summary top: %w", err)
	}
	return top, nil
}

func (r *Repository) UpdateStatusTx(ctx context.Context, q pgxQuerier, id, status string) error {
	var setClause string
	switch status {
	case StatusProcessing:
		setClause = "status = $2, processed_at = NOW()"
	case StatusCompleted:
		setClause = "status = $2, completed_at = NOW()"
	default:
		setClause = "status = $2"
	}
	_, err := q.Exec(ctx,
		fmt.Sprintf("UPDATE transactions SET %s WHERE id = $1", setClause),
		id, status,
	)
	return err
}

func (r *Repository) UpdateStatus(ctx context.Context, id, status string) error {
	return r.UpdateStatusTx(ctx, r.db, id, status)
}

// MarcarFallida rotula la fila como fallida SOLO si no llego a completarse.
//
// El filtro por estado no es cosmetico. 'completed' lo escribe el gancho DENTRO
// de la transaccion del asiento, asi que equivale a "el dinero se movio";
// pisarlo desde fuera afirmaria lo contrario de lo que el libro tiene escrito, y
// esa fila deja de contar para el tope de gasto y para la vigilancia.
func (r *Repository) MarcarFallida(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE transactions SET status = $2 WHERE id = $1 AND status <> $3`,
		id, StatusFailed, StatusCompleted)
	return err
}

// DailyOutgoingMinor sums today's completed outgoing transactions (minor units)
// for the user in the given currency. The per-wallet daily limit is enforced
// against this computed value because wallets.daily_spent is no longer
// maintained after the journal-ledger refactor (migration 020 dropped its only
// writer), which had silently disabled the cumulative daily cap.
//
// La lista de tipos es la definicion operativa de "salida". Un tipo que saque
// dinero de la billetera y NO este aqui hace que el tope diario valga mas de lo
// que dice: se gasta el tope entero por ese camino y despues otra vez por los
// demas. Le paso a escrow_fund, que estuvo fuera de la lista mientras escrow
// tampoco consultaba el tope. Al agregar un movimiento saliente hay que
// agregarlo aqui tambien.
//
// savings_deposit queda fuera a proposito: mueve el dinero a SYSTEM:SAVINGS,
// que sigue siendo del usuario y puede retirar cuando quiera. No sale de su
// control, asi que no es gasto.
//
// payout_sent y marketplace SI estan: los dos debitan la billetera del usuario
// contra una contraparte externa. Hoy ninguno de los dos opera en produccion
// —los rieles de payout no se registran y los cobros del marketplace se
// rechazan—, pero la lista describe lo que ES una salida, no lo que esta
// encendido: el dia que se enciendan tienen que contar desde el primer
// movimiento, no desde que alguien se acuerde de agregarlos aqui.
// sqlSalidaDiaria esta en una constante, y no incrustada en la llamada, para
// que una prueba pueda leer LA MISMA cadena que se ejecuta y comprobar que la
// lista de tipos no se quede corta.
// TiposDeSalida es la definicion operativa de "salida de dinero": los tipos de
// movimiento que sacan valor de la billetera del usuario.
//
// Vive aqui y se exporta porque hay DOS consumidores que tienen que estar de
// acuerdo: el tope diario de gasto y el agregado diario de la UIF (deteccion de
// estructuracion). Estaban escritos por separado y se desincronizaron: cuando se
// agregaron escrow, payouts y marketplace, el de la UIF quedo con la lista
// vieja y dejo de ver ese dinero — sin fallar, simplemente vigilando menos.
//
// savings_deposit queda fuera a proposito: mueve el dinero a SYSTEM:SAVINGS, que
// sigue siendo del usuario y puede retirar cuando quiera. No sale de su control,
// asi que no es gasto.
// crypto_send es valor que sale sin que se mueva un centimo de fiat: el activo
// pasa a otra persona y la fila lleva su equivalente en dolares. Cuenta igual,
// porque lo que el tope y la UIF miden es valor saliendo, no la moneda en que
// sale — dejarlo fuera seria el camino abierto para sacar por cripto lo que el
// tope no deja sacar por transferencia.
var TiposDeSalida = []string{
	"sinpe_send", "qr_payment", "bill_payment", "recharge", "withdrawal",
	"p2p_send", "crypto_buy", "crypto_send", "escrow_fund", "payout_sent", "marketplace",
}

// ListaSQLDeSalidas arma el `('a','b',...)` de un IN a partir de TiposDeSalida,
// para que los dos consumidores lean la MISMA lista en vez de copiarla.
func ListaSQLDeSalidas() string {
	entre := make([]string, len(TiposDeSalida))
	for i, t := range TiposDeSalida {
		entre[i] = "'" + t + "'"
	}
	return "(" + strings.Join(entre, ",") + ")"
}

var sqlSalidaDiaria = `SELECT COALESCE(SUM(amount), 0)
		 FROM transactions
		 WHERE user_id = $1
		   AND currency = $2
		   AND status = 'completed'
		   AND created_date = CURRENT_DATE
		   AND type IN ` + ListaSQLDeSalidas()

func (r *Repository) DailyOutgoingMinor(ctx context.Context, userID, currency string) (int64, error) {
	return r.DailyOutgoingMinorTx(ctx, r.db, userID, currency)
}

// DailyOutgoingMinorTx corre la MISMA suma por la transaccion del asiento.
//
// Existe porque sumar por el pool y decidir afuera no frena nada bajo
// concurrencia: dos salidas simultaneas leen la misma suma y las dos pasan.
// Adentro del asiento si frena, y no por arte de magia: el libro toma
// `SELECT ... FOR UPDATE` sobre la billetera del pagador ANTES de correr el
// gancho, asi que la segunda salida espera a que la primera confirme y recien
// entonces suma. Y ve la fila de la primera porque su estado 'completed' se
// escribe dentro de esa misma transaccion (eso lo dejo T1).
func (r *Repository) DailyOutgoingMinorTx(ctx context.Context, q pgxQuerier, userID, currency string) (int64, error) {
	var total int64
	err := q.QueryRow(ctx, sqlSalidaDiaria, userID, currency).Scan(&total)
	return total, err
}

// El tope MENSUAL existia en la base (wallets.monthly_limit), lo calculaba el
// modulo de KYC por nivel, lo escribia al aprobar una verificacion y el perfil
// se lo mostraba a la persona como una promesa. No lo comparaba nadie: se podia
// gastar el tope diario todos los dias del mes sin que ese numero frenara nunca
// nada.
//
// Se filtra por created_date, que es la llave de particion: usar created_at
// obligaria a recorrer todas las particiones del rango en vez de podarlas.
var sqlSalidaMensual = `SELECT COALESCE(SUM(amount), 0)
		 FROM transactions
		 WHERE user_id = $1
		   AND currency = $2
		   AND status = 'completed'
		   AND created_date >= date_trunc('month', CURRENT_DATE)::date
		   AND created_date < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
		   AND type IN ` + ListaSQLDeSalidas()

func (r *Repository) MonthlyOutgoingMinor(ctx context.Context, userID, currency string) (int64, error) {
	return r.MonthlyOutgoingMinorTx(ctx, r.db, userID, currency)
}

func (r *Repository) MonthlyOutgoingMinorTx(ctx context.Context, q pgxQuerier, userID, currency string) (int64, error) {
	var total int64
	err := q.QueryRow(ctx, sqlSalidaMensual, userID, currency).Scan(&total)
	return total, err
}

func (r *Repository) FindByIdempotencyKey(ctx context.Context, userID, key string) (*TransactionRecord, error) {
	tx := &TransactionRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, wallet_id, user_id, type, amount, currency, fee, status,
		        COALESCE(metadata::text, '{}'), created_at, created_date::text
		 FROM transactions
		 WHERE user_id = $1 AND idempotency_key = $2
		 LIMIT 1`,
		userID, key,
	).Scan(
		&tx.ID, &tx.WalletID, &tx.UserID, &tx.Type, &tx.Amount, &tx.Currency,
		&tx.Fee, &tx.Status, &tx.Metadata, &tx.CreatedAt, &tx.CreatedDate,
	)
	if err != nil {
		return nil, err
	}
	return tx, nil
}

// pgxQuerier is satisfied by *pgxpool.Pool and pgx.Tx — lets the same SQL
// run either standalone or inside a caller-managed transaction.
type pgxQuerier interface {
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}
