package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/loyalty"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

func setupAuthService(t *testing.T) (*auth.Service, *auth.Repository) {
	t.Helper()
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)

	authRepo := auth.NewRepository(pool, redis)
	userRepo := user.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	jwtMgr := jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour)
	lockoutStore := middleware.NewRedisLockoutStore(redis, time.Minute)

	svc := auth.NewService(authRepo, userRepo, walletRepo, jwtMgr, &auth.Options{
		LockoutStore: lockoutStore,
	})
	return svc, authRepo
}

var emptyCtx = auth.LoginContext{}

func TestRegister_Success(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula:    "702650930",
		Phone:     "+50688881234",
		FirstName: "Keilor",
		LastName:  "Martinez",
		Password:  "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	if resp == nil || resp.User == nil || resp.Tokens == nil {
		t.Fatal("Register() returned nil pieces")
	}
	if resp.User.Cedula != "702650930" {
		t.Fatalf("expected cedula 702650930, got %s", resp.User.Cedula)
	}
	if resp.Tokens.AccessToken == "" || resp.Tokens.RefreshToken == "" {
		t.Fatal("tokens missing")
	}
	if resp.Tokens.FamilyID == "" {
		t.Fatal("family id missing")
	}
	// Every account is born with its own invitation code (generated on insert).
	if len(resp.User.ReferralCode) != 8 {
		t.Fatalf("expected an 8-char referral code, got %q", resp.User.ReferralCode)
	}
}

func TestRegister_DuplicateCedula(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("first register: %v", err)
	}
	_, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688885678",
		FirstName: "Otro", LastName: "Usuario", Password: "Other2024!",
	}, emptyCtx)
	if !errors.Is(err, auth.ErrUserExists) {
		t.Fatalf("expected ErrUserExists for duplicate cedula, got %v", err)
	}
}

// El telefono repetido no lo detecta la busqueda previa por cedula: choca en
// el indice unico al insertar y debe salir como el MISMO ErrUserExists (no
// como un error crudo de la BD), sin dejar la cuenta nueva a medias.
func TestRegister_DuplicatePhone(t *testing.T) {
	svc, _ := setupAuthService(t)
	pool := testutil.TestDB(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("first register: %v", err)
	}
	_, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "304440999", Phone: "+50688881234",
		FirstName: "Otro", LastName: "Usuario", Password: "Other2024!",
	}, emptyCtx)
	if !errors.Is(err, auth.ErrUserExists) {
		t.Fatalf("expected ErrUserExists for duplicate phone, got %v", err)
	}
	if u, _ := user.NewRepository(pool).FindByCedula(ctx, "304440999"); u != nil {
		t.Fatal("el telefono repetido no debia dejar la cuenta nueva creada")
	}
}

func TestLogin_Success(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("register: %v", err)
	}
	resp, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula:   "702650930",
		Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if resp.Tokens.AccessToken == "" {
		t.Fatal("empty access token")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "WrongPass2024!",
	}, emptyCtx); err == nil {
		t.Fatal("expected error")
	}
}

func TestLogin_NonExistentUser(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "999999999", Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("expected error")
	}
}

func TestChangePassword_Success(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := svc.ChangePassword(ctx, resp.User.ID, &auth.ChangePasswordRequest{
		OldPassword: "Kiramopay2024!",
		NewPassword: "NewPass2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "NewPass2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("login w/ new password: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("old password must NOT work")
	}
}

// ─────────────────────────────────────────────────────────────────────────
//  Recuperación de contraseña
//
//  Todo este flujo estaba SIN cobertura pese a ser el camino por el que se
//  cambia una credencial sin conocer la anterior: el que mas importa que este
//  bien. Los casos de abajo cubren el exito de punta a punta y las tres
//  propiedades de seguridad que el token debe cumplir.
// ─────────────────────────────────────────────────────────────────────────

// registrarUsuario deja una cuenta lista y devuelve su contraseña inicial.
func registrarUsuario(t *testing.T, svc *auth.Service) string {
	t.Helper()
	const inicial = "Kiramopay2024!"
	if _, err := svc.Register(context.Background(), &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: inicial,
	}, emptyCtx); err != nil {
		t.Fatalf("registro: %v", err)
	}
	return inicial
}

func TestResetPassword_FlujoCompleto(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	inicial := registrarUsuario(t, svc)

	token, err := svc.ForgotPassword(ctx, "702650930", emptyCtx)
	if err != nil {
		t.Fatalf("solicitud de recuperación: %v", err)
	}
	if token == "" {
		t.Fatal("no se emitió token de recuperación")
	}

	const nueva = "NuevaClave2026!"
	if err := svc.ResetPassword(ctx, &auth.ResetPasswordRequest{
		Token: token, NewPassword: nueva,
	}, emptyCtx); err != nil {
		t.Fatalf("restablecimiento: %v", err)
	}

	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: nueva,
	}, emptyCtx); err != nil {
		t.Fatalf("no se pudo entrar con la contraseña nueva: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: inicial,
	}, emptyCtx); err == nil {
		t.Fatal("la contraseña vieja debe dejar de servir")
	}
}

