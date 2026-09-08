package particiones

import (
	"sync"
	"time"
)

// atomicFecha es un time.Time protegido: lo escribe el trabajo de fondo y lo lee
// el manejador de /health, que corre en otra goroutine.
type atomicFecha struct {
	mu sync.RWMutex
	v  time.Time
}

func (a *atomicFecha) set(t time.Time) {
	a.mu.Lock()
	a.v = t
	a.mu.Unlock()
}

func (a *atomicFecha) get() time.Time {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.v
}
