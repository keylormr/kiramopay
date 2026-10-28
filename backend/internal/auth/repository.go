package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/kiramopay/backend/pkg/ventanaredis"
)

type Repository struct {
	db    *pgxpool.Pool
	redis *redis.Client
	// idleTimeout es cuanto puede pasar sin una accion de la persona antes de
	// que una sesion con actividad registrada deje de servir. Lo fija NewService
	// con JWT_IDLE_MINUTES; cero lo apaga.
	idleTimeout time.Duration
}

func NewRepository(db *pgxpool.Pool, redis *redis.Client) *Repository {
	return &Repository{db: db, redis: redis}
}

// SetIdleTimeout fija la ventana de inactividad. Cero o negativo la apaga.
func (r *Repository) SetIdleTimeout(d time.Duration) { r.idleTimeout = d }

// ─────────────────────────────────────────────────────────────────────────
//  user_sessions (high-level session tracking; ties access+refresh jti)
// ─────────────────────────────────────────────────────────────────────────

type SessionRecord struct {
	ID                string
	UserID            string
	AccessJTI         string
	RefreshJTI        string
	DeviceFingerprint string
	IPAddress         string
	UserAgent         string
	ExpiresAt         time.Time
}

// CreateSession declara expires_at como ::timestamptz y lo manda en UTC: igual
// que en InsertRefreshToken, el instante tiene que llegar entero a la base sin
// depender de la zona de la sesion ni de lo que Postgres infiera del parametro.
func (r *Repository) CreateSession(ctx context.Context, s *SessionRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO user_sessions
		   (id, user_id, access_jti, refresh_jti, device_fingerprint,
		    ip_address, user_agent, expires_at, token_hash, refresh_token_hash)
		 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
		         NULLIF($6,'')::inet, $7::text, $8::timestamptz, $9::text, $10::text)`,
		s.ID, s.UserID, s.AccessJTI, s.RefreshJTI, nullable(s.DeviceFingerprint),
		s.IPAddress, nullable(s.UserAgent), s.ExpiresAt.UTC(),
		s.AccessJTI, s.RefreshJTI, // legacy token_hash / refresh_token_hash mirror
	)
	return err
}

// UltimaAccionDeLaSesion devuelve la ultima accion de la persona en la sesion
// cuyo refresh token vigente es refreshJTI, o nil si no hay fila o nunca aviso
// (un cliente anterior a la migracion 085): el llamante mide entonces desde la
// emision del token, como siempre.
func (r *Repository) UltimaAccionDeLaSesion(ctx context.Context, refreshJTI string) (*time.Time, error) {
	var ultima *time.Time
	err := r.db.QueryRow(ctx,
		`SELECT last_activity_at FROM user_sessions
		  WHERE refresh_jti = $1::uuid AND revoked_at IS NULL`,
		refreshJTI,
	).Scan(&ultima)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("ultima accion de la sesion: %w", err)
	}
	return ultima, nil
}

// RegistrarAccion anota que la persona acaba de hacer algo en la sesion de
// accessJTI. Devuelve false, sin tocar nada, si la sesion ya no sirve: esta
// cerrada, o lleva mas de la ventana de inactividad sin acciones. Avisar no
// resucita una sesion vencida: el que llega tarde vuelve a entrar.
//
// Una sesion sin actividad registrada (last_activity_at NULL) la empieza a
// contar con este primer aviso.
func (r *Repository) RegistrarAccion(ctx context.Context, accessJTI string) (bool, error) {
	if accessJTI == "" {
		return false, nil
	}
	tag, err := r.db.Exec(ctx,
		`UPDATE user_sessions SET last_activity_at = NOW()
		  WHERE access_jti = $1::uuid AND revoked_at IS NULL
		    AND ($2::float8 <= 0 OR last_activity_at IS NULL
		         OR last_activity_at >= NOW() - make_interval(secs => $2::float8))`,
		accessJTI, r.idleTimeout.Seconds(),
	)
	if err != nil {
		return false, fmt.Errorf("registrar accion: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// MoverSesionAlRotar apunta la fila de sesion del dispositivo al par de tokens
// nuevo, en vez de crear otra.
//
// Antes cada rotacion insertaba una fila mas y no revocaba la anterior. Con un
// token de acceso de quince minutos, un telefono en uso acumulaba una sesion
// "activa" cada cuarto de hora durante toda la vida del refresh. La pantalla de
// dispositivos mostraba el MISMO aparato repetido decenas de veces, con una
// sola marcada como la actual, y quien viera esas filas creia que alguien mas
// habia entrado.
//
// Y cerrarlas era peor que inutil: RevokeSessionByID revoca la FAMILIA de
// refresh —correctamente, porque el dispositivo tiene el ultimo token de la
// cadena— y todas esas filas comparten familia. Cerrar una fila vieja mataba la
// sesion viva del propio aparato desde el que se estaba cerrando: seguia
// funcionando hasta quince minutos y despues quedaba fuera.
//
// created_at NO se toca: es cuando ese dispositivo entro, que es lo que la
// pantalla muestra. La IP y el user agent si se refrescan, para que diga donde
// esta el aparato ahora.
//
// Devuelve false si no habia fila que mover (revocada, o creada antes de este
// cambio); el llamante crea una entonces, para que una rotacion nunca falle por
// esto.
func (r *Repository) MoverSesionAlRotar(ctx context.Context, userID, parentRefreshJTI string, s *SessionRecord) (bool, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE user_sessions
		    SET access_jti = $3::uuid, refresh_jti = $4::uuid, expires_at = $5::timestamptz,
		        token_hash = $3::text, refresh_token_hash = $4::text,
		        ip_address = COALESCE(NULLIF($6,'')::inet, ip_address),
		        user_agent = COALESCE(NULLIF($7,''), user_agent)
		  WHERE user_id = $1::uuid AND refresh_jti = $2::uuid AND revoked_at IS NULL`,
		userID, parentRefreshJTI, s.AccessJTI, s.RefreshJTI, s.ExpiresAt.UTC(),
		s.IPAddress, s.UserAgent,
	)
	if err != nil {
		return false, fmt.Errorf("mover sesion al rotar: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (r *Repository) RevokeSessionByAccessJTI(ctx context.Context, jti string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE user_sessions SET revoked_at = NOW() WHERE access_jti = $1 AND revoked_at IS NULL`,
		jti,
	)
	return err
}

