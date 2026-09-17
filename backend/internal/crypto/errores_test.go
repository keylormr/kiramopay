package crypto

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/shopspring/decimal"
)

// El defecto de produccion, tal cual lo devolvio la venta: el error del CHECK
// envuelto en los prefijos del servicio y del libro.
func errorDelCheck() error {
	pg := &pgconn.PgError{
		Severity:       "ERROR",
		Code:           "23514",
		Message:        `new row for relation "crypto_assets" violates check constraint "chk_crypto_balance_nonneg"`,
		ConstraintName: "chk_crypto_balance_nonneg",
		TableName:      "crypto_assets",
	}
	return fmt.Errorf("sell BTC: post ledger: en la misma tx: %w", pg)
}

func cuerpoDeError(t *testing.T, err error, codigoDeLaOperacion string) (int, string, string, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	responderError(rec, err, codigoDeLaOperacion)
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if jerr := json.Unmarshal(rec.Body.Bytes(), &env); jerr != nil {
		t.Fatalf("la respuesta no es JSON: %s", rec.Body.String())
	}
	return rec.Code, env.Error.Code, env.Error.Message, rec.Body.String()
}

// Lo que salio en produccion: 400 SELL_FAILED con la tabla, el CHECK y el
// SQLSTATE. Un error que no se reconoce ahora es un 5xx con texto generico.
func TestResponderError_UnErrorDeLaBaseNoSaleAlCliente(t *testing.T) {
	estado, codigo, mensaje, cuerpo := cuerpoDeError(t, errorDelCheck(), "SELL_FAILED")
	if estado != http.StatusInternalServerError || codigo != "SELL_FAILED" {
		t.Fatalf("estado=%d codigo=%q, se esperaba 500 SELL_FAILED", estado, codigo)
	}
	if mensaje != "internal server error" {
		t.Fatalf("mensaje = %q, se esperaba el generico", mensaje)
	}
	for _, filtrado := range []string{"SQLSTATE", "23514", "crypto_assets", "chk_", "post ledger", "en la misma tx"} {
		if strings.Contains(cuerpo, filtrado) {
			t.Fatalf("la respuesta filtra %q: %s", filtrado, cuerpo)
		}
	}
}

