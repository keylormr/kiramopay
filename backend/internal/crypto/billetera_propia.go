package crypto

import "context"

// La billetera propia.
//
// Es la parte de cripto donde la persona guarda sus llaves en el telefono: el
// servidor no las recibe, no las ve y no firma por ella. Por eso aqui no hay
// rutas que muevan nada; lo unico que el servidor decide es si la pantalla la
// ofrece.
//
// En produccion espera el criterio del abogado. La Ley 10961 (art. 15 quater
// de la Ley 7786) obliga a inscribirse en SUGEF a quien, como negocio, cambia,
// transfiere o custodia activos virtuales; una billetera donde solo la persona
// tiene las llaves en principio queda fuera, pero eso lo confirma el abogado,
// no el codigo. Se abre para todos con BILLETERA_PROPIA=abierta, sin publicar
// otra version. Las cuentas de demostracion la ven siempre, igual que en la
// pausa de compras (pausa.go).

// BilleteraPropiaAbierta dice si esta cuenta ve la billetera propia.
func (s *Service) BilleteraPropiaAbierta(ctx context.Context, userID string) (bool, error) {
	if !s.billeteraPropiaEnEspera {
		return true, nil
	}
	return s.repo.EsCuentaDemo(ctx, userID)
}