// Un token de recuperación es de un solo uso. Si se pudiera repetir, quien lo
// viera una vez (en un correo reenviado, en el historial del navegador) podria
// volver a tomar la cuenta despues de que el dueño la recupere.
func TestResetPassword_ElTokenNoSeReutiliza(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	registrarUsuario(t, svc)

	token, err := svc.ForgotPassword(ctx, "702650930", emptyCtx)
	if err != nil {
		t.Fatalf("solicitud de recuperación: %v", err)
	}
	if err := svc.ResetPassword(ctx, &auth.ResetPasswordRequest{
		Token: token, NewPassword: "NuevaClave2026!",
	}, emptyCtx); err != nil {
		t.Fatalf("primer restablecimiento: %v", err)
	}

	if err := svc.ResetPassword(ctx, &auth.ResetPasswordRequest{
		Token: token, NewPassword: "OtraDistinta2026!",
	}, emptyCtx); err == nil {
		t.Fatal("el token se aceptó dos veces: debe consumirse en el primer uso")
	}
	// Y la contraseña no puede haber quedado en la del segundo intento.
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "OtraDistinta2026!",
	}, emptyCtx); err == nil {
		t.Fatal("el segundo intento llegó a cambiar la contraseña")
	}
}

func TestResetPassword_TokenInvalido(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	inicial := registrarUsuario(t, svc)

	if err := svc.ResetPassword(ctx, &auth.ResetPasswordRequest{
		Token: "token-que-nadie-emitió", NewPassword: "NuevaClave2026!",
	}, emptyCtx); err == nil {
		t.Fatal("un token inventado no debe restablecer nada")
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: inicial,
	}, emptyCtx); err != nil {
		t.Fatalf("la contraseña original debía seguir intacta: %v", err)
	}
}

// Pedir recuperación para una cédula inexistente responde igual que para una
// real: si respondiera distinto, el endpoint serviria para averiguar quien
// tiene cuenta.
func TestForgotPassword_NoRevelaSiLaCuentaExiste(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	registrarUsuario(t, svc)

	if _, err := svc.ForgotPassword(ctx, "111111111", emptyCtx); err != nil {
		t.Fatalf("una cédula inexistente no debe producir error: %v", err)
	}
}

func TestRefreshTokenRotation(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	tokens, err := svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if tokens.AccessToken == resp.Tokens.AccessToken {
		t.Fatal("refresh must yield a fresh access token")
	}
	if tokens.RefreshToken == resp.Tokens.RefreshToken {
		t.Fatal("refresh must rotate the refresh token")
	}
	// Reusing the original refresh token now must fail (and revoke family).
	if _, err := svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("reusing original refresh token must fail")
	}
	// The newly issued one must ALSO be invalid now (family revoked).
	if _, err := svc.Refresh(ctx, tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("after reuse-detection, all tokens in family must be invalid")
	}
}

// Falsos de entrega para fijar el canal del OTP de registro.
type correoCapturado struct {
	to, subject, texto, html string
}

type emailFalso struct{ enviados []correoCapturado }

func (f *emailFalso) SendEmail(ctx context.Context, to, subject, textBody, htmlBody string) error {
	f.enviados = append(f.enviados, correoCapturado{to, subject, textBody, htmlBody})
	return nil
}

type smsFalso struct{ enviados int }