// IsAccessJTIRevoked returns true if the given access-token jti has been
// revoked at the session level. Fail-closed: any DB/Redis error returns true.
//
// Una sesion con actividad registrada que lleva mas de la ventana de
// inactividad sin una accion de la persona cuenta como revocada: el token de
// acceso vive 15 minutos y, sin esto, alargaria el cierre por inactividad hasta
// 45 (los 30 de la ventana mas el token que se emitio en el ultimo momento). El
// cliente trata el 401 como cualquier otro, intenta renovar, y la renovacion
// (Service.Refresh) cierra la sesion por la misma razon.
func (r *Repository) IsAccessJTIRevoked(ctx context.Context, jti string) (bool, error) {
	// Fast path: Redis denylist.
	if r.redis != nil {
		res, err := r.redis.Exists(ctx, denylistKey(jti)).Result()
		if err != nil {
			return true, fmt.Errorf("denylist lookup: %w", err)
		}
		if res > 0 {
			return true, nil
		}
	}
	var revokedAt *time.Time
	var inactiva bool
	err := r.db.QueryRow(ctx,
		`SELECT revoked_at,
		        ($2::float8 > 0 AND last_activity_at IS NOT NULL
		         AND last_activity_at < NOW() - make_interval(secs => $2::float8))
		   FROM user_sessions WHERE access_jti = $1`,
		jti, r.idleTimeout.Seconds(),
	).Scan(&revokedAt, &inactiva)
	if errors.Is(err, pgx.ErrNoRows) {
		// No session record found for this jti. We treat as NOT revoked here —
		// the access middleware also independently validates JWT signature + expiry.
		return false, nil
	}
	if err != nil {
		return true, fmt.Errorf("session lookup: %w", err)
	}
	return revokedAt != nil || inactiva, nil
}