func TestResponderError_CodigosPropios(t *testing.T) {
	envuelto := func(err error) error { return fmt.Errorf("sell BTC: post ledger: en la misma tx: %w", err) }
	casos := []struct {
		nombre  string
		err     error
		estado  int
		codigo  string
		mensaje string
	}{
		{"saldo de activo, desde el gancho",
			envuelto(fmt.Errorf("%w: BTC", ErrSaldoDeActivoInsuficiente)),
			http.StatusUnprocessableEntity, "CRYPTO_INSUFFICIENT_BALANCE", "insufficient asset balance"},
		{"monto invalido",
			fmt.Errorf("%w: at most 18 decimal places", ErrMontoInvalido),
			http.StatusBadRequest, "CRYPTO_INVALID_AMOUNT", "invalid amount: at most 18 decimal places"},
		{"saldo de la billetera",
			fmt.Errorf("buy BTC: %w", transaction.ErrSaldoInsuficiente),
			http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE", "insufficient balance"},
		{"tope diario",
			envuelto(transaction.ErrDailyLimitExceeded),
			http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED", "daily spending limit exceeded"},
		{"tope mensual",
			envuelto(transaction.ErrMonthlyLimitExceeded),
			http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED", "monthly spending limit exceeded"},
		{"segundo factor",
			fmt.Errorf("buy BTC: %w", transaction.ErrMFARequired),
			http.StatusPreconditionRequired, "MFA_REQUIRED", "verified MFA challenge required for this amount"},
		{"llave de otro movimiento",
			fmt.Errorf("sell BTC: %w: k-1", transaction.ErrLlaveReutilizada),
			http.StatusConflict, "LLAVE_REUTILIZADA", "idempotency key reused for a different movement"},
		{"precio movido",
			fmt.Errorf("%w: en pantalla 1.00 USD, ahora 2.00 USD", ErrPrecioMovido),
			http.StatusConflict, "PRICE_MOVED", "el precio cambio desde que se mostro: en pantalla 1.00 USD, ahora 2.00 USD"},
		// Un 503 tambien es un 5xx: la pantalla decide por el codigo.
		{"sin precio",
			fmt.Errorf("%w: BTC", ErrSinPrecio),
			http.StatusServiceUnavailable, "PRICE_UNAVAILABLE", "internal server error"},
		{"riesgo, con el codigo de la operacion",
			fmt.Errorf("buy BTC: %w", transaction.ErrBloqueadoPorRiesgo),
			http.StatusBadRequest, "SELL_FAILED", "this transaction was blocked by the risk engine"},
		{"posicion que no existe",
			ErrPosicionNoEncontrada,
			http.StatusNotFound, "STAKING_POSITION_NOT_FOUND", "staking position not found"},
		{"posicion ya retirada",
			fmt.Errorf("unstake: %w", ErrPosicionNoActiva),
			http.StatusConflict, "STAKING_POSITION_INACTIVE", "staking position is not active"},
		{"activo fuera del programa de staking",
			fmt.Errorf("%w: USDT", ErrStakingNoDisponible),
			http.StatusBadRequest, "STAKING_NOT_AVAILABLE", "staking is not available for this asset"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			estado, codigo, mensaje, _ := cuerpoDeError(t, c.err, "SELL_FAILED")
			if estado != c.estado || codigo != c.codigo {
				t.Fatalf("estado=%d codigo=%q, se esperaba %d %s", estado, codigo, c.estado, c.codigo)
			}
			if mensaje != c.mensaje {
				t.Fatalf("mensaje = %q, se esperaba %q", mensaje, c.mensaje)
			}
		})
	}
}

// El plazo del staking sale con su codigo y con la fecha que arma el servicio.
func TestResponderError_PosicionBloqueadaLlevaLaFecha(t *testing.T) {
	err := fmt.Errorf("%w until %s", ErrPosicionBloqueada, "2026-10-01")
	estado, codigo, mensaje, _ := cuerpoDeError(t, err, "UNSTAKE_FAILED")
	if estado != http.StatusConflict || codigo != "STAKING_POSITION_LOCKED" || mensaje != "position is locked until 2026-10-01" {
		t.Fatalf("estado=%d codigo=%q mensaje=%q", estado, codigo, mensaje)
	}
}

// USDT y USDC salieron del programa, y un activo que nunca estuvo tambien se
// rechaza: antes se aceptaba cualquiera con tasa cero. El rechazo va antes de
// tocar la base, asi que el servicio sin repositorio alcanza para probarlo.
func TestStake_SoloLosActivosDelPrograma(t *testing.T) {
	svc := &Service{}
	for _, activo := range []string{"USDT", "USDC", "BTC", ""} {
		_, err := svc.Stake(context.Background(), "u", &StakeRequest{Asset: activo, Amount: decimal.NewFromInt(1)})
		if !errors.Is(err, ErrStakingNoDisponible) {
			t.Fatalf("stakear %q = %v, se esperaba ErrStakingNoDisponible", activo, err)
		}
	}
	for _, activo := range []string{"ETH", "SOL"} {
		if _, ok := stakingAPY[activo]; !ok {
			t.Fatalf("%s deberia seguir en el programa", activo)
		}
	}
}

// El abono no admite un descuento: por ese camino, con un delta negativo, la
// venta chocaba SIEMPRE con el CHECK de saldo. La guarda corta antes de tocar
// la base, asi que aqui no hace falta una.
func TestAbonarActivo_RechazaLoQueNoEsUnAbono(t *testing.T) {
	for _, cantidad := range []decimal.Decimal{decimal.NewFromFloat(-0.00001), decimal.Zero} {
		err := abonarActivo(context.Background(), nil, "u", "BTC", "Bitcoin", cantidad, decimal.Zero)
		if !errors.Is(err, errAbonoNoPositivo) {
			t.Fatalf("abonar %s = %v, se esperaba errAbonoNoPositivo", cantidad, err)
		}
	}
}

func TestValidarCantidad(t *testing.T) {
	validas := []string{"0.00001", "6", "0.000000000000000001"}
	for _, v := range validas {
		if err := validarCantidad(decimal.RequireFromString(v)); err != nil {
			t.Errorf("%s: %v", v, err)
		}
	}
	// Mas de 18 decimales no entra en NUMERIC(38,18): la base lo redondearia y
	// lo descontado dejaria de ser lo anotado.
	invalidas := []string{"0", "-1", "0.0000000000000000001"}
	for _, v := range invalidas {
		if err := validarCantidad(decimal.RequireFromString(v)); !errors.Is(err, ErrMontoInvalido) {
			t.Errorf("%s = %v, se esperaba ErrMontoInvalido", v, err)
		}
	}
}
