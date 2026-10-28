package user

import "time"

type UserRecord struct {
	ID                string     `json:"id"`
	Cedula            string     `json:"cedula"`
	Phone             string     `json:"phone"`
	PhoneVerified     bool       `json:"phone_verified"`
	Email             string     `json:"email,omitempty"`
	EmailVerified     bool       `json:"email_verified"`
	FirstName         string     `json:"first_name"`
	LastName          string     `json:"last_name"`
	BirthDate         *time.Time `json:"birth_date,omitempty"`
	ProfilePictureURL string     `json:"profile_picture_url,omitempty"`
	PasswordHash      string     `json:"-"`
	BiometricEnabled  bool       `json:"biometric_enabled"`
	KYCLevel          int        `json:"kyc_level"`
	KYCStatus         string     `json:"kyc_status"`
	Status            string     `json:"status"`
	// Username es el nombre de usuario con el que se entra. Vacio mientras la
	// cuenta no tenga uno: hasta la migracion 058 no existia ninguno.
	Username string `json:"username,omitempty"`
	// DemoLogin permite entrar a esta cuenta SIN CONTRASENA. No alcanza por si
	// sola: el servidor exige ademas que DEMO_LOGIN_ENABLED este encendida.
	// Nunca sale al cliente.
	DemoLogin bool `json:"-"`
	// PasswordlessLogin dice si la cuenta entra SIN CONTRASENA ahora mismo: esta
	// marcada (DemoLogin) Y el servidor tiene la bandera encendida. Es lo que la
	// app necesita saber: a esas cuentas no se les ofrece cambiar la contrasena
	// ni eliminar la cuenta, porque las dos piden la contrasena actual. No se
	// lee de la base: lo fija MarcarEntradaSinContrasena antes de responder.
	PasswordlessLogin bool `json:"passwordless_login"`
	// Plan es el plan personal (free, plus, pro; migracion 048). Hoy no hay
	// cobro: solo un administrador lo cambia, para pilotos. Define los topes de
	// metas de ahorro y tarjetas y la cuota del asistente.
	Plan string `json:"plan"`
	// Language es el idioma en que la persona usa la app (migracion 074). Con el
	// se escriben sus avisos y sus push; la app lo guarda con
	// PUT /users/me/language. nil (null en el JSON) es una cuenta que todavia
	// no eligio: sus avisos salen en espanol, y la app sabe que puede darle el
	// de la pantalla sin pisar una eleccion hecha en otro dispositivo.
	Language     *string    `json:"language"`
	ReferralCode string     `json:"referral_code"`
	ReferredBy   *string    `json:"-"` // atribucion interna; nunca sale al cliente
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}

// MarcarEntradaSinContrasena fija PasswordlessLogin con las mismas condiciones
// con que el login deja entrar sin contrasena: la cuenta marcada, activa, y la
// bandera del servidor encendida. Lo llaman quienes arman la respuesta al
// cliente (el perfil y el login); la bandera vive en cada uno de sus servicios.
func (u *UserRecord) MarcarEntradaSinContrasena(banderaEncendida bool) {
	u.PasswordlessLogin = banderaEncendida && u.DemoLogin && u.Status == "active"
}

type UpdateProfileRequest struct {
	FirstName         *string `json:"first_name,omitempty"`
	LastName          *string `json:"last_name,omitempty"`
	Email             *string `json:"email,omitempty"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
	// CurrentPassword es OBLIGATORIA para cambiar el correo, y solo para eso.
	//
	// El correo es el destino del enlace de recuperacion, asi que quien lo
	// cambia puede fijarse una contrasena nueva y quedarse con la cuenta. Sin
	// esta comprobacion la cadena era: conseguir una sesion -> cambiar el correo
	// (no pedia nada) -> pedir recuperacion -> la cuenta es suya PARA SIEMPRE,
	// y el duenno legitimo queda expulsado porque el reset revoca sus sesiones.
	//
	// Se pide la contrasena y no que el correo este verificado: exigir lo
	// segundo dejaria sin recuperacion a quien cambio su correo y despues
	// olvido la contrasena. Esto no le quita el camino a nadie que sepa su
	// contrasena.
	CurrentPassword string `json:"current_password,omitempty"`
}