// IsLiveSession dice si accessJTI es el token de acceso VIGENTE de una sesion
// abierta de userID. Es mas estricto que IsAccessJTIRevoked: un token sin fila
// (uno que ya roto, porque MoverSesionAlRotar paso la fila al nuevo) cuenta
// como no vigente. Lo usa RequireLiveSession en el panel de administracion.
// Todo token que se emite deja su fila (persistTokenRollout), asi que el
// vigente siempre la tiene.
func (r *Repository) IsLiveSession(ctx context.Context, userID, accessJTI string) (bool, error) {
	var viva bool
	if err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM user_sessions
		                 WHERE user_id = $1::uuid AND access_jti = $2::uuid AND revoked_at IS NULL)`,
		userID, accessJTI,
	).Scan(&viva); err != nil {
		return false, fmt.Errorf("live session lookup: %w", err)
	}
	return viva, nil
}

// ─────────────────────────────────────────────────────────────────────────
//  refresh_tokens (rotation + family revocation)
// ─────────────────────────────────────────────────────────────────────────

type RefreshTokenRecord struct {
	JTI       string
	UserID    string
	FamilyID  string
	ParentJTI string
	TokenHash string
	IssuedAt  time.Time
	ExpiresAt time.Time
	UsedAt    *time.Time
	RevokedAt *time.Time
	IPAddress string
	UserAgent string
}

// InsertRefreshToken guarda el token con sus fechas como INSTANTES, no como
// hora de pared.
//
// Antes los dos parametros iban con ::timestamp. Ese cast descarta la zona del
// time.Time y deja solo el reloj de pared; al entrar a la columna TIMESTAMPTZ,
// Postgres lo toma como hora de la zona de la SESION. Con la base en GMT, como
// en produccion, el desfase es cero y no se notaba; en cualquier otra zona el
// vencimiento se corria tantas horas como el desfase (seis de mas en
// America/Costa_Rica, nueve de menos en Asia/Tokyo: ahi el refresh nacia
// vencido). Con ::timestamptz el instante viaja entero y la zona de la sesion
// ya no interviene; .UTC() deja el valor en la zona que usa el resto del
// backend.
func (r *Repository) InsertRefreshToken(ctx context.Context, t *RefreshTokenRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO refresh_tokens
		   (jti, user_id, parent_jti, family_id, token_hash, issued_at, expires_at, ip_address, user_agent)
		 VALUES ($1::uuid, $2::uuid, NULLIF($3::text,'')::uuid, $4::uuid, $5::text,
		         $6::timestamptz, $7::timestamptz, NULLIF($8::text,'')::inet, $9::text)`,
		t.JTI, t.UserID, t.ParentJTI, t.FamilyID, t.TokenHash, t.IssuedAt.UTC(), t.ExpiresAt.UTC(),
		t.IPAddress, nullable(t.UserAgent),
	)
	return err
}

