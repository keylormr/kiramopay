package uif

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"
)

// El registro de transacciones multiples es por mes calendario y el total del
// mes se convierte con la venta de referencia del BCCR del ULTIMO DIA del mes.
// Eso sale de dos remisiones (el Lin. 20.3 de SUGEF 13-19 remite al art. 12 del
// RIF, CONASSIF 6-18) y es una interpretacion que hay que confirmar con SUGEF.
// Si cambia, el unico lugar que la fija es diaDeLaVentaDelCierre.
//
// Durante el mes, cada movimiento se compara con la venta de su dia (ver
// evaluar): es el aviso temprano. El cierre es la cuenta que vale para el
// registro, y por eso recorre todos los movimientos del mes en `transactions`,
// incluidos los que entraron por caminos que no le avisan a la UIF.

// diaDeLaVentaDelCierre es el dia cuya venta de referencia convierte el total
// de un mes al cerrarlo.
func diaDeLaVentaDelCierre(mes Mes) time.Time { return mes.UltimoDia() }

// MargenDelCierre es cuanto se espera despues del fin del mes para cerrarlo. Lo
// que se creo el ultimo dia a ultima hora y se completa despues (un envio que
// queda procesando) tiene ese tiempo para entrar a la cuenta, y el actualizador
// del tipo de cambio para guardar la venta del ultimo dia.
const MargenDelCierre = 24 * time.Hour

// ErrMesSinTerminar: no se cierra un mes que todavia no termino, ni antes de
// MargenDelCierre.
var ErrMesSinTerminar = errors.New("el mes todavia no termino")

// ResumenDelCierre dice que dejo el cierre de un mes.
type ResumenDelCierre struct {
	Mes string
	// Clientes son los que tuvieron movimientos en el mes; Casos, los que abrio
	// el cierre.
	Clientes int
	Casos    int
	// Tasas son las ventas con que se convirtio, legibles.
	Tasas string
	// YaCerrado: el mes ya estaba cerrado y no se toco nada.
	YaCerrado bool
}

// CerrarMes recalcula lo que cada cliente movio en el mes con la venta del
// ultimo dia del mes y abre un caso cierre_mes por cada cliente cuyas salidas,
// entradas o bruto igualen o superen el umbral. Un cliente con una moneda sin
// tipo de cambio que sin ella no llega va a revision manual. Un mes se cierra
// una sola vez: los casos y la marca del mes quedan juntos o no queda nada. Si
// la base no responde al leer una tasa, no se cierra: el error vuelve y el
// proximo intento lo rehace.
func (s *Service) CerrarMes(ctx context.Context, mes Mes) (*ResumenDelCierre, error) {
	res := &ResumenDelCierre{Mes: mes.String()}
	if s.ahora().Before(mes.Fin.Add(MargenDelCierre)) {
		return nil, fmt.Errorf("%w: %s se cierra desde %s", ErrMesSinTerminar, mes,
			mes.Fin.Add(MargenDelCierre).In(zonaCR).Format("2006-01-02 15:04"))
	}
	ya, err := s.repo.mesCerrado(ctx, mes)
	if err != nil {
		return nil, err
	}
	if ya {
		res.YaCerrado = true
		return res, nil
	}
	filas, err := s.repo.totalesDelMes(ctx, mes)
	if err != nil {
		return nil, err
	}

	dia := diaDeLaVentaDelCierre(mes)
	type deCliente struct{ salidas, entradas []sumaDia }
	clientes := map[string]*deCliente{}
	var orden []string
	monedas := map[string]bool{}
	for _, f := range filas {
		c := clientes[f.userID]
		if c == nil {
			c = &deCliente{}
			clientes[f.userID] = c
			orden = append(orden, f.userID)
		}
		fila := sumaDia{sentido: f.sentido, moneda: f.moneda, dia: dia, monto: f.monto}
		if f.sentido == sentidoSalida {
			c.salidas = append(c.salidas, fila)
		} else {
			c.entradas = append(c.entradas, fila)
		}
		monedas[f.moneda] = true
	}

	conv := s.nuevaConversion(ctx, "")
	tasas := s.tasasDelCierre(conv, monedas, dia)
	if conv.fallo != nil {
		return nil, fmt.Errorf("uif: cierre de %s: %w", mes, conv.fallo)
	}

	var casos []*Report
	for _, userID := range orden {
		c := clientes[userID]
		sal, ent := conv.sumar(c.salidas), conv.sumar(c.entradas)
		bruto := sal.usd + ent.usd
		u := s.thresholds.MensualUSD
		var cruces []string
		if sal.usd >= u {
			cruces = append(cruces, fmt.Sprintf("las salidas del mes (US$%s)", dolares(sal.usd)))
		}
		if ent.usd >= u {
			cruces = append(cruces, fmt.Sprintf("las entradas del mes (US$%s)", dolares(ent.usd)))
		}
		if bruto >= u {
			cruces = append(cruces, fmt.Sprintf("el bruto del mes, salidas mas entradas (US$%s)", dolares(bruto)))
		}
		faltan := unirFaltan(sal, ent)
		rep := &Report{
			UserID: userID,
			// El bruto del mes, en dolares: las dos columnas del mes dicen de que
			// esta hecho.
			AmountMinor:    bruto,
			Currency:       "USD",
			Mes:            fecha(mes.PrimerDia()),
			SalidasMesUSD:  sal.usd,
			EntradasMesUSD: ent.usd,
			Status:         StatusPending,
		}
		switch {
		case len(cruces) > 0:
			rep.ReportType = TypeCierreMes
			rep.Reason = s.razonDelCierre(ctx, userID, mes, dia, cruces, sal, ent)
		case len(faltan) > 0:
			rep.ReportType = TypeManual
			rep.Reason = fmt.Sprintf("al cerrar el mes %s los movimientos no se pudieron sumar enteros: no hay "+
				"tipo de cambio oficial del %s para %s. Sin esa moneda salieron US$%s y entraron US$%s, y el "+
				"umbral es US$%s. Revisarlo a mano.", mes, fecha(dia), strings.Join(faltan, ", "),
				dolares(sal.usd), dolares(ent.usd), dolares(u))
		default:
			continue
		}
		casos = append(casos, rep)
	}
	if conv.fallo != nil {
		return nil, fmt.Errorf("uif: cierre de %s: %w", mes, conv.fallo)
	}

	ya, nuevos, err := s.repo.guardarCierre(ctx, mes, tasas, len(orden), casos)
	if err != nil {
		return nil, err
	}
	if ya {
		res.YaCerrado = true
		return res, nil
	}
	for _, rep := range nuevos {
		s.auditarCaso(rep)
	}
	res.Clientes, res.Casos, res.Tasas = len(orden), len(nuevos), tasas
	slog.Info("uif: mes cerrado", "mes", res.Mes, "clientes", res.Clientes, "casos", res.Casos, "tasas", tasas)
	return res, nil
}

