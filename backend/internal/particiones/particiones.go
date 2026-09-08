// Package particiones mantiene vivas las particiones de la tabla transactions.
//
// `transactions` esta particionada por rango sobre created_date y no tiene
// particion DEFAULT. Un INSERT cuya fecha no cae en ninguna particion falla, y
// como cada movimiento de dinero escribe una fila ahi, quedarse sin particiones
// no degrada la aplicacion: la detiene.
//
// Las funciones de base para crearlas existen desde las migraciones 014 y 023,
// y la segunda las envuelve en `maintain_all_partitions()` con el comentario
// "Call this from CronJob". Ese CronJob nunca existio: corrieron una sola vez,
// el dia que se aplico cada migracion. Este paquete es ese llamador.
package particiones

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Intervalo entre corridas. Una vez al dia sobra para un margen de 14 meses; lo
// que importa no es la frecuencia sino que exista alguien llamando.
const Intervalo = 24 * time.Hour

type Servicio struct {
	pool   *pgxpool.Pool
	logger *slog.Logger

	margen atomicFecha
}

func NewServicio(pool *pgxpool.Pool, logger *slog.Logger) *Servicio {
	return &Servicio{pool: pool, logger: logger}
}

// Mantener crea las particiones que falten y refresca el margen conocido.
func (s *Servicio) Mantener(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `SELECT maintain_all_partitions()`); err != nil {
		return fmt.Errorf("maintain_all_partitions: %w", err)
	}
	return s.refrescarMargen(ctx)
}

func (s *Servicio) refrescarMargen(ctx context.Context) error {
	var hasta time.Time
	if err := s.pool.QueryRow(ctx, `SELECT transactions_partition_runway()`).Scan(&hasta); err != nil {
		return fmt.Errorf("transactions_partition_runway: %w", err)
	}
	s.margen.set(hasta)
	return nil
}

// MargenHasta es la fecha (exclusiva) hasta la que hay cobertura continua de
// particiones. Cero si todavia no se pudo consultar.
func (s *Servicio) MargenHasta() time.Time { return s.margen.get() }

// DiasDeMargen es lo que se publica en /health: cuantos dias faltan para que un
// INSERT en transactions empiece a fallar. Negativo o cero significa que ya
// estamos dentro del hueco. -1 significa que no se pudo consultar.
func (s *Servicio) DiasDeMargen(ahora time.Time) int {
	hasta := s.margen.get()
	if hasta.IsZero() {
		return -1
	}
	return int(hasta.Sub(ahora).Hours() / 24)
}

// Iniciar corre el mantenimiento una vez al arrancar y despues cada Intervalo.
//
// El fallo de la primera corrida NO tumba el arranque a proposito: el margen
// que dejo la corrida anterior suele ser de meses, asi que negarse a abrir el
// puerto por esto seria cambiar un problema con meses de aviso por una caida
// inmediata. Se grita en el log y queda visible en /health.
func (s *Servicio) Iniciar(ctx context.Context) {
	go func() {
		primera, cancel := context.WithTimeout(ctx, 60*time.Second)
		s.correr(primera)
		cancel()

		t := time.NewTicker(Intervalo)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				c, cancel := context.WithTimeout(ctx, 60*time.Second)
				s.correr(c)
				cancel()
			}
		}
	}()
}

func (s *Servicio) correr(ctx context.Context) {
	if err := s.Mantener(ctx); err != nil {
		if s.logger != nil {
			s.logger.Error("particiones: no se pudieron mantener; si el margen se agota, TODO movimiento de dinero falla",
				"err", err.Error())
		}
		return
	}
	if s.logger != nil {
		s.logger.Info("particiones al dia", "cobertura_hasta", s.margen.get().Format("2006-01-02"))
	}
}
