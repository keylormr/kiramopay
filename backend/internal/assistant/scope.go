package assistant

import (
	"context"
	"errors"
)

// Screener decide, antes de gastar un turno del modelo principal, si el
// mensaje es de KiramoPay. Un Screener nil en el Service deja solo la
// instruccion de sistema como limite.
type Screener interface {
	Screen(ctx context.Context, in ScreenInput) (ScopeVerdict, error)
}

// ScreenInput es lo que ve el filtro: el mensaje nuevo y el intercambio
// anterior, para que una continuacion corta ("y el mes pasado?") no se lea
// como una pregunta suelta.
type ScreenInput struct {
	Message       string
	PrevUser      string
	PrevAssistant string
}

// screenContextRunes es lo maximo que viaja al filtro de cada turno anterior.
const screenContextRunes = 1000

// ScopeVerdict es la decision del filtro. Language es el idioma en que se
// escribio el mensaje, uno de los siete de la app (es, en, fr, pt, hi, ja, zh).
type ScopeVerdict struct {
	InScope  bool
	Language string
}

// WithScreener conecta el filtro de alcance.
func WithScreener(sc Screener) ServiceOption {
	return func(s *Service) { s.screen = sc }
}

// outOfScopeReply es la respuesta fija a una pregunta ajena a KiramoPay.
func outOfScopeReply(_ string) string { return "" }

// Screen implementa Screener.
func (c *ClaudeClient) Screen(_ context.Context, _ ScreenInput) (ScopeVerdict, error) {
	return ScopeVerdict{}, errors.New("sin implementar")
}
