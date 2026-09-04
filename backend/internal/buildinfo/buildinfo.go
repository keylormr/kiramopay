// Package buildinfo dice que version del repositorio es este binario.
//
// Existe porque /health respondia "1.0.0" fijo desde siempre: desde afuera no
// habia forma de saber que build estaba sirviendo, y confirmar un despliegue
// obligaba a inventar marcadores de comportamiento ("esta ruta responde 401 en
// vez de 404"). Es la misma clase de version que mentia en la aplicacion, que
// decia 2.0.0 mientras se publicaba la 2.3.4.
//
// La version se embebe del archivo version.txt, que vive junto a este paquete
// y lo revisa `npm run check:version` contra package.json, build.gradle y el
// changelog: no se puede quedar atras en silencio.
package buildinfo

import (
	_ "embed"
	"strings"
)

//go:embed version.txt
var versionRaw string

// Version es la version del repositorio de la que salio este binario.
var Version = strings.TrimSpace(versionRaw)