// ConsumeRefreshToken validates a refresh token against the DB and marks it
// used in the same transaction. Returns the row state BEFORE marking.
// If used_at is already set when we find it, the caller MUST treat this as
// token reuse and revoke the entire family.
func (r *Repository) ConsumeRefreshToken(ctx context.Context, jti, hash string) (*RefreshTokenRecord, bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, false, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback is a no-op once committed

	rec := &RefreshTokenRecord{}
	err = tx.QueryRow(ctx,
		`SELECT jti::text, user_id::text, family_id::text,
		        COALESCE(parent_jti::text, ''), token_hash,
		        issued_at, expires_at, used_at, revoked_at
		 FROM refresh_tokens WHERE jti = $1::uuid FOR UPDATE`,
		jti,
	).Scan(
		&rec.JTI, &rec.UserID, &rec.FamilyID, &rec.ParentJTI, &rec.TokenHash,
		&rec.IssuedAt, &rec.ExpiresAt, &rec.UsedAt, &rec.RevokedAt,
	)
	if err != nil {
		return nil, false, fmt.Errorf("select refresh token: %w", err)
	}

	reused := rec.UsedAt != nil
	if rec.RevokedAt != nil {
		return rec, false, fmt.Errorf("refresh token revoked")
	}
	if rec.TokenHash != hash {
		return rec, false, fmt.Errorf("refresh token hash mismatch")
	}
	if time.Now().After(rec.ExpiresAt) {
		return rec, false, fmt.Errorf("refresh token expired")
	}
	if reused {
		// Mark family revoked, and the device's session with it: a revoked
		// family with its session row still open is listed as "connected".
		if err := cerrarFamilia(ctx, tx, rec.FamilyID, MotivoReusoDeRefresh); err != nil {
			return rec, true, fmt.Errorf("revoke family on reuse: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return rec, true, fmt.Errorf("commit family revoke: %w", err)
		}
		return rec, true, fmt.Errorf("refresh token already used — family revoked")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET used_at = NOW() WHERE jti = $1::uuid`,
		jti,
	); err != nil {
		return rec, false, fmt.Errorf("mark used: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return rec, false, fmt.Errorf("commit: %w", err)
	}
	return rec, false, nil
}

func (r *Repository) RevokeRefreshFamily(ctx context.Context, familyID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE family_id = $1::uuid AND revoked_at IS NULL`,
		familyID,
	)
	return err
}

// FamilyOrigin returns the issue time of the oldest token in a refresh family —
// i.e. when the session originally started at login. Used to enforce the
// absolute session lifetime regardless of how many times the token has rotated.
func (r *Repository) FamilyOrigin(ctx context.Context, familyID string) (time.Time, error) {
	var origin time.Time
	if err := r.db.QueryRow(ctx,
		`SELECT MIN(issued_at) FROM refresh_tokens WHERE family_id = $1::uuid`,
		familyID,
	).Scan(&origin); err != nil {
		return time.Time{}, fmt.Errorf("family origin: %w", err)
	}
	return origin, nil
}

// ChangePasswordAndRevokeSessions updates the user's password hash and revokes
// every active refresh-token family and session in a SINGLE serializable
// transaction. Either all three succeed or none do — there is no window where
// the password is changed but old sessions survive (account-takeover risk).
func (r *Repository) ChangePasswordAndRevokeSessions(ctx context.Context, userID, newHash string) error {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback is a no-op once committed

	if _, err := tx.Exec(ctx,
		`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1::uuid`,
		userID, newHash,
	); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE user_id = $1::uuid AND revoked_at IS NULL`,
		userID,
	); err != nil {
		return fmt.Errorf("revoke refresh tokens: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE user_sessions SET revoked_at = NOW()
		 WHERE user_id = $1::uuid AND revoked_at IS NULL`,
		userID,
	); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	return tx.Commit(ctx)
}

// ─────────────────────────────────────────────────────────────────────────
//  Access-jti denylist (Redis, TTL = access token remaining lifetime)
// ─────────────────────────────────────────────────────────────────────────

func (r *Repository) DenylistAccessJTI(ctx context.Context, jti string, ttl time.Duration) error {
	if r.redis == nil {
		return nil
	}
	return r.redis.Set(ctx, denylistKey(jti), "1", ttl).Err()
}

func denylistKey(jti string) string { return "auth:denylist:" + jti }

// ─────────────────────────────────────────────────────────────────────────
//  password_reset_tokens
// ─────────────────────────────────────────────────────────────────────────

type PasswordResetTokenRecord struct {
	ID          string
	UserID      string
	TokenHash   string
	RequestedIP string
	ExpiresAt   time.Time
}

func (r *Repository) InsertPasswordResetToken(ctx context.Context, t *PasswordResetTokenRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, requested_ip, expires_at)
		 VALUES ($1::uuid, $2::uuid, $3, NULLIF($4,'')::inet, $5)`,
		t.ID, t.UserID, t.TokenHash, t.RequestedIP, t.ExpiresAt,
	)
	return err
}

// ConsumePasswordResetToken returns the user_id behind a valid (unused, unexpired) token,
// marking it used atomically. Constant error message for non-enumeration.
func (r *Repository) ConsumePasswordResetToken(ctx context.Context, hash string) (string, error) {
	var userID string
	err := r.db.QueryRow(ctx,
		`UPDATE password_reset_tokens
		 SET used_at = NOW()
		 WHERE token_hash = $1
		   AND used_at IS NULL
		   AND expires_at > NOW()
		 RETURNING user_id::text`,
		hash,
	).Scan(&userID)
	if err != nil {
		return "", err
	}
	return userID, nil
}

// ─────────────────────────────────────────────────────────────────────────
//  mfa_challenges
// ─────────────────────────────────────────────────────────────────────────

type MFAChallengeRecord struct {
	ID        string
	UserID    string
	Purpose   string
	CodeHash  string
	Metadata  string
	ExpiresAt time.Time
}

func (r *Repository) InsertMFAChallenge(ctx context.Context, c *MFAChallengeRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO mfa_challenges (id, user_id, purpose, code_hash, metadata, expires_at)
		 VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6)`,
		c.ID, c.UserID, c.Purpose, c.CodeHash, c.Metadata, c.ExpiresAt,
	)
	return err
}

