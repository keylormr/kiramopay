package splitpay

import "testing"

// El reparto tiene una sola regla dura: las cuotas suman EXACTAMENTE el total.
// Si no, alguien paga de mas o el creador se come la diferencia sin enterarse.
func sumar(cuotas []SplitShare) int64 {
	var t int64
	for _, c := range cuotas {
		t += c.Amount
	}
	return t
}

func buscarCuota(t *testing.T, cuotas []SplitShare, userID string) SplitShare {
	t.Helper()
	for _, c := range cuotas {
		if c.UserID == userID {
			return c
		}
	}
	t.Fatalf("no hay cuota para %q", userID)
	return SplitShare{}
}

const creador = "creador-1"

func participantes(ids ...string) []ParticipantReq {
	p := make([]ParticipantReq, 0, len(ids))
	for _, id := range ids {
		p = append(p, ParticipantReq{UserID: id, UserName: id})
	}
	return p
}

// Partes iguales: el creador cuenta como uno mas. Antes no tenia cuota, asi que
// una cuenta de 3.000 entre "yo y dos amigos" cobraba 1.500 a cada amigo en vez
// de 1.000 — y la pantalla mostraba 1.000, porque ella si dividia entre tres.
func TestReparto_PartesIgualesIncluyeAlCreador(t *testing.T) {
	s := &Service{}
	cuotas, err := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 300000, SplitType: "equal", Participants: participantes("a", "b"),
	})
	if err != nil {
		t.Fatalf("calculateShares: %v", err)
	}
	if len(cuotas) != 3 {
		t.Fatalf("esperaba 3 cuotas (creador + 2), hay %d", len(cuotas))
	}
	if got := buscarCuota(t, cuotas, "a").Amount; got != 100000 {
		t.Fatalf("cada invitado deberia pagar un tercio: %d", got)
	}
	if total := sumar(cuotas); total != 300000 {
		t.Fatalf("las cuotas no suman el total: %d", total)
	}
}

// La cuota del creador nace pagada: el puso el dinero, lo que le deben son las
// demas. Si naciera pendiente, el grupo nunca podria liquidarse.
func TestReparto_LaCuotaDelCreadorNacePagada(t *testing.T) {
	s := &Service{}
	cuotas, _ := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 300000, SplitType: "equal", Participants: participantes("a", "b"),
	})
	if got := buscarCuota(t, cuotas, creador).Status; got != "paid" {
		t.Fatalf("la cuota del creador quedo en %q", got)
	}
	if got := buscarCuota(t, cuotas, "a").Status; got != "pending" {
		t.Fatalf("la cuota del invitado quedo en %q", got)
	}
}

// Un total que no divide exacto no puede perder centimos.
func TestReparto_ElSobranteNoSePierde(t *testing.T) {
	s := &Service{}
	// 1.000 centimos entre 3 personas: 333 + 333 + 334.
	cuotas, err := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 1000, SplitType: "equal", Participants: participantes("a", "b"),
	})
	if err != nil {
		t.Fatalf("calculateShares: %v", err)
	}
	if total := sumar(cuotas); total != 1000 {
		t.Fatalf("se perdieron centimos: las cuotas suman %d de 1000", total)
	}
	if got := buscarCuota(t, cuotas, creador).Amount; got != 334 {
		t.Fatalf("el sobrante deberia quedarse en la cuota del creador: %d", got)
	}
}

// Los porcentajes se truncan al pasar a centimos. Ese resto tiene que ir a
// alguna cuota o el total deja de cuadrar.
func TestReparto_PorcentajesTruncadosNoPierdenElResto(t *testing.T) {
	s := &Service{}
	p := participantes("a", "b", "c")
	p[0].Percentage, p[1].Percentage, p[2].Percentage = 33.33, 33.33, 33.33
	cuotas, err := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 100000, SplitType: "percentage", Participants: p,
	})
	if err != nil {
		t.Fatalf("calculateShares: %v", err)
	}
	if total := sumar(cuotas); total != 100000 {
		t.Fatalf("las cuotas no suman el total: %d", total)
	}
}

// Un reparto a la medida que no cubre el total deja el resto al creador, que es
// quien pago la cuenta; uno que se pasa del total se rechaza.
func TestReparto_ALaMedida(t *testing.T) {
	s := &Service{}
	p := participantes("a", "b")
	p[0].Amount, p[1].Amount = 30000, 20000

	cuotas, err := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 100000, SplitType: "custom", Participants: p,
	})
	if err != nil {
		t.Fatalf("calculateShares: %v", err)
	}
	if got := buscarCuota(t, cuotas, creador).Amount; got != 50000 {
		t.Fatalf("el resto deberia quedar a cargo del creador: %d", got)
	}
	if total := sumar(cuotas); total != 100000 {
		t.Fatalf("las cuotas no suman el total: %d", total)
	}

	p[0].Amount = 90000 // 90.000 + 20.000 > 100.000
	if _, err := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 100000, SplitType: "custom", Participants: p,
	}); err == nil {
		t.Fatal("un reparto que se pasa del total deberia rechazarse")
	}
}

// Un total tan chico que a alguien le tocaria cero no es una division: es una
// cuota que al pagarse no mueve dinero y deja el grupo en un estado raro.
func TestReparto_RechazaCuotasDeCero(t *testing.T) {
	s := &Service{}
	if _, err := s.calculateShares("g1", creador, &CreateSplitRequest{
		TotalAmount: 2, SplitType: "equal", Participants: participantes("a", "b"),
	}); err == nil {
		t.Fatal("un total de 2 centimos entre 3 personas deberia rechazarse")
	}
}
