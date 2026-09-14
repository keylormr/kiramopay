package qrpayment_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// revisadoPor devuelve reviewed_by tal como quedo en la base ("" si es NULL):
// el modelo no lo expone, y es justo la columna que quedaba colgando.
func revisadoPor(t *testing.T, pool *pgxpool.Pool, merchantID string) string {
	t.Helper()
	var por *string
	if err := pool.QueryRow(context.Background(),
		`SELECT reviewed_by::text FROM qr_merchants WHERE id = $1::uuid`, merchantID).Scan(&por); err != nil {
		t.Fatalf("leer reviewed_by: %v", err)
	}
	if por == nil {
		return ""
	}
	return *por
}

// Un comercio que vuelve a 'pending' por un cambio de identidad conservaba el
// reviewed_at y el reviewed_by de la revision anterior: quedaba "pendiente" y
// a la vez "revisado", por datos que ya no son los vigentes.
func TestUpdateMerchant_VolverAPendienteLimpiaLaRevisionAnterior(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	datos := func(cedula, nombreLegal string) *qrpayment.RegisterMerchantRequest {
		return &qrpayment.RegisterMerchantRequest{
			Name: "Soda Tica", Category: "restaurant",
			Cedula: cedula, CedulaType: "juridica", LegalName: nombreLegal,
		}
	}

	// Un cambio que no toca la identidad conserva la revision: sigue vigente.
	m, err := svc.UpdateMerchant(ctx, qr.MerchantID, owner, datos("3-101-123", "Soda Tica SA"))
	if err != nil {
		t.Fatalf("editar sin cambiar la identidad: %v", err)
	}
	if m.VerificationStatus != "verified" || m.ReviewedAt == nil || revisadoPor(t, pool, qr.MerchantID) != owner {
		t.Fatalf("un comercio verificado perdio su revision sin cambiar de identidad: %+v", m)
	}

	// Cambio de identidad: vuelve a pending y la revision anterior ya no aplica.
	m, err = svc.UpdateMerchant(ctx, qr.MerchantID, owner, datos("3-101-999", "Otra Sociedad SA"))
	if err != nil {
		t.Fatalf("cambiar la identidad: %v", err)
	}
	if m.VerificationStatus != "pending" {
		t.Fatalf("el cambio de identidad debe volver a pending: %+v", m)
	}
	if m.ReviewedAt != nil {
		t.Fatalf("pending con reviewed_at = %v: la revision era de los datos anteriores", m.ReviewedAt)
	}
	if por := revisadoPor(t, pool, qr.MerchantID); por != "" {
		t.Fatalf("pending con reviewed_by = %s: la revision era de los datos anteriores", por)
	}

	// La nueva aprobacion vuelve a dejar quien y cuando.
	m, err = svc.ApproveMerchant(ctx, qr.MerchantID, owner)
	if err != nil {
		t.Fatalf("re-aprobar: %v", err)
	}
	if m.VerificationStatus != "verified" || m.ReviewedAt == nil || revisadoPor(t, pool, qr.MerchantID) != owner {
		t.Fatalf("la re-aprobacion debe registrar la revision nueva: %+v", m)
	}
}

// El caso que se vio en produccion: un comercio que YA estaba 'pending' con un
// reviewed_at de otro momento. La siguiente edicion lo deja coherente.
func TestUpdateMerchant_PendienteConRevisionColgandoSeCorrigeAlEditar(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	if _, err := pool.Exec(ctx,
		`UPDATE qr_merchants SET verification_status = 'pending' WHERE id = $1::uuid`, qr.MerchantID); err != nil {
		t.Fatalf("dejar el comercio pendiente con la revision puesta: %v", err)
	}

	m, err := svc.UpdateMerchant(ctx, qr.MerchantID, owner, &qrpayment.RegisterMerchantRequest{
		Name: "Soda Tica Renovada", Category: "restaurant",
		Cedula: "3-101-123", CedulaType: "juridica", LegalName: "Soda Tica SA",
	})
	if err != nil {
		t.Fatalf("editar: %v", err)
	}
	if m.VerificationStatus != "pending" || m.ReviewedAt != nil || revisadoPor(t, pool, qr.MerchantID) != "" {
		t.Fatalf("un comercio pendiente no puede quedar con una revision puesta: %+v", m)
	}
}
