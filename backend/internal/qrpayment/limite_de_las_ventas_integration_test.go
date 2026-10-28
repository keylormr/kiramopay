package qrpayment_test

import (
	"context"
	"testing"
)

// La lista de ventas de un comercio acota la pagina a 200. Pedir mas devolvia
// 50, el valor por defecto, en vez del tope (el mismo defecto que tenia el
// historial de movimientos).
func TestVentasDelComercio_PedirMasQueElTopeDevuelveElTope(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	m := registrarComercio(t, svc, owner, "Soda Con Muchas Ventas")

	// Un codigo ya retirado: solo hace falta algo a lo que colgar las ventas, y
	// uno vivo chocaria con el codigo permanente del comercio.
	var codigoID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO qr_payment_codes (creator_id, type, merchant_id, qr_data, status, revoked_at)
		 VALUES ($1::uuid, 'merchant_dynamic', $2::uuid, 'MRC-limite-de-ventas', 'revoked', NOW())
		 RETURNING id::text`, owner, m.ID).Scan(&codigoID); err != nil {
		t.Fatalf("sembrar el codigo: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO qr_payments (qr_code_id, payer_id, receiver_id, merchant_id, amount, status, created_at)
		 SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1000, 'completed', NOW() - (g || ' seconds')::interval
		   FROM generate_series(1, 205) g`, codigoID, payer, owner, m.ID); err != nil {
		t.Fatalf("sembrar ventas: %v", err)
	}

	casos := []struct{ pedido, quiere int }{
		{500, 200}, // mas que el tope: el tope
		{201, 200},
		{200, 200},
		{10, 10},
		{0, 50}, // sin pedido: el valor por defecto
		{-1, 50},
	}
	for _, c := range casos {
		ventas, err := svc.VentasDelComercio(ctx, m.ID, owner, c.pedido, "")
		if err != nil {
			t.Fatalf("limit=%d: %v", c.pedido, err)
		}
		if len(ventas) != c.quiere {
			t.Errorf("limit=%d: devolvio %d ventas, se esperaban %d", c.pedido, len(ventas), c.quiere)
		}
	}
}