func (f *smsFalso) SendSMS(ctx context.Context, to, body string) error {
	f.enviados++
	return nil
}

// El codigo de registro viaja por CORREO cuando hay remitente configurado:
// es el canal real hoy (SES). El SMS, aunque este configurado, queda de
// respaldo — antes el codigo salia solo por SMS y como no hay proveedor en
// produccion, nadie podia terminar de registrarse.
func TestSendRegistrationOTP_ViajaPorCorreo(t *testing.T) {
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	correo := &emailFalso{}
	sms := &smsFalso{}

	svc := auth.NewService(
		auth.NewRepository(pool, redis),
		user.NewRepository(pool),
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{EmailSender: correo, SMSSender: sms},
	)

	codigo, err := svc.SendRegistrationOTP(context.Background(), "+50670000001", "persona@example.com")
	if err != nil {
		t.Fatalf("SendRegistrationOTP: %v", err)
	}
	if len(correo.enviados) != 1 {
		t.Fatalf("se esperaba 1 correo, hubo %d", len(correo.enviados))
	}
	if sms.enviados != 0 {
		t.Fatalf("el SMS no debia usarse habiendo correo; se enviaron %d", sms.enviados)
	}
	c := correo.enviados[0]
	if c.to != "persona@example.com" {
		t.Errorf("destinatario = %q", c.to)
	}
	if !strings.Contains(c.texto, codigo) || !strings.Contains(c.html, codigo) {
		t.Error("el codigo devuelto no aparece en el cuerpo del correo")
	}
}

// Sin correo en la peticion (o sin remitente), el SMS sigue siendo el respaldo.
func TestSendRegistrationOTP_RespaldoPorSMS(t *testing.T) {
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	sms := &smsFalso{}

	svc := auth.NewService(
		auth.NewRepository(pool, redis),
		user.NewRepository(pool),
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{SMSSender: sms},
	)

	if _, err := svc.SendRegistrationOTP(context.Background(), "+50670000002", ""); err != nil {
		t.Fatalf("SendRegistrationOTP sin correo: %v", err)
	}
	if sms.enviados != 1 {
		t.Fatalf("se esperaba 1 SMS de respaldo, hubo %d", sms.enviados)
	}
}

// Servicio con remitente de correo falso, para los flujos que atan el OTP al
// correo (registro verificado y login por correo).
func armarServicioConCorreo(t *testing.T) (*auth.Service, *emailFalso) {
	t.Helper()
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	correo := &emailFalso{}
	svc := auth.NewService(
		auth.NewRepository(pool, redis),
		user.NewRepository(pool),
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{
			EmailSender:  correo,
			LockoutStore: middleware.NewRedisLockoutStore(redis, time.Minute),
		},
	)
	return svc, correo
}

// registrarVerificado corre el flujo completo: OTP al correo, verificacion,
// registro con el token. Devuelve la respuesta del registro.
func registrarVerificado(t *testing.T, svc *auth.Service, cedula, phone, email, password string) *auth.LoginResponse {
	t.Helper()
	ctx := context.Background()
	codigo, err := svc.SendRegistrationOTP(ctx, phone, email)
	if err != nil {
		t.Fatalf("SendRegistrationOTP: %v", err)
	}
	token, err := svc.VerifyRegistrationOTP(ctx, phone, codigo)
	if err != nil {
		t.Fatalf("VerifyRegistrationOTP: %v", err)
	}
	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: cedula, Phone: phone, Email: email,
		FirstName: "Prueba", LastName: "Flexible", Password: password,
		VerificationToken: token,
	}, emptyCtx)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	return resp
}

// El OTP viajo al correo y el registro lo consumio: la cuenta nace con el
// correo verificado, que es la condicion para poder entrar con el.
func TestRegister_OTPPorCorreoMarcaEmailVerificado(t *testing.T) {
	svc, _ := armarServicioConCorreo(t)
	resp := registrarVerificado(t, svc, "301110222", "+50670000010", "flexible@example.com", "Kiramopay2024!")
	if !resp.User.EmailVerified {
		t.Fatal("el registro con OTP por correo debia dejar email_verified en true")
	}
}