// VerifyMFAChallenge atomically checks the supplied code hash against an
// active challenge for a given user+purpose. On success it marks the
// challenge verified and returns true. On failure it increments attempts
// and returns false; after max_attempts the challenge is killed.
func (r *Repository) VerifyMFAChallenge(ctx context.Context, userID, purpose, codeHash string) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		id          string
		storedHash  string
		attempts    int
		maxAttempts int
		verifiedAt  *time.Time
	)
	err = tx.QueryRow(ctx,
		`SELECT id::text, code_hash, attempts, max_attempts, verified_at
		 FROM mfa_challenges
		 WHERE user_id = $1::uuid
		   AND purpose = $2
		   AND verified_at IS NULL
		   AND expires_at > NOW()
		 ORDER BY created_at DESC
		 LIMIT 1
		 FOR UPDATE`,
		userID, purpose,
	).Scan(&id, &storedHash, &attempts, &maxAttempts, &verifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	if storedHash == codeHash {
		_, err = tx.Exec(ctx,
			`UPDATE mfa_challenges SET verified_at = NOW() WHERE id = $1::uuid`, id)
		if err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}

	newAttempts := attempts + 1
	if newAttempts >= maxAttempts {
		_, _ = tx.Exec(ctx,
			`UPDATE mfa_challenges SET attempts = $2, expires_at = NOW() WHERE id = $1::uuid`,
			id, newAttempts)
	} else {
		_, _ = tx.Exec(ctx,
			`UPDATE mfa_challenges SET attempts = $2 WHERE id = $1::uuid`, id, newAttempts)
	}
	return false, tx.Commit(ctx)
}

// ─────────────────────────────────────────────────────────────────────────
//  Registration phone OTP (Redis; short-lived, attempt-capped, single-use)
// ─────────────────────────────────────────────────────────────────────────

const (
	regOTPTTL         = 5 * time.Minute
	regOTPMaxAttempts = 5
	regVerifyTokenTTL = 15 * time.Minute
)

func regOTPKey(phone string) string         { return "auth:regotp:code:" + phone }
func regOTPAttemptsKey(phone string) string { return "auth:regotp:tries:" + phone }
func regVerifyKey(token string) string      { return "auth:regverify:" + token }

// PutRegistrationOTP stores the hashed code for a phone with a short TTL and
// resets the attempt counter. The latest send wins.
// regOTPRecord es el valor JSON del codigo pendiente. EmailHash guarda el
// HASH del buzon al que se ENVIO el codigo (vacio si viajo por SMS): probar
// el codigo prueba posesion de ese buzon, y Register compara este hash contra
// el del correo que se registra para marcar email_verified. Se guarda hasheado
// y no en claro para no dejar PII legible en Redis (replica, backup, MONITOR).
type regOTPRecord struct {
	CodeHash  string `json:"h"`
	EmailHash string `json:"eh,omitempty"`
}

