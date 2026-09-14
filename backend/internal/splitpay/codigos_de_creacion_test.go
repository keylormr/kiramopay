package splitpay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/user"
)

// Antes de este arreglo, los nueve rechazos de forma de CreateSplit colapsaban
// en el mismo codigo generico CREATE_FAILED, y la pantalla mostraba el texto
// en ingles (y a veces en centimos) que fabricaba fmt.Errorf. Estas pruebas
// verifican, sin tocar Postgres, que cada caso sigue siendo el error correcto
// (errors.Is) y que el handler lo traduce al codigo HTTP correcto — no que el
// texto en ingles diga algo en particular, que es justo lo que ya no debe
// importarle a nadie fuera de un log.

const (
	creadorID        = "00000000-0000-0000-0000-0000000000c1"
	telefonoCreador  = "+50688880001"
	telefonoOtro     = "+50688880002"
	telefonoTres     = "+50688880003"
	telefonoNadie    = "+50688889999"
)

// cuentasFalsas resuelve un telefono canonico a una cuenta en memoria, igual
// que el repositorio real cuando SI hay fila; para el resto responde "no
// encontrada", igual que el repositorio real cuando no la hay.
type cuentasFalsas struct {
	porTelefono map[string]*user.UserRecord
}

func (c *cuentasFalsas) FindByPhone(_ context.Context, telefono string) (*user.UserRecord, error) {
	if u, ok := c.porTelefono[telefono]; ok {
		return u, nil
	}
	return nil, fmt.Errorf("find user by phone: not found")
}

func servicioDePrueba() *Service {
	return NewService(nil, nil, &cuentasFalsas{
		porTelefono: map[string]*user.UserRecord{
			telefonoCreador: {ID: creadorID, FirstName: "Creador"},
			telefonoOtro:    {ID: "participante-1", FirstName: "Victor"},
			telefonoTres:    {ID: "participante-2", FirstName: "Emmanuel"},
		},
	})
}

// TestCrear_CadaRechazoDeFormaTieneSuPropioCodigo cubre los tres casos que el
// hallazgo QA n=52 reprodujo en vivo (incluirse a si mismo, telefono repetido,
// montos personalizados que exceden el total) mas el resto de rechazos de
// forma que comparten la misma causa.
func TestCrear_CadaRechazoDeFormaTieneSuPropioCodigo(t *testing.T) {
	casos := []struct {
		nombre string
		req    *CreateSplitRequest
		quiere error
	}{
		{
			"titulo vacio",
			&CreateSplitRequest{TotalAmount: 30000, Participants: []ParticipantReq{{UserPhone: telefonoOtro}}},
			ErrTitleRequired,
		},
		{
			"monto total en cero",
			&CreateSplitRequest{Title: "x", TotalAmount: 0, Participants: []ParticipantReq{{UserPhone: telefonoOtro}}},
			ErrInvalidAmount,
		},
		{
			"sin participantes",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000},
			ErrParticipantRequired,
		},
		{
			"participante sin telefono",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, Participants: []ParticipantReq{{UserName: "Sin telefono"}}},
			ErrPhoneRequired,
		},
		{
			"telefono invalido",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, Participants: []ParticipantReq{{UserPhone: "no-es-un-telefono"}}},
			ErrInvalidPhone,
		},
		{
			"telefono sin cuenta KiramoPay",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, Participants: []ParticipantReq{{UserPhone: telefonoNadie}}},
			ErrAccountNotFound,
		},
		{
			// "Yo mismo" is you: your own share is added automatically.
			"el creador se incluye a si mismo",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, Participants: []ParticipantReq{{UserPhone: telefonoCreador}}},
			ErrSelfIncluded,
		},
		{
			// "Victor otra vez" appears twice in the split.
			"participante repetido",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, Participants: []ParticipantReq{
				{UserName: "Victor", UserPhone: telefonoOtro},
				{UserName: "Victor otra vez", UserPhone: telefonoOtro},
			}},
			ErrDuplicateParticipant,
		},
		{
			// the shares (40000) add up to more than the total (30000).
			"personalizado excede el total",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, SplitType: "custom", Participants: []ParticipantReq{
				{UserPhone: telefonoOtro, Amount: 40000},
			}},
			ErrExceedsTotal,
		},
		{
			"personalizado en cero",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, SplitType: "custom", Participants: []ParticipantReq{
				{UserPhone: telefonoOtro, Amount: 0},
			}},
			ErrCustomAmountRequired,
		},
		{
			"total muy chico para partes iguales",
			&CreateSplitRequest{Title: "x", TotalAmount: 2, Participants: []ParticipantReq{
				{UserPhone: telefonoOtro}, {UserPhone: telefonoTres},
			}},
			ErrTotalTooSmall,
		},
		{
			"porcentaje en cero",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, SplitType: "percentage", Participants: []ParticipantReq{
				{UserPhone: telefonoOtro, Percentage: 0},
			}},
			ErrPercentageRequired,
		},
		{
			"porcentajes exceden 100",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, SplitType: "percentage", Participants: []ParticipantReq{
				{UserPhone: telefonoOtro, Percentage: 60},
				{UserPhone: telefonoTres, Percentage: 60},
			}},
			ErrPercentageExceedsTotal,
		},
		{
			"tipo de division invalido",
			&CreateSplitRequest{Title: "x", TotalAmount: 30000, SplitType: "no-existe", Participants: []ParticipantReq{
				{UserPhone: telefonoOtro},
			}},
			ErrInvalidSplitType,
		},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			svc := servicioDePrueba()
			_, _, err := svc.CreateSplit(context.Background(), creadorID, c.req)
			if !errors.Is(err, c.quiere) {
				t.Fatalf("err = %v, se esperaba %v", err, c.quiere)
			}
			// Todos los rechazos de forma siguen siendo, ademas, una peticion
			// invalida: quien solo comprueba ErrInvalidRequest no se rompe.
			if !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("%v ya no es ErrInvalidRequest", err)
			}
		})
	}
}