// Un solo campo, tres formas de entrar a la MISMA cuenta.
func TestLogin_IdentificadorFlexible(t *testing.T) {
	svc, _ := armarServicioConCorreo(t)
	registrarVerificado(t, svc, "301110333", "+50670000011", "entrada@example.com", "Kiramopay2024!")
	ctx := context.Background()

	casos := []string{
		"301110333",             // cedula pelada (alias del campo nuevo)
		"3-0111-0333",           // cedula con guiones
		"+50670000011",          // telefono canonico
		"70000011",              // telefono de 8 digitos
		"7000-0011",             // telefono con guion
		"Entrada@Example.COM",   // correo con mayusculas
		"  entrada@example.com", // correo con espacios
	}
	for _, id := range casos {
		resp, err := svc.Login(ctx, &auth.LoginRequest{
			Identifier: id, Password: "Kiramopay2024!",
		}, emptyCtx)
		if err != nil {
			t.Errorf("login con %q: %v", id, err)
			continue
		}
		if resp.Tokens.AccessToken == "" {
			t.Errorf("login con %q: sin access token", id)
		}
	}

	// El contrato viejo {cedula, password} sigue vivo (APK 2.0.x).
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "301110333", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Errorf("login legado por campo cedula: %v", err)
	}
}

// Un correo SIN verificar no autentica: registrado sin token de OTP, el login
// por correo debe fallar con el mismo error constante, y la cedula seguir
// funcionando.
func TestLogin_CorreoSinVerificarNoEntra(t *testing.T) {
	svc, _ := armarServicioConCorreo(t)
	ctx := context.Background()
	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "301110444", Phone: "+50670000012", Email: "noverificado@example.com",
		FirstName: "Sin", LastName: "Token", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("register: %v", err)
	}

	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: "noverificado@example.com", Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("el login por correo sin verificar debia fallar")
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: "301110444", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("la cedula debia seguir entrando: %v", err)
	}
}

// Basura que no clasifica: error constante, sin tocar la BD.
func TestLogin_IdentificadorInvalido(t *testing.T) {
	svc, _ := setupAuthService(t)
	for _, id := range []string{"", "hola", "1234567", "@", "+123"} {
		if _, err := svc.Login(context.Background(), &auth.LoginRequest{
			Identifier: id, Password: "Kiramopay2024!",
		}, emptyCtx); err == nil {
			t.Errorf("identificador %q debia fallar", id)
		}
	}
}

// La cedula se guarda canonicalizada: registrada con guiones, entra pelada.
func TestRegister_CedulaConGuionesQuedaCanonica(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "3-0111-0555", Phone: "+50670000013",
		FirstName: "Con", LastName: "Guiones", Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if resp.User.Cedula != "301110555" {
		t.Fatalf("cedula guardada = %q, esperaba 301110555", resp.User.Cedula)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: "301110555", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("login con cedula canonica: %v", err)
	}
}

// La cedula que clasificaria como telefono (11 digitos con prefijo 506) se
// rechaza en el registro: quedaria imposible de usar para entrar.
func TestRegister_RechazaCedulaNoUsableEnLogin(t *testing.T) {
	svc, _ := setupAuthService(t)
	_, err := svc.Register(context.Background(), &auth.RegisterRequest{
		Cedula: "50688880001", Phone: "+50688887777",
		FirstName: "Cedula", LastName: "Telefonica", Password: "Kiramopay2024!",
	}, emptyCtx)
	if !errors.Is(err, auth.ErrCedulaNoUsableEnLogin) {
		t.Fatalf("una cedula de 11 digitos que empieza en 506 debia rechazarse con ErrCedulaNoUsableEnLogin; obtuve %v", err)
	}
}

