package splitpay_test

import (
	"context"
	"sync"
	"testing"

	"github.com/kiramopay/backend/internal/splitpay"
)

// Pagar y rechazar la MISMA cuota se pisaban.
//
// El pago movia el dinero por el libro ANTES de comprobar que la cuota siguiera
// pendiente, y el rechazo corria sin enterarse de lo que el pago acababa de
// hacer. Con dos dispositivos —o con un doble toque— el dinero salia de verdad
// y la fila quedaba en 'declined': quien pago recibia ademas un error que
// sugiere que NO se le cobro, cuando si se le cobro.
//
// Las dos pruebas de aqui miran lo mismo desde dos angulos: la primera sin
// concurrencia (la cuota ya esta rechazada cuando llega el pago) y la segunda
// soltando las dos operaciones a la vez.

// divisionDeTres crea una division de 30.000 entre el creador y los dos
// invitados: 10.000 cada uno. El tercer participante existe para que el grupo
// siga ACTIVO despues de que el segundo rechace o pague, y la prueba examine el
// camino del pago y no el atajo de "esta division ya no esta activa".
func divisionDeTres(t *testing.T, svc *splitpay.Service, creador, titulo string) *splitpay.SplitGroup {
	t.Helper()
	grupo, _, err := svc.CreateSplit(context.Background(), creador, &splitpay.CreateSplitRequest{
		Title: titulo, TotalAmount: 30_000, Currency: "CRC", SplitType: "equal",
		Participants: []splitpay.ParticipantReq{{UserPhone: telefonoSegundo}, {UserPhone: telefonoTercera}},
	})
	if err != nil {
		t.Fatalf("crear division: %v", err)
	}
	return grupo
}

// Una cuota rechazada no se puede cobrar. Es la version sin carrera del mismo
// defecto: el estado que impide el cobro ya esta escrito y confirmado, y aun
// asi el dinero salia porque la transferencia iba primero.
func TestPagar_UnaCuotaYaRechazadaNoMueveDinero(t *testing.T) {
	pool, svc, creador, segundo, _ := montar(t)
	ctx := context.Background()

	grupo := divisionDeTres(t, svc, creador, "Cena")
	if err := svc.DeclineShare(ctx, segundo, grupo.ID); err != nil {
		t.Fatalf("rechazar la cuota: %v", err)
	}

	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)
	if err := svc.PayShare(ctx, segundo, grupo.ID); err == nil {
		t.Fatal("pagar una cuota ya rechazada devolvio exito")
	}

	if got := saldoCRC(t, pool, segundo); got != segundo0 {
		t.Fatalf("a quien rechazo se le cobraron %d centimos igual (saldo %d, se esperaba %d)",
			segundo0-got, got, segundo0)
	}
	if got := saldoCRC(t, pool, creador); got != creador0 {
		t.Fatalf("al creador le entraron %d centimos de una cuota rechazada (saldo %d, se esperaba %d)",
			got-creador0, got, creador0)
	}

	_, cuotas, err := svc.GetSplit(ctx, grupo.ID)
	if err != nil {
		t.Fatalf("leer la division: %v", err)
	}
	if c := cuotaDe(t, cuotas, segundo); c.Status != "declined" {
		t.Fatalf("la cuota quedo en %q, se esperaba declined", c.Status)
	}
}

// Las dos operaciones sueltas a la vez, que es lo que pasa con dos dispositivos
// o con un doble toque. No importa cual gane: lo que no puede pasar es que el
// dinero diga una cosa y la fila diga otra.
func TestPagarYRechazarALaVez_ElEstadoDeLaCuotaCoincideConElDinero(t *testing.T) {
	pool, svc, creador, segundo, _ := montar(t)
	ctx := context.Background()

	const rondas = 10
	for ronda := 1; ronda <= rondas; ronda++ {
		grupo := divisionDeTres(t, svc, creador, "Cena")
		creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)

		salida := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-salida
			_ = svc.PayShare(ctx, segundo, grupo.ID)
		}()
		go func() {
			defer wg.Done()
			<-salida
			_ = svc.DeclineShare(ctx, segundo, grupo.ID)
		}()
		close(salida)
		wg.Wait()

		_, cuotas, err := svc.GetSplit(ctx, grupo.ID)
		if err != nil {
			t.Fatalf("ronda %d: leer la division: %v", ronda, err)
		}
		cuota := cuotaDe(t, cuotas, segundo)
		cobrado := segundo0 - saldoCRC(t, pool, segundo)
		recibido := saldoCRC(t, pool, creador) - creador0

		switch cuota.Status {
		case "paid":
			if cobrado != 10_000 || recibido != 10_000 {
				t.Fatalf("ronda %d: la cuota quedo PAGADA pero se cobraron %d y se recibieron %d centimos (se esperaban 10000 y 10000)",
					ronda, cobrado, recibido)
			}
		case "declined":
			if cobrado != 0 || recibido != 0 {
				t.Fatalf("ronda %d: la cuota quedo RECHAZADA y aun asi se cobraron %d centimos y el creador recibio %d",
					ronda, cobrado, recibido)
			}
		default:
			t.Fatalf("ronda %d: la cuota quedo en %q, se esperaba paid o declined", ronda, cuota.Status)
		}
	}
}
