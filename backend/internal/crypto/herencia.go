package crypto

import "context"

// La boveda de herencia bitcoin.
//
// Vive dentro de la billetera propia y, como ella, solo en el telefono: las
// llaves del titular y del heredero, el plazo y las direcciones nunca llegan a
// este servidor. Aqui no hay rutas que muevan nada; lo unico que el servidor
// decide es si la pantalla la ofrece.
//
// En produccion espera dos cosas: probarla en un telefono real con un monto
// chico (la app limita cada boveda a 0,01 BTC mientras tanto) y el criterio del
// abogado sobre la figura (no es un testamento) y la Ley 10961. Se abre para
// todos con HERENCIA_BITCOIN=abierta, sin publicar otra version. Las cuentas de
// demostracion la ven siempre, igual que la billetera propia.

// HerenciaAbierta dice si esta cuenta ve la boveda de herencia.
func (s *Service) HerenciaAbierta(ctx context.Context, userID string) (bool, error) {
	if !s.herenciaEnEspera {
		return true, nil
	}
	return s.repo.EsCuentaDemo(ctx, userID)
}
