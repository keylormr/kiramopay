package testutil

import (
	"context"
	"fmt"
	"sync"

	"github.com/redis/go-redis/v9"
)

// EspiaDeRedis responde las ordenes dentro del proceso, antes de que salgan a
// la red: una prueba no necesita un Redis vivo y ve EXACTAMENTE cuantas ordenes
// manda el codigo por operacion.
//
// Sirve para lo que ningun Redis de verdad deja comprobar sin carreras: que
// contar y fijar el vencimiento sean UNA sola orden. Entre dos ordenes hay una
// ventana, y un proceso que muere ahi deja la llave sin vencimiento para
// siempre; el unico testigo de que esa ventana no existe es el conteo de
// ordenes.
//
// Vive aqui, y no en el paquete de cada prueba, porque el mismo contador
// aparece en tres lugares (limitador de tasa, bloqueo de cuenta, cuota del
// asistente) y la copia del espia era la forma de que la prueba existiera en
// uno y faltara en los otros dos.
type EspiaDeRedis struct {
	mu       sync.Mutex
	ordenes  []string
	cuenta   map[string]int64
	conVence map[string]bool
}

// NuevoEspiaDeRedis crea un espia vacio.
func NuevoEspiaDeRedis() *EspiaDeRedis {
	return &EspiaDeRedis{cuenta: map[string]int64{}, conVence: map[string]bool{}}
}

// Cliente devuelve un cliente de Redis que responde con el espia. La direccion
// no importa: nunca se abre una conexion.
func (e *EspiaDeRedis) Cliente() *redis.Client {
	c := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	c.AddHook(e)
	return c
}

// Ordenes son los nombres de las ordenes recibidas, en orden.
func (e *EspiaDeRedis) Ordenes() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.ordenes...)
}

// TieneVencimiento dice si a la llave se le fijo un vencimiento.
func (e *EspiaDeRedis) TieneVencimiento(llave string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.conVence[llave]
}

// Cuenta es el valor del contador de la llave.
func (e *EspiaDeRedis) Cuenta(llave string) int64 {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cuenta[llave]
}

func (e *EspiaDeRedis) DialHook(next redis.DialHook) redis.DialHook { return next }

func (e *EspiaDeRedis) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

func (e *EspiaDeRedis) ProcessHook(_ redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error { return e.responder(cmd) }
}

func (e *EspiaDeRedis) responder(cmd redis.Cmder) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	nombre := cmd.Name()
	e.ordenes = append(e.ordenes, nombre)
	args := cmd.Args()

	switch nombre {
	case "incr", "decr":
		llave := fmt.Sprint(args[1])
		if nombre == "incr" {
			e.cuenta[llave]++
		} else {
			e.cuenta[llave]--
		}
		c, ok := cmd.(*redis.IntCmd)
		if !ok {
			return fmt.Errorf("%s devolvio %T", nombre, cmd)
		}
		c.SetVal(e.cuenta[llave])
	case "expire", "pexpire":
		llave := fmt.Sprint(args[1])
		e.conVence[llave] = true
		c, ok := cmd.(*redis.BoolCmd)
		if !ok {
			return fmt.Errorf("%s devolvio %T", nombre, cmd)
		}
		c.SetVal(true)
	case "del":
		llave := fmt.Sprint(args[1])
		delete(e.cuenta, llave)
		delete(e.conVence, llave)
		c, ok := cmd.(*redis.IntCmd)
		if !ok {
			return fmt.Errorf("del devolvio %T", cmd)
		}
		c.SetVal(1)
	case "eval", "evalsha":
		// EVAL <guion> <cuantas llaves> <llave> ...: el guion cuenta y fija el
		// vencimiento de una sola vez, asi que aqui se emulan las dos cosas.
		llave := fmt.Sprint(args[3])
		e.cuenta[llave]++
		e.conVence[llave] = true
		c, ok := cmd.(*redis.Cmd)
		if !ok {
			return fmt.Errorf("%s devolvio %T", nombre, cmd)
		}
		c.SetVal(e.cuenta[llave])
	default:
		return fmt.Errorf("orden no esperada: %s", nombre)
	}
	return nil
}
