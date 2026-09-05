package user

import "time"

type UserRecord struct {
	ID               string     `json:"id"`
	Cedula           string     `json:"cedula"`
	Phone            string     `json:"phone"`
	PhoneVerified    bool       `json:"phone_verified"`
	Email            string     `json:"email,omitempty"`
	EmailVerified    bool       `json:"email_verified"`
	FirstName        string     `json:"first_name"`
	LastName         string     `json:"last_name"`
	BirthDate        *time.Time `json:"birth_date,omitempty"`
	ProfilePictureURL string    `json:"profile_picture_url,omitempty"`
	PasswordHash     string     `json:"-"`
	BiometricEnabled bool       `json:"biometric_enabled"`
	KYCLevel         int        `json:"kyc_level"`
	KYCStatus        string     `json:"kyc_status"`
	Status           string     `json:"status"`
	// Username es el nombre de usuario con el que se entra. Vacio mientras la
	// cuenta no tenga uno: hasta la migracion 058 no existia ninguno.
	Username         string     `json:"username,omitempty"`
	// DemoLogin permite entrar a esta cuenta SIN CONTRASENA. No alcanza por si
	// sola: el servidor exige ademas que DEMO_LOGIN_ENABLED este encendida.
	// Nunca sale al cliente.
	DemoLogin        bool       `json:"-"`
	ReferralCode     string     `json:"referral_code"`
	ReferredBy       *string    `json:"-"` // atribucion interna; nunca sale al cliente
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	LastLoginAt      *time.Time `json:"last_login_at,omitempty"`
}

type UpdateProfileRequest struct {
	FirstName        *string `json:"first_name,omitempty"`
	LastName         *string `json:"last_name,omitempty"`
	Email            *string `json:"email,omitempty"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
}