func (r *Repository) PutRegistrationOTP(ctx context.Context, phone, codeHash, emailHash string) error {
	if r.redis == nil {
		return fmt.Errorf("otp store unavailable")
	}
	val, err := json.Marshal(regOTPRecord{CodeHash: codeHash, EmailHash: emailHash})
	if err != nil {
		return fmt.Errorf("encode otp record: %w", err)
	}
	pipe := r.redis.TxPipeline()
	pipe.Set(ctx, regOTPKey(phone), string(val), regOTPTTL)
	pipe.Set(ctx, regOTPAttemptsKey(phone), 0, regOTPTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// VerifyRegistrationOTP compares the supplied code hash against the stored one,
// enforcing an attempt cap. On success it consumes the code (single use) and
// returns the email the code was delivered to ("" when it went out by SMS).
func (r *Repository) VerifyRegistrationOTP(ctx context.Context, phone, codeHash string) (bool, string, error) {
	if r.redis == nil {
		return false, "", fmt.Errorf("otp store unavailable")
	}
	stored, err := r.redis.Get(ctx, regOTPKey(phone)).Result()
	if errors.Is(err, redis.Nil) {
		return false, "", nil // expired or never sent
	}
	if err != nil {
		return false, "", fmt.Errorf("otp lookup: %w", err)
	}
	// Valor JSON desde que el codigo viaja con el correo; un valor plano es un
	// codigo en vuelo emitido por la version anterior (TTL de minutos).
	rec := regOTPRecord{CodeHash: stored}
	if strings.HasPrefix(stored, "{") {
		if jerr := json.Unmarshal([]byte(stored), &rec); jerr != nil {
			return false, "", fmt.Errorf("decode otp record: %w", jerr)
		}
	}
	// El contador de intentos nace con vencimiento en PutRegistrationOTP, pero
	// un INCR a secas sobre una llave que ya no esta la recrea SIN vencimiento.
	// Y puede no estar: el desalojo de Redis elige llave por llave, asi que la
	// del codigo puede sobrevivir a la de los intentos aunque se hayan escrito
	// juntas. La llave resultante ademas deja de ser candidata al desalojo por
	// vencimiento, o sea que se acumula. ventanaredis.Contar solo fija el
	// vencimiento cuando la llave nace o cuando la encuentra atascada: en el
	// camino normal no toca el que ya trae.
	attempts, err := ventanaredis.Contar(ctx, r.redis, regOTPAttemptsKey(phone), regOTPTTL)
	if err != nil {
		return false, "", fmt.Errorf("otp attempts: %w", err)
	}
	if attempts > regOTPMaxAttempts {
		_ = r.redis.Del(ctx, regOTPKey(phone)).Err() // burn after too many tries
		return false, "", nil
	}
	if subtle.ConstantTimeCompare([]byte(rec.CodeHash), []byte(codeHash)) != 1 {
		return false, "", nil
	}
	_ = r.redis.Del(ctx, regOTPKey(phone), regOTPAttemptsKey(phone)).Err()
	return true, rec.EmailHash, nil
}

// regVerifyRecord es el valor JSON del token de verificacion: el telefono que
// probo posesion del codigo y, si el codigo viajo por correo, el HASH de ese
// correo (nunca el correo en claro).
type regVerifyRecord struct {
	Phone     string `json:"p"`
	EmailHash string `json:"eh,omitempty"`
}

// PutPhoneVerificationToken records that `phone` proved ownership (and, when
// the code was delivered by email, the HASH of the address that received it);
// the token must be presented at register time (short TTL, single use).
func (r *Repository) PutPhoneVerificationToken(ctx context.Context, token, phone, emailHash string) error {
	if r.redis == nil {
		return fmt.Errorf("otp store unavailable")
	}
	val, err := json.Marshal(regVerifyRecord{Phone: phone, EmailHash: emailHash})
	if err != nil {
		return fmt.Errorf("encode verify record: %w", err)
	}
	return r.redis.Set(ctx, regVerifyKey(token), string(val), regVerifyTokenTTL).Err()
}

// ConsumePhoneVerificationToken returns the phone (and verified email, if the
// code traveled by email) a token was issued for and
// deletes it (single use). Empty string if invalid/expired.
func (r *Repository) ConsumePhoneVerificationToken(ctx context.Context, token string) (string, string, error) {
	if r.redis == nil {
		return "", "", fmt.Errorf("otp store unavailable")
	}
	if token == "" {
		return "", "", nil
	}
	stored, err := r.redis.GetDel(ctx, regVerifyKey(token)).Result()
	if errors.Is(err, redis.Nil) {
		return "", "", nil
	}
	if err != nil {
		return "", "", fmt.Errorf("verify token consume: %w", err)
	}
	// Un valor plano es un token en vuelo de la version anterior (solo telefono).
	rec := regVerifyRecord{Phone: stored}
	if strings.HasPrefix(stored, "{") {
		if jerr := json.Unmarshal([]byte(stored), &rec); jerr != nil {
			return "", "", fmt.Errorf("decode verify record: %w", jerr)
		}
	}
	return rec.Phone, rec.EmailHash, nil
}

func nullable(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