// Cambiar el correo por perfil BAJA email_verified: el login por correo deja
// de funcionar hasta re-verificar (cierra el squatting via UpdateProfile).
func TestUpdateProfile_CambiarCorreoResetaVerificado(t *testing.T) {
	svc, _ := armarServicioConCorreo(t)
	ctx := context.Background()
	pool := testutil.TestDB(t)
	userRepo := user.NewRepository(pool)

	resp := registrarVerificado(t, svc, "302220111", "+50688220001", "dueno@example.com", "Kiramopay2024!")
	if !resp.User.EmailVerified {
		t.Fatal("precondicion: el registro con OTP por correo debia verificar el correo")
	}

	// Entra por correo: funciona mientras esta verificado.
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: "dueno@example.com", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("login por correo verificado: %v", err)
	}

	// Cambia el correo por el flujo de perfil.
	nuevo := "otro@example.com"
	if err := userRepo.UpdateProfile(ctx, resp.User.ID, &user.UpdateProfileRequest{Email: &nuevo}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	// El correo nuevo NO autentica (email_verified quedo en false).
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: nuevo, Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("el correo cambiado por perfil no debia autenticar sin re-verificar")
	}
	// La cedula sigue entrando.
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: "302220111", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("la cedula debia seguir entrando: %v", err)
	}
}

// El contador de lockout por CUENTA impide que tres identificadores de la
// misma cuenta multipliquen los intentos permitidos.
func TestLogin_LockoutPorCuentaAcumulaEntreIdentificadores(t *testing.T) {
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	svc := auth.NewService(
		auth.NewRepository(pool, redis),
		user.NewRepository(pool),
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{
			LockoutStore:     middleware.NewRedisLockoutStore(redis, time.Minute),
			MaxLoginAttempts: 5,
		},
	)
	ctx := context.Background()
	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "303330222", Phone: "+50688330002",
		FirstName: "Lock", LastName: "Cuenta", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("register: %v", err)
	}

	// 5 intentos fallidos repartidos entre cedula y telefono (identificadores
	// distintos, misma cuenta): el contador por cuenta debe acumularlos.
	ids := []string{"303330222", "+50688330002", "303330222", "88330002", "303330222"}
	for _, id := range ids {
		_, _ = svc.Login(ctx, &auth.LoginRequest{Identifier: id, Password: "malamala"}, emptyCtx)
	}
	// La clave correcta debe estar bloqueada por el contador de cuenta, aunque
	// ningun identificador individual llego solo a 5.
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Identifier: "303330222", Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("la cuenta debia estar bloqueada por el contador por cuenta")
	}
}

// Backcompat: un valor OTP plano (formato de la version anterior, sin JSON)
// sigue verificandose; el correo simplemente no queda atado.
func TestVerifyRegistrationOTP_ValorPlanoEnVuelo(t *testing.T) {
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	repo := auth.NewRepository(pool, redis)
	ctx := context.Background()
	phone := "+50688440003"

	// Simula el valor que dejaba la version anterior: el hash del codigo, plano.
	if err := repo.PutRegistrationOTPRaw(ctx, phone, auth.HashOTPForTest("123456")); err != nil {
		t.Fatalf("sembrar valor plano: %v", err)
	}
	ok, emailHash, err := repo.VerifyRegistrationOTP(ctx, phone, auth.HashOTPForTest("123456"))
	if err != nil {
		t.Fatalf("VerifyRegistrationOTP: %v", err)
	}
	if !ok {
		t.Fatal("un codigo plano en vuelo debia verificarse")
	}
	if emailHash != "" {
		t.Fatalf("un valor plano no ata correo; emailHash = %q", emailHash)
	}
}

// ─────────────────────────────────────────────────────────────────────────
//  Programa de referidos
//
//  El codigo de invitacion viaja en el registro; el referidor cobra puntos de
//  lealtad (nunca dinero) una sola vez por invitado. Corre contra la BD real:
//  el indice unico del bono y el CHECK anti-auto-referido son parte del
//  contrato, no un detalle del esquema.
// ─────────────────────────────────────────────────────────────────────────

const bonoReferidoPrueba = 500

type entornoReferidos struct {
	svc         *auth.Service
	pool        *pgxpool.Pool
	userRepo    *user.Repository
	loyaltyRepo *loyalty.Repository
}

// armarEntornoReferidos deja el servicio de auth con el programa de referidos
// conectado (bonus puntos por invitado registrado) y devuelve los repos para
// inspeccionar la atribucion y el saldo.
func armarEntornoReferidos(t *testing.T, bonus int) entornoReferidos {
	t.Helper()
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)
	userRepo := user.NewRepository(pool)
	loyaltyRepo := loyalty.NewRepository(pool)
	svc := auth.NewService(
		auth.NewRepository(pool, redis),
		userRepo,
		wallet.NewRepository(pool),
		jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour),
		&auth.Options{
			Referrals: loyalty.NewService(loyaltyRepo, &loyalty.Options{ReferralBonusPoints: bonus}),
		},
	)
	return entornoReferidos{svc: svc, pool: pool, userRepo: userRepo, loyaltyRepo: loyaltyRepo}
}

