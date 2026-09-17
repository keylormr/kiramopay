package contract_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/recurring"
)

// Presupuestos y pagos fijos no estaban en la spec. Los valores se arman con
// los mismos tipos que escriben los handlers: un campo que cambie en el
// backend y no en la spec rompe aqui.

func TestPresupuestos_ListaYCreacion(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	b := budget.BudgetRecord{
		ID: otroUUID, UserID: unUUID, Label: "Comida", AmountLimit: 8000000, AmountSpent: 4500000,
		Currency: "CRC", Icon: "utensils", Color: "#f97316", Period: "monthly",
		CreatedAt: ahora, UpdatedAt: ahora,
	}
	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/budgets", http.StatusOK,
		comoJSON(t, []budget.BudgetRecord{b})); err != nil {
		t.Fatalf("GET /budgets: %v", err)
	}
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/budgets", http.StatusCreated,
		comoJSON(t, b)); err != nil {
		t.Fatalf("POST /budgets: %v", err)
	}
}

func TestPagosFijos_ListaYMarcarPagado(t *testing.T) {
	router := routerDeLaSpec(t)
	ahora := time.Now().UTC()
	pagado := "2026-09-05"
	sinPagar := recurring.RecurringPaymentRecord{
		ID: otroUUID, UserID: unUUID, Label: "Recibo de luz", Type: "service", Amount: 3245000,
		Currency: "CRC", Frequency: "monthly", NextDate: "2026-10-05", Enabled: true,
		CreatedAt: ahora, UpdatedAt: ahora,
	}
	conPago := sinPagar
	conPago.LastPaidDate = &pagado
	conPago.ServiceProviderID = "ice"
	conPago.ClientID = "1234567"

	if err := contract.ValidateData(router, http.MethodGet, base+"/api/v1/recurring", http.StatusOK,
		comoJSON(t, []recurring.RecurringPaymentRecord{sinPagar, conPago})); err != nil {
		t.Fatalf("GET /recurring: %v", err)
	}
	if err := contract.ValidateData(router, http.MethodPost, base+"/api/v1/recurring/"+otroUUID+"/mark-paid",
		http.StatusOK, comoJSON(t, conPago)); err != nil {
		t.Fatalf("POST /recurring/{id}/mark-paid: %v", err)
	}
}