// tasasDelCierre consulta la venta del dia del cierre de cada moneda, da la
// alarma si es vieja y la deja escrita para la marca del mes.
func (s *Service) tasasDelCierre(conv *conversion, monedas map[string]bool, dia time.Time) string {
	lista := make([]string, 0, len(monedas))
	for m := range monedas {
		if m != "USD" {
			lista = append(lista, m)
		}
	}
	sort.Strings(lista)
	var partes []string
	for _, m := range lista {
		cot, err := conv.cotizar(m, dia)
		if err != nil {
			partes = append(partes, m+" sin tipo de cambio")
			continue
		}
		alarmarSiEsVieja("", m, cot, dia)
		partes = append(partes, fmt.Sprintf("%s %s por dolar (%s del %s)", m, tasaLegible(cot.PorDolar), cot.Fuente, fecha(cot.Fecha)))
	}
	if len(partes) == 0 {
		return "solo dolares"
	}
	return strings.Join(partes, "; ")
}

func (s *Service) razonDelCierre(ctx context.Context, userID string, mes Mes, dia time.Time, cruces []string, sal, ent total) string {
	r := fmt.Sprintf("cierre del mes %s (SUGEF 13-19 art. 20, Lin. 22.2): %s igualan o superan el umbral de US$%s, "+
		"con la venta de referencia del %s", mes, strings.Join(cruces, " y "), dolares(s.thresholds.MensualUSD), fecha(dia))
	if len(sal.partes) > 0 {
		r += "; salieron " + strings.Join(sal.partes, " + ")
	}
	if len(ent.partes) > 0 {
		r += "; entraron " + strings.Join(ent.partes, " + ")
	}
	if faltan := unirFaltan(sal, ent); len(faltan) > 0 {
		r += "; sin contar " + strings.Join(faltan, ", ") + ", que no tiene tipo de cambio oficial"
	}
	if n, err := s.repo.casosDelMes(ctx, userID, mes, TypeMultiplesMes); err == nil && n > 0 {
		r += fmt.Sprintf("; durante el mes ya se habia abierto %d caso(s) multiples_mes por este cliente", n)
	}
	return r
}

// IniciarCierres cierra el mes anterior en cuanto pasa MargenDelCierre desde
// que empezo uno nuevo, y lo vuelve a intentar cada `cada` mientras no quede
// cerrado (la base no
// respondia, la instancia se reinicio). Un mes cerrado no se vuelve a cerrar,
// asi que revisar cada hora cuesta una consulta.
func (s *Service) IniciarCierres(ctx context.Context, cada time.Duration) {
	if cada <= 0 {
		cada = time.Hour
	}
	go func() {
		s.cerrarMesAnterior(ctx)
		t := time.NewTicker(cada)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.cerrarMesAnterior(ctx)
			}
		}
	}()
}

func (s *Service) cerrarMesAnterior(ctx context.Context) {
	mes := MesDe(s.ahora().Add(-MargenDelCierre)).Anterior()
	if _, err := s.CerrarMes(ctx, mes); err != nil {
		// Error y no Warn: un mes sin cerrar es un registro ante SUGEF que no se
		// sabe si hay que hacer.
		slog.Error("uif: no se pudo cerrar el mes", "mes", mes.String(), "err", err.Error())
	}
}
