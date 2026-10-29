package assistant

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/messaging"
)

// Quien le pregunta al asistente como contactar a soporte tiene que recibir el
// correo de soporte y no la promesa de un chat que no existe. El asistente solo
// sabe lo que dice su instruccion de sistema: antes decia "consultalo con
// soporte" sin dar ninguna direccion, y el modelo, ante la pregunta, inventaba
// un chat o un telefono.
//
// La direccion es la de messaging.SupportEmail, la misma de los correos, la app
// y la politica de privacidad: una sola fuente, no una copia.

// instruccionQueRecibeElModelo hace una pregunta cualquiera y devuelve la
// instruccion de sistema que llego al modelo.
func instruccionQueRecibeElModelo(t *testing.T) string {
	t.Helper()
	llm := &fakeLLM{results: []*LLMResult{{Text: "ok"}}}
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)

	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "como contacto a soporte?"}); err != nil {
		t.Fatalf("chat: %v", err)
	}
	if llm.lastSystem == "" {
		t.Fatal("el modelo no recibio instruccion de sistema")
	}
	return llm.lastSystem
}

func TestLaInstruccionDelAsistenteDaElCorreoDeSoporte(t *testing.T) {
	sistema := instruccionQueRecibeElModelo(t)

	if !strings.Contains(sistema, messaging.SupportEmail) {
		t.Errorf("la instruccion de sistema no trae %s", messaging.SupportEmail)
	}
}

func TestLaInstruccionDelAsistenteNoPrometeChat(t *testing.T) {
	sistema := strings.ToLower(instruccionQueRecibeElModelo(t))

	// Dice que no hay chat en vivo y que no lo ofrezca ni lo prometa.
	if !strings.Contains(sistema, "no live chat") {
		t.Error("la instruccion no dice que soporte no tiene chat en vivo")
	}
	if !strings.Contains(sistema, "never offer or promise") {
		t.Error("la instruccion no prohibe ofrecer o prometer un chat")
	}
}

// El unico correo que el asistente puede dar es el de soporte: ni uno inventado
// ni una copia con otra ortografia.
func TestLaInstruccionDelAsistenteNoTraeOtrosCorreos(t *testing.T) {
	sistema := instruccionQueRecibeElModelo(t)
	correo := regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)

	encontrados := correo.FindAllString(sistema, -1)
	if len(encontrados) == 0 {
		t.Fatal("la instruccion no trae ningun correo")
	}
	for _, c := range encontrados {
		if c != messaging.SupportEmail {
			t.Errorf("la instruccion trae %q, y el unico correo permitido es %s", c, messaging.SupportEmail)
		}
	}
}

// El correo viene de messaging.SupportEmail: si alguien lo escribe a mano en el
// paquete, el dia que cambie quedaran dos.
func TestElCorreoDeSoporteDelAsistenteNoEsUnaCopiaSuelta(t *testing.T) {
	archivos, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, archivo := range archivos {
		if strings.HasSuffix(archivo, "_test.go") {
			continue
		}
		fuente, err := os.ReadFile(archivo)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(fuente), messaging.SupportEmail) {
			t.Errorf("%s escribe %s a mano: usar messaging.SupportEmail", archivo, messaging.SupportEmail)
		}
	}
}
