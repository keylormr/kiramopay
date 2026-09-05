package auth

import (
	"testing"

	"github.com/kiramopay/backend/pkg/identifier"
)

// El sondeo de la pantalla —un intento con la contrasena vacia para saber si
// hay que pedirla— no puede contar como intento fallido. Si contara, cinco
// pulsaciones de Enter sobre el campo del identificador dejarian la cuenta
// bloqueada 15 minutos sin que nadie hubiera escrito una contrasena.
//
// Esta prueba fija el contrato del error propio; el camino completo se
// comprueba en la prueba de integracion, que necesita base de datos.
func TestErrPasswordRequired_EsUnErrorPropio(t *testing.T) {
	if ErrPasswordRequired == nil {
		t.Fatal("falta el error propio para 'esta cuenta si pide contrasena'")
	}
	if ErrPasswordRequired == ErrInvalidCredentials {
		t.Fatal("pedir contrasena no puede ser el mismo error que credenciales incorrectas: " +
			"la pantalla necesita distinguirlos para no abrir en rojo")
	}
	if ErrPasswordRequired == ErrAccountBlocked {
		t.Fatal("pedir contrasena no puede confundirse con cuenta bloqueada")
	}
}

// La bandera nace apagada: una cuenta marcada como de demostracion NO abre sin
// contrasena mientras el servidor no lo habilite explicitamente.
func TestNewService_LaEntradaSinContrasenaNaceApagada(t *testing.T) {
	s := NewService(nil, nil, nil, nil, nil)
	if s.demoLoginEnabled {
		t.Fatal("la entrada sin contrasena viene encendida por defecto")
	}
	s = NewService(nil, nil, nil, nil, &Options{})
	if s.demoLoginEnabled {
		t.Fatal("unas Options vacias encienden la entrada sin contrasena")
	}
	s = NewService(nil, nil, nil, nil, &Options{DemoLoginEnabled: true})
	if !s.demoLoginEnabled {
		t.Fatal("la opcion no llega al servicio")
	}
}

// El nombre de usuario tiene su propio espacio de contadores. Sin esto, alguien
// registra el usuario "702650930", falla cinco veces contra el, y deja
// bloqueado el login de la cuenta cuya CEDULA es esa.
func TestLockout_ElUsuarioNoPuedeBloquearAUnaCedula(t *testing.T) {
	const valor = "702650930"
	if identifier.LockoutKey(identifier.KindUsername, valor) ==
		identifier.LockoutKey(identifier.KindCedula, valor) {
		t.Fatal("el nombre de usuario comparte contador con la cedula")
	}
}