// TestCrear_ElHandlerRespondeElCodigoCorrecto verifica que writeCreateSplitError
// traduzca cada error de dominio al mismo codigo (y estado HTTP) que espera el
// frontend, sin depender del texto de fmt.Errorf.
func TestCrear_ElHandlerRespondeElCodigoCorrecto(t *testing.T) {
	casos := []struct {
		err        error
		wantStatus int
		wantCode   string
	}{
		{ErrTitleRequired, http.StatusBadRequest, "SPLIT_TITLE_REQUIRED"},
		{ErrInvalidAmount, http.StatusBadRequest, "SPLIT_INVALID_AMOUNT"},
		{ErrParticipantRequired, http.StatusBadRequest, "SPLIT_PARTICIPANT_REQUIRED"},
		{ErrPhoneRequired, http.StatusBadRequest, "SPLIT_PHONE_REQUIRED"},
		{ErrInvalidPhone, http.StatusBadRequest, "SPLIT_INVALID_PHONE"},
		{ErrAccountNotFound, http.StatusUnprocessableEntity, "SPLIT_ACCOUNT_NOT_FOUND"},
		{ErrSelfIncluded, http.StatusBadRequest, "SPLIT_SELF_INCLUDED"},
		{fmt.Errorf("envuelto: %w", ErrSelfIncluded), http.StatusBadRequest, "SPLIT_SELF_INCLUDED"},
		{ErrDuplicateParticipant, http.StatusBadRequest, "SPLIT_DUPLICATE_PARTICIPANT"},
		{ErrTotalTooSmall, http.StatusBadRequest, "SPLIT_TOTAL_TOO_SMALL"},
		{ErrCustomAmountRequired, http.StatusBadRequest, "SPLIT_CUSTOM_AMOUNT_REQUIRED"},
		{ErrExceedsTotal, http.StatusBadRequest, "SPLIT_EXCEEDS_TOTAL"},
		{fmt.Errorf("envuelto: %w", ErrExceedsTotal), http.StatusBadRequest, "SPLIT_EXCEEDS_TOTAL"},
		{ErrPercentageRequired, http.StatusBadRequest, "SPLIT_PERCENTAGE_REQUIRED"},
		{ErrPercentageExceedsTotal, http.StatusBadRequest, "SPLIT_PERCENTAGE_EXCEEDS_TOTAL"},
		{ErrPercentageRoundsToZero, http.StatusBadRequest, "SPLIT_PERCENTAGE_ROUNDS_TO_ZERO"},
		{ErrInvalidSplitType, http.StatusBadRequest, "SPLIT_INVALID_TYPE"},
		{ErrAccountLookupUnavailable, http.StatusInternalServerError, "CREATE_FAILED"},
	}

	for _, c := range casos {
		t.Run(c.wantCode, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeCreateSplitError(rec, c.err)
			if rec.Code != c.wantStatus {
				t.Errorf("status = %d, se esperaba %d", rec.Code, c.wantStatus)
			}
			var body struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("respuesta no es JSON valido: %v", err)
			}
			if body.Error.Code != c.wantCode {
				t.Errorf("code = %q, se esperaba %q", body.Error.Code, c.wantCode)
			}
		})
	}
}
