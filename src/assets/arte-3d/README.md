# Arte 3D del rediseño

Iconos e ilustraciones en 3D del concepto oscuro premium (rediseño aprobado el
2026-11-06). Los originales son PNG de 1024 px y 2048 px con fondo transparente
(73 MB en total) y **no se versionan**: aquí solo viven las versiones WebP.

## Cómo se usan

Nunca se importa un archivo de esta carpeta directo en una pantalla. Todo pasa
por `src/components/arte3d/`:

- `catalogo.ts` importa **solo** los archivos que alguna pantalla usa y les da
  un nombre de uso (`comida`, `envioListo`, ...). Vite empaqueta únicamente lo
  importado: lo que no está en el catálogo no llega al build.
- `Arte3D.tsx` pinta `<Icono3D>` y `<Ilustracion3D>`: un `<img>` con `srcset`
  de los dos tamaños, `sizes` igual al tamaño en pantalla, ancho y alto fijos
  (sin saltos de layout), carga diferida salvo `prioritaria`, y decorativo por
  defecto (`alt=""` y `aria-hidden`). Si la imagen dice algo que el texto de al
  lado no dice, se le pasa `alt`.

Para sumar uno: agregar los dos `import` en `catalogo.ts` (64 + 128 para un
icono, 480 + 960 para una ilustración) y su entrada en `ICONOS_3D` o
`ILUSTRACIONES_3D`.

## Tamaños y formato

| Tipo | Tamaños | Uso de cada tamaño |
|---|---|---|
| Iconos (`iconos/`) | 64, 128, 256 px | 64 y 128 cubren de 32 a 64 px en pantalla con densidad 1x y 2x; 256 queda para tamaños grandes que aún no se usan |
| Ilustraciones (`ilustraciones/`) | 480, 960 px | 480 para hasta ~160 px en 3x; 960 para tamaños mayores |

Conversión: recorte al contorno visible con un margen (6 % en iconos, 5 % en
ilustraciones), lienzo cuadrado, WebP calidad 82 con alfa calidad 90 y método 6.

Solo WebP, sin AVIF: con fondo transparente y piezas tan pequeñas la ganancia
de AVIF es poca, y la herramienta de conversión disponible no lo genera. Si más
adelante hace falta, se agrega como otra fuente sin tocar las pantallas.

`vite.config.ts` deja los `.webp` fuera de `assetsInlineLimit`: sin eso los de
64 px se incrustarían en base64 dentro del JS y harían crecer los chunks.

## Peso

| Conjunto | Archivos | Peso |
|---|---|---|
| Iconos 64 px | 27 | 65 KB |
| Iconos 128 px | 27 | 147 KB |
| Iconos 256 px | 27 | 358 KB |
| Ilustraciones 480 px | 15 | 458 KB |
| Ilustraciones 960 px | 15 | 1.145 KB |
| **Total en el repo** | **126** | **2,2 MB** |

En el build entran solo los del catálogo (fase 3: 50 archivos, 481 KB). El
navegador baja uno de los dos tamaños de cada imagen visible, no los dos.

## Inventario

`En uso` indica la pantalla que lo muestra desde la fase 3 del rediseño. Los
demás están convertidos y listos para las fases siguientes.

### Iconos

| Archivo | Muestra | Nombre en el catálogo | En uso |
|---|---|---|---|
| `c0-comida` | tazón de comida | `comida` | Inicio, actividad (categoría comida) |
| `c1-transporte` | auto compacto | `transporte` | Inicio, actividad (transporte) |
| `c2-supermercado` | carrito con compras | `supermercado` | Inicio, actividad (supermercado) |
| `c3-entretenimiento` | claqueta de cine | `entretenimiento` | Inicio, actividad (entretenimiento) |
| `s0-luz` | rayo | `luz` | Inicio, actividad (electricidad) |
| `s1-agua` | gota de agua | `agua` | Inicio, actividad (agua) |
| `s2-telefonia` | teléfono con señal | `telefonia` | Inicio, actividad (telefonía) |
| `s3-internet` | señal wifi | `internet` | Inicio, actividad (internet) |
| `s4-cable` | televisor | `cable` | Inicio, actividad (cable) |
| `s5-recarga` | tarjeta SIM con un más | `recarga` | Inicio, actividad (recargas) |
| `s6-factura` | factura de papel | `factura` | Inicio, actividad (pago de servicios) |
| `m1-moneda` | moneda lisa | `moneda` | Inicio, actividad (reembolsos y respaldo) |
| `m2-pila` | pila de monedas | `pila` | Inicio, actividad (depósitos y retiros) |
| `f1-analisis` | barras que suben | `analisis` | Inicio, tarjeta "Gastado este mes" |
| `f2-metas` | diana con bandera | `metas` | Inicio, acceso a Metas y actividad de metas |
| `f3-dividir` | recibo partido | `dividir` | Inicio, acceso a Dividir cuenta |
| `f4-recompensas` | caja de regalo | `recompensas` | Inicio, acceso a Puntos y actividad de cashback |
| `f5-asistente` | globo de chat con destello | `asistente` | Inicio, acceso al asistente |
| `f6-marketplace` | bolsa de compras | `mercado` | Inicio, acceso al Mercado |
| `f7-tarjetas` | tarjeta de pago | `tarjetas` | Inicio, acceso a Mis tarjetas |
| `f9-cripto` | cubos encadenados | `cripto` | Inicio, actividad de cripto |
| `f10-protegido` | paquete con candado | `protegido` | Inicio, actividad de pago protegido |
| `f8-planes` | diamante | — | Pendiente: planes |
| `f11-presupuesto` | gráfico de pastel | — | Pendiente: presupuesto |
| `f12-recurrentes` | calendario con flecha | — | Pendiente: pagos fijos |
| `g0-escudo` | escudo con visto | — | Pendiente: seguridad |
| `g1-candado` | candado | — | Pendiente: protección de la cuenta |

### Ilustraciones

| Archivo | Muestra | Nombre en el catálogo | En uso |
|---|---|---|---|
| `e1-enviado` | visto en círculo de vidrio y avión de papel | `envioListo` | Comprobante de SINPE; envío a un contacto escaneado |
| `e2-pagado` | recibo con sello de visto | `pagoListo` | Pago con QR desde Inicio |
| `v1-movimientos` | recibo vacío con lupa | `sinMovimientos` | Inicio y Movimientos sin movimientos |
| `e3-sin-conexion` | wifi roto y cable suelto | — | Pendiente: sin conexión |
| `b1-todo-en-uno` | teléfono con tarjeta y monedas | — | Pendiente: bienvenida o carrusel |
| `b2-envios` | dos teléfonos unidos por un arco | — | Pendiente: bienvenida o carrusel |
| `b3-seguridad` | escudo con huella frente a un teléfono | — | Pendiente: bienvenida o carrusel |
| `b4-metas` | diana junto a barras | — | Pendiente: bienvenida o carrusel |
| `v2-contactos` | libreta vacía | — | Pendiente: sin contactos |
| `v3-notificaciones` | campana con luna | — | Pendiente: sin avisos |
| `v4-tarjetas` | tarjeta con un más | — | Pendiente: sin tarjetas |
| `v5-metas` | bandera sobre monedas | — | Pendiente: primera meta |
| `v6-pagos-fijos` | calendario con flecha | — | Pendiente: sin pagos fijos |
| `v7-cripto` | cubos sobre un pedestal | — | Pendiente: sin cripto |
| `v8-dividir` | recibo partido | — | Pendiente: sin cuentas divididas |
