package crypto

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

// El indice unico de la llave abarca todos los movimientos de la persona, no
// solo los envios. Un movimiento de otro tipo con el mismo activo, la misma
// cantidad y la misma contraparte no es el envio que se reintenta, y
// devolverlo seria contestar "enviado" por algo que no se envio. Hoy ningun
// otro movimiento con llave lleva contraparte, asi que ningun camino lo
// produce; la comparacion no deberia depender de eso, y mismaOperacion, la de
// convertir y apartar, ya compara el tipo.
func TestMismoEnvio_OtroTipoDeMovimientoNoEsElEnvio(t *testing.T) {
	pedido := &TransactionRecord{
		Type: "send", Asset: "BTC", Amount: decimal.NewFromInt(1), CounterpartyUserID: "quien-recibe",
	}
	otroTipo := *pedido
	otroTipo.Type = "buy"
	if err := mismoEnvio(&otroTipo, pedido); !errors.Is(err, ErrLlaveDeOtroEnvio) {
		t.Fatalf("mismoEnvio = %v, se esperaba ErrLlaveDeOtroEnvio", err)
	}

	elMismo := *pedido
	if err := mismoEnvio(&elMismo, pedido); err != nil {
		t.Fatalf("el reintento del mismo envio se rechazo: %v", err)
	}
}

// El porcentaje que se publica (en la hoja de confirmacion y en
// /transparency/fees) es PorcentajeComisionDeEnvio, y la tasa con la que se
// cobra es tasaDeComision. Son dos constantes; si alguien cambia una y olvida
// la otra, se cobraria un numero distinto del publicado.
func TestComisionDeEnvio_ElPorcentajePublicadoEsLaTasaQueSeCobra(t *testing.T) {
	if !comisionDeEnvio.Mul(decimal.NewFromInt(100)).Equal(comisionEnPorciento) {
		t.Fatalf("se cobra %s del envio pero se publica %s %%", comisionDeEnvio, comisionEnPorciento)
	}
	if got := comisionDe(decimal.NewFromInt(1000)); !got.Equal(decimal.RequireFromString("2.5")) {
		t.Fatalf("comision de 1000 = %s, esperaba 2.5 (0,25 %%)", got)
	}
}
