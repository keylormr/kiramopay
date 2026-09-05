package audit

import (
	"sync"
	"testing"
)

// TestStop_ConProductoresVivos comprueba lo que rompia al apagar el proceso:
// Stop cerraba el canal sin coordinarse con quien estuviera escribiendo, y una
// goroutine de fondo a mitad de tick (el barrido de vencimientos, la
// conciliacion) podia mandar su evento a un canal ya cerrado. Un envio a un
// canal cerrado es un panico, y el panico se lleva el proceso.
//
// Sin el arreglo esta prueba entra en panico con "send on closed channel"; el
// -race del CI lo delata ademas como carrera.
func TestStop_ConProductoresVivos(t *testing.T) {
	l := &Logger{
		events: make(chan Event, 4), // pequeno a proposito: el buffer se llena
		done:   make(chan struct{}),
	}
	// Consumidor minimo: descarta y cierra done, como hace drain al terminar.
	go func() {
		for range l.events {
		}
		close(l.done)
	}()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				l.Log(Event{Action: "barrido", ResourceType: "user"})
			}
		}()
	}

	// Apagar mientras los productores siguen escribiendo.
	l.Stop()
	wg.Wait()
}

// TestStop_DosVeces: el apagado puede llegar por dos caminos (el defer de main
// y un cierre explicito). Cerrar dos veces un canal tambien es panico.
func TestStop_DosVeces(t *testing.T) {
	l := &Logger{events: make(chan Event, 1), done: make(chan struct{})}
	go func() {
		for range l.events {
		}
		close(l.done)
	}()

	l.Stop()
	l.Stop()
}

// TestLog_DespuesDeStop: un evento tardio se descarta con un aviso, no tumba
// nada. Es la unica conducta posible una vez que el consumidor ya no existe.
func TestLog_DespuesDeStop(t *testing.T) {
	l := &Logger{events: make(chan Event, 1), done: make(chan struct{})}
	go func() {
		for range l.events {
		}
		close(l.done)
	}()
	l.Stop()
	l.Log(Event{Action: "tarde"}) // no debe entrar en panico
}