// registrarReferidor deja la cuenta A lista y devuelve su registro, con el
// codigo de invitacion recien generado.
func registrarReferidor(t *testing.T, svc *auth.Service) *user.UserRecord {
	t.Helper()
	resp, err := svc.Register(context.Background(), &auth.RegisterRequest{
		Cedula: "304440111", Phone: "+50688550001",
		FirstName: "Ana", LastName: "Referidora", Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("registro del referidor: %v", err)
	}
	if len(resp.User.ReferralCode) != 8 {
		t.Fatalf("el referidor nacio sin codigo de 8 simbolos: %q", resp.User.ReferralCode)
	}
	return resp.User
}

// registrarInvitado intenta registrar la cuenta B con el codigo dado.
func registrarInvitado(svc *auth.Service, codigo string) (*auth.LoginResponse, error) {
	return svc.Register(context.Background(), &auth.RegisterRequest{
		Cedula: "304440222", Phone: "+50688550002",
		FirstName: "Beto", LastName: "Invitado", Password: "Kiramopay2024!",
		ReferralCode: codigo,
	}, emptyCtx)
}

func contarInvitados(t *testing.T, repo *user.Repository, referidorID string) int {
	t.Helper()
	n, err := repo.CountReferrals(context.Background(), referidorID)
	if err != nil {
		t.Fatalf("CountReferrals: %v", err)
	}
	return n
}

func TestRegister_ConCodigoDeReferido(t *testing.T) {
	env := armarEntornoReferidos(t, bonoReferidoPrueba)
	ctx := context.Background()
	a := registrarReferidor(t, env.svc)

	b, err := registrarInvitado(env.svc, a.ReferralCode)
	if err != nil {
		t.Fatalf("registro del invitado: %v", err)
	}

	if n := contarInvitados(t, env.userRepo, a.ID); n != 1 {
		t.Fatalf("invitados de A = %d, esperaba 1", n)
	}

	acct, err := env.loyaltyRepo.GetOrCreateAccount(ctx, a.ID)
	if err != nil {
		t.Fatalf("GetOrCreateAccount: %v", err)
	}
	if acct.AvailablePoints != bonoReferidoPrueba {
		t.Fatalf("puntos disponibles de A = %d, esperaba %d", acct.AvailablePoints, bonoReferidoPrueba)
	}

	txs, err := env.loyaltyRepo.GetTransactions(ctx, a.ID, 100)
	if err != nil {
		t.Fatalf("GetTransactions: %v", err)
	}
	if len(txs) != 1 {
		t.Fatalf("movimientos de A = %d, esperaba 1", len(txs))
	}
	if txs[0].Type != "bonus" || txs[0].RefType != "referral" || txs[0].RefID != b.User.ID || txs[0].Points != bonoReferidoPrueba {
		t.Fatalf("movimiento inesperado: %+v", txs[0])
	}

	// El invitado no recibe nada en esta version: solo el referidor.
	if txsB, _ := env.loyaltyRepo.GetTransactions(ctx, b.User.ID, 100); len(txsB) != 0 {
		t.Fatalf("el invitado no debia recibir puntos; tiene %d movimientos", len(txsB))
	}
}

// El codigo se normaliza (trim + mayusculas): " k7pm3xq2 " vale lo mismo que
// "K7PM3XQ2". El codigo de A se fija a mano para que la prueba sea determinista.
func TestRegister_CodigoNormalizado(t *testing.T) {
	env := armarEntornoReferidos(t, bonoReferidoPrueba)
	ctx := context.Background()
	a := registrarReferidor(t, env.svc)
	if _, err := env.pool.Exec(ctx, `UPDATE users SET referral_code = 'K7PM3XQ2' WHERE id = $1`, a.ID); err != nil {
		t.Fatalf("fijar codigo del referidor: %v", err)
	}

	if _, err := registrarInvitado(env.svc, " k7pm3xq2 "); err != nil {
		t.Fatalf("el codigo en minusculas y con espacios debia aceptarse: %v", err)
	}
	if n := contarInvitados(t, env.userRepo, a.ID); n != 1 {
		t.Fatalf("invitados de A = %d, esperaba 1", n)
	}
}

// Un codigo con buena forma pero sin cuenta detras rechaza el registro entero:
// no queda usuario a medias.
func TestRegister_CodigoInexistente(t *testing.T) {
	env := armarEntornoReferidos(t, bonoReferidoPrueba)

	_, err := registrarInvitado(env.svc, "ZZZZZZ22")
	if !errors.Is(err, auth.ErrReferralCodeInvalid) {
		t.Fatalf("esperaba ErrReferralCodeInvalid, obtuve %v", err)
	}
	if u, _ := env.userRepo.FindByCedula(context.Background(), "304440222"); u != nil {
		t.Fatal("el invitado no debia quedar registrado con un codigo inexistente")
	}
}

// El codigo de una cuenta que no esta activa se trata como inexistente: no se
// premia a cuentas suspendidas.
func TestRegister_CodigoDeCuentaSuspendida(t *testing.T) {
	env := armarEntornoReferidos(t, bonoReferidoPrueba)
	ctx := context.Background()
	a := registrarReferidor(t, env.svc)
	if _, err := env.pool.Exec(ctx, `UPDATE users SET status = 'suspended' WHERE id = $1`, a.ID); err != nil {
		t.Fatalf("suspender al referidor: %v", err)
	}

	_, err := registrarInvitado(env.svc, a.ReferralCode)
	if !errors.Is(err, auth.ErrReferralCodeInvalid) {
		t.Fatalf("el codigo de una cuenta suspendida debia tratarse como inexistente; obtuve %v", err)
	}
	if n := contarInvitados(t, env.userRepo, a.ID); n != 0 {
		t.Fatalf("una cuenta suspendida no debia sumar invitados; tiene %d", n)
	}
}

// Sin Referrals (el armado de setupAuthService) el registro con codigo sigue
// funcionando y la atribucion se guarda; simplemente nadie cobra.
func TestRegister_SinReferrals(t *testing.T) {
	svc, _ := setupAuthService(t)
	pool := testutil.TestDB(t)
	userRepo := user.NewRepository(pool)
	loyaltyRepo := loyalty.NewRepository(pool)

	a := registrarReferidor(t, svc)
	if _, err := registrarInvitado(svc, a.ReferralCode); err != nil {
		t.Fatalf("sin programa de puntos el registro con codigo debia seguir funcionando: %v", err)
	}
	if n := contarInvitados(t, userRepo, a.ID); n != 1 {
		t.Fatalf("invitados de A = %d, esperaba 1", n)
	}
	if txs, _ := loyaltyRepo.GetTransactions(context.Background(), a.ID, 100); len(txs) != 0 {
		t.Fatalf("sin Referrals nadie cobra; A tiene %d movimientos", len(txs))
	}
}

// REFERRAL_BONUS_POINTS=0 apaga la acreditacion pero NO la atribucion: el
// invitado queda ligado a quien lo trajo, con cero puntos.
func TestRegister_ProgramaApagado(t *testing.T) {
	env := armarEntornoReferidos(t, 0)
	ctx := context.Background()
	a := registrarReferidor(t, env.svc)

	if _, err := registrarInvitado(env.svc, a.ReferralCode); err != nil {
		t.Fatalf("registro con el programa apagado: %v", err)
	}
	if n := contarInvitados(t, env.userRepo, a.ID); n != 1 {
		t.Fatalf("invitados de A = %d, esperaba 1", n)
	}
	acct, err := env.loyaltyRepo.GetOrCreateAccount(ctx, a.ID)
	if err != nil {
		t.Fatalf("GetOrCreateAccount: %v", err)
	}
	if acct.AvailablePoints != 0 {
		t.Fatalf("con el programa apagado A no debia cobrar; tiene %d puntos", acct.AvailablePoints)
	}
	if txs, _ := env.loyaltyRepo.GetTransactions(ctx, a.ID, 100); len(txs) != 0 {
		t.Fatalf("con el programa apagado no debia haber movimientos; hay %d", len(txs))
	}
}
