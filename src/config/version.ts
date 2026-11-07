// Sistema de versionado de KiramoPay.
//
// La VERSION y los datos del build ya no se escriben a mano: salen de
// package.json y de la plataforma que compila, inyectados por el `define` de
// vite.config.ts. Lo único que se mantiene a mano es el CHANGELOG de abajo,
// que es editorial: describe los cambios en lenguaje de usuario.
//
// Al cortar una versión hay que mover TRES cosas juntas, y `npm run
// check:version` falla en CI si alguna se queda atrás:
//   1. "version" en package.json,
//   2. versionName y versionCode en android/app/build.gradle,
//   3. la entrada de APP_VERSION.current de aquí abajo, con su changelog.
// El buildNumber de cada entrada es el versionCode de Android de esa versión.
// El número de build del pie y la fecha se resuelven solos desde el build.
//
// Esto se escribió después de que package.json pasara ocho versiones marcando
// 2.0.0 mientras la aplicación publicada iba en 2.3.3: el perfil mostraba una
// versión que no existía y el changelog se había quedado en febrero.

import type { Language } from '@/i18n/translations';

/** Versión del paquete (package.json), fijada en tiempo de build. */
export const BUILD_VERSION: string = __APP_VERSION__;

/** Commit con el que se compiló: lo aporta Vercel o GitHub Actions. */
export const BUILD_SHA: string = __BUILD_SHA__;

/** Momento del build, en ISO 8601. */
export const BUILD_DATE: string = __BUILD_DATE__;

export interface VersionInfo {
  version: string;
  buildNumber: number;
  releaseDate: string;
  changes: string[];
}

export interface AppVersion {
  current: VersionInfo;
  history: VersionInfo[];
}

export const APP_VERSION: AppVersion = {
  current: {
    version: '2.15.0',
    buildNumber: 25,
    releaseDate: '2026-11-07',
    changes: [
      'Rediseño, fase 6: la aplicación arranca en el tono oscuro',
      'Al abrir KiramoPay ves la K de la marca sobre el fondo oscuro de la aplicación, sin un destello blanco antes de la primera pantalla',
      'El icono tiene el fondo oscuro nuevo, el mismo de la marca dentro de la aplicación',
      'En Android 13 o posterior, si usas iconos temáticos, el icono de KiramoPay también toma los colores de tu teléfono',
      'La barra de estado y la de navegación combinan con el tema que elijas en la aplicación, aunque tu teléfono use otro',
      'Si instalas KiramoPay desde el navegador, el icono y la pantalla de inicio también son oscuros',
    ],
  },
  history: [
    {
      version: '2.14.0',
      buildNumber: 24,
      releaseDate: '2026-11-07',
      changes: [
        'Rediseño, fase 5: el resto de la aplicación estrena el estilo nuevo',
        'Antes de pagar con QR o de enviar cripto revisas a quién le llega, cuánto, la comisión y tu saldo, igual que al enviar por SINPE',
        'Cripto muestra los logos de Bitcoin y Ethereum, y tu cartera, SINPE y tu perfil viven en la misma tarjeta oscura del Inicio',
        'El ojo que oculta tu saldo en el Inicio ahora también tapa los montos de Movimientos, Metas, Cripto, SINPE, Servicios, Dividir y tu perfil',
        'La bienvenida, Servicios, el Mercado y las pantallas vacías tienen ilustraciones nuevas',
        'En tablet y escritorio, SINPE, Cripto, Servicios, Perfil y el Mercado se ordenan en columnas',
        'Los títulos de las secciones ya no van en mayúsculas, y donde decía "ahorro" ahora dice "Metas"',
      ],
    },
    {
      version: '2.13.0',
      buildNumber: 23,
      releaseDate: '2026-11-07',
      changes: [
        'Rediseño, fase 4: nueva pantalla de Tarjetas',
        'Tu tarjeta de KiramoPay tiene una cara nueva, con las proporciones de una tarjeta real, el filo naranja y la K de la marca',
        'El selector muestra una miniatura de cada tarjeta, y al cambiar de una a otra la tarjeta entra con un giro corto. Si tienes activado reducir el movimiento, no gira',
        'En tablet y escritorio, las tarjetas del selector se reparten centradas y ya no quedan cortadas a la derecha',
        'Si todavía no tienes tarjetas, la pantalla lo muestra con una ilustración nueva',
      ],
    },
    {
      version: '2.12.0',
      buildNumber: 22,
      releaseDate: '2026-11-07',
      changes: [
        'Rediseño, fase 3: nuevo Inicio, nuevo envío por SINPE y nuevo comprobante',
        'Tu saldo vive en una tarjeta con pestañas Total, Colones, Dólares y Cripto, y lo puedes ocultar con un toque',
        'Enviar, Recibir, Escanear y Cobrar quedan a un toque, y tu actividad reciente se agrupa por día con un icono para cada categoría',
        'En pantallas anchas, el Inicio se ordena en dos columnas: tus cuentas y accesos a la izquierda, tu actividad y tu gasto del mes a la derecha',
        'Antes de enviar por SINPE revisas a quién le llega, cuánto recibe, la comisión, tu saldo antes y después, y que llega al instante',
        'Si tecleas un número, la revisión te muestra el nombre que esa persona tiene en su perfil de KiramoPay, y Enviar espera a saberlo',
        'El comprobante dice a quién le llegó el dinero, y puedes compartirlo',
      ],
    },
    {
      version: '2.11.0',
      buildNumber: 21,
      releaseDate: '2026-11-06',
      changes: [
        'Rediseño, fase 2: renovamos Dispositivos conectados y el panel de usuarios',
        'En Dispositivos conectados, cada sesión muestra el icono de su plataforma y un nombre claro, como "Chrome en Windows" o "App KiramoPay en Android"',
        'El dispositivo que estás usando aparece aparte, con la marca "En uso", y arriba ves cuántas sesiones tienes abiertas',
        'Puedes cerrar las demás sesiones de una vez, y la aplicación te confirma cuántas se van a cerrar',
        'Las fechas y horas de tus sesiones salen en tu idioma y ya no se parten en pantallas angostas',
        'Si administras la plataforma, el panel de usuarios se adapta al teléfono, la tablet y el escritorio, y la ficha de cada cuenta muestra sus sesiones y su historial de bloqueos y cambios',
      ],
    },
    {
      version: '2.10.0',
      buildNumber: 20,
      releaseDate: '2026-11-06',
      changes: [
        'Rediseño, fase 1: nueva apariencia oscura y premium, con letra nueva, iconos de línea y movimiento cuidado. El oscuro es ahora el tema por defecto y el claro sigue disponible en Perfil',
        'Los botones y los textos azules y rojos se leen con más contraste, tanto en el tema oscuro como en el claro',
        'En pantallas anchas puedes plegar el menú lateral a una columna de iconos con el botón de arriba a la izquierda o con Ctrl + B; en pantallas medianas se abre como un cajón',
        'En el menú, "Ahorro" ahora se llama "Metas"',
        'Cuando abres una pantalla completa queda una sola barra de desplazamiento, y la página de atrás ya no se mueve',
        'Tu tarjeta virtual luce un chip dorado y el símbolo de pago sin contacto',
      ],
    },
    {
      version: '2.9.0',
      buildNumber: 19,
      releaseDate: '2026-11-05',
      changes: [
        'Puedes eliminar tu cuenta desde la aplicación o desde la web, y recibes por escrito qué se borra, qué se conserva y por cuánto tiempo. La política de privacidad ya tiene una dirección pública',
        'En el escáner puedes elegir una imagen para pagar un QR que te llegó por chat. Si el código no es de KiramoPay, el escáner te lo dice y sigue listo para el siguiente',
        'Puedes compartir como imagen tu QR de cobro, tu QR de contacto y el de tu comercio, con el marco completo y listo para enviar',
        'Al escanear un contacto ves el nombre que esa persona tiene en su perfil de KiramoPay antes de enviar o guardar, y Pagar espera a saber a quién le pagas',
        'El tipo de cambio del dólar sale del Banco Central de Costa Rica. Si no hay un tipo de cambio disponible, la aplicación lo dice en vez de mostrar un valor inventado',
        'Tu comercio muestra el detalle de cada cobro, los movimientos por día y por periodo, el resumen de ventas en el inicio y tu rol en los ajustes',
        'El saldo total y el gasto del mes coinciden en Inicio y Perfil, el asistente responde solo sobre KiramoPay y con tus saldos por moneda, y para escribir a soporte tienes su correo en la aplicación',
      ],
    },
    {
      version: '2.8.0',
      buildNumber: 18,
      releaseDate: '2026-10-18',
      changes: [
        'Cuando sale una versión nueva, la aplicación te pide instalarla antes de seguir y te cuenta qué trae',
        'Si en "Último acceso" aparece una cuenta que entra sin contraseña, entras de un toque, sin escribir tu usuario',
        'Al entrar con tu huella, si no tienes una contraseña guardada, la aplicación revisa primero si tu cuenta la necesita',
      ],
    },
    {
      version: '2.7.0',
      buildNumber: 17,
      releaseDate: '2026-10-17',
      changes: [
        'Si un envio SINPE o un retiro de tu negocio se repite por un corte de conexion, no se cobra dos veces, aunque cierres sesion y vuelvas a entrar',
        'Cuando un envio SINPE o un retiro de tu negocio no se puede hacer, la aplicacion te dice el motivo en tu idioma',
        'Pagar con QR te dice por que no se pudo: saldo, tope diario o mensual, o un comercio que todavia no esta disponible. Si el pago queda sin confirmar, reintentarlo enseguida con el mismo monto no cobra dos veces',
        'Las notificaciones y los avisos en tu telefono te llegan en el idioma que elegiste',
        'Exportar o copiar tus movimientos y el reporte del comercio salen en el idioma de la aplicacion, y el archivo exportado ya no puede ejecutar formulas al abrirlo en una hoja de calculo',
        'Al pagar tu parte de una cuenta dividida ves el nombre de quien la creo',
        'Viajes, pedidos, los ejemplos de la demo, el pago de servicios y la verificacion en dos pasos salen en tu idioma',
        'Los errores al cobrar con QR, al pagar recibos y recargas y al hablar con el asistente salen en tu idioma y no como texto tecnico',
        'El asistente te avisa cuando usaste todas tus preguntas del dia, en vez de pedirte que esperes un momento',
        'En un telefono de pantalla chica, las hojas para enviar, pagar, cobrar y operar con cripto caben enteras y el error se ve sin tener que buscarlo',
        'Tus movimientos dicen su estado real: un pago fallido, revertido o en proceso ya no aparece como pendiente, y lo fallido o revertido no se suma en tus totales',
        'En cripto, un movimiento fallido o con un estado que la aplicacion no conoce ya no se muestra como completado',
        'Si un codigo QR no se puede verificar por un problema de conexion, la aplicacion te lo dice y te deja reintentar, en vez de decir que el codigo no existe',
        'Depositar o retirar de una meta de ahorro no se repite por un corte de conexion, y si no se puede, la aplicacion te dice el motivo',
        'Actualizaciones de seguridad del servidor',
      ],
    },
    {
      version: '2.6.0',
      buildNumber: 16,
      releaseDate: '2026-10-14',
      changes: [
        'Ahorro: ya puedes retirar de una meta desde la aplicacion, y depositar funciona de nuevo en el navegador',
        'Dividir cuenta funciona: puedes crear una division, rechazar tu parte y cancelar la que creaste',
        'Alertas de precio de cripto: pides que te avisen cuando una moneda suba o baje a un precio, y se revisa cada cierto tiempo aunque no tengas la aplicacion abierta',
        'Vender cripto y recibir colones ya no falla, y puedes retirar lo que tenias en staking',
        'Pagar por QR ₡100.000 o mas ahora se completa: la aplicacion te pide la verificacion en dos pasos en el momento',
        'El boton atras deja de dejarte en una pantalla en blanco, y salir de un envio ya no te saca de la aplicacion',
        'Los montos se escriben con separador de miles y sin las flechitas de subir y bajar: "1,000" vale mil, no uno',
        'Analisis de gastos muestra ingresos y gastos con sus colores, y puedes filtrar por mes o por un rango de fechas que elijas',
        'En el inicio hay un espacio con lo que te conviene saber: los planes que vienen, tu enlace para invitar y el cobro con QR sin comision',
        'Si escaneas a alguien que ya tienes en contactos, la aplicacion te lo dice en vez de repetirlo',
        'El catalogo de premios volvio a tener recompensas, y si el fondo no alcanza te lo decimos sin descontarte puntos',
        'Que otra persona use mucho la aplicacion desde tu misma red ya no te deja sin poder entrar',
        'Enviar cripto a otra persona de KiramoPay es real: le llega a su cuenta',
        'Si una compra, venta o conversion de cripto se repite por un corte de conexion, no se cobra dos veces y la aplicacion te avisa que ya estaba hecha',
        'Tus compras, ventas y conversiones de cripto aparecen en tus movimientos con el monto completo',
        'Fechas, horas y numeros salen en el idioma que elegiste en toda la aplicacion: movimientos, SINPE, notificaciones, puntos, recargas y cripto',
        'Si no puedes entrar o cambiar tu contrasena, la aplicacion te dice el motivo, y los dos tienen un tope de intentos que protege tu cuenta',
        'Las notificaciones que quitas de tu lista ya no vuelven a aparecer',
        'Copiar y compartir tus movimientos ya no suma colones con dolares',
        'En tus movimientos, la parte de un pago dividido se ve con su nombre',
      ],
    },
    {
      version: '2.5.0',
      buildNumber: 15,
      releaseDate: '2026-09-11',
      changes: [
        'Tu codigo QR para cobrar ya no cambia cada vez: es uno solo, lo puedes imprimir, y cada cobro con monto vence solo',
        'Los pagos con escrow tienen plazos claros: quien vende tiene 14 dias para entregar y quien compra 7 para revisar. Ves cuanto te queda, puedes empezar un acuerdo con el numero de la otra persona y ceder en una disputa',
        'En el navegador, los avisos pueden llegarte con la aplicacion cerrada: activalos en Perfil, en Notificaciones',
        'Buscar en tus movimientos busca en todo tu historial, y lo que te llega aparece sin cerrar la pantalla',
        'Los precios de cripto en colones usan el tipo de cambio oficial de Hacienda del dia',
        'Los premios de cashback vuelven al catalogo: el dinero sale de un fondo de promociones, y si no alcanza te lo decimos sin descontar tus puntos',
        'La tarjeta virtual muestra un numero propio de KiramoPay, que no puede coincidir con una tarjeta real de otra persona',
        'Cada movimiento, su estado y tu historial se guardan juntos: un reintento ya no puede cobrarte dos veces',
        'El archivo CSV de movimientos ya no suma colones con dolares',
      ],
    },
    {
      version: '2.4.1',
      buildNumber: 14,
      releaseDate: '2026-09-07',
      changes: [
        'Dividir una cuenta con amigos ya se puede cobrar: eliges a quien participa por su numero, ves cuanto le toca a cada quien y pagas tu parte desde la aplicacion',
        'Al guardar o sacar dinero de una meta de ahorro, el movimiento y tu meta se actualizan juntos: ya no puede pasar que el dinero se mueva y la meta no lo muestre',
        'El catalogo de premios queda en pausa mientras no haya como entregarlos; los puntos que acumulas siguen guardados en tu cuenta',
      ],
    },
    {
      version: '2.4.0',
      buildNumber: 13,
      releaseDate: '2026-09-07',
      changes: [
        'Ahora entras con un nombre de usuario: lo eliges al crear la cuenta, lo ves en tu perfil y te lo recordamos por correo si lo olvidas',
        'Puedes ver desde que aparatos esta abierta tu cuenta y cerrar el que no reconozcas, sin cerrar el que estas usando',
        'Cambiar tu correo ahora pide tu contrasena, porque es la direccion a la que llega el enlace para recuperarla',
        'Cuando una pantalla no logra cargar tus datos te lo dice, en vez de mostrarte un cero como si fuera tu saldo',
        'Los montos se muestran siempre en la moneda que les corresponde',
        'Recargas, recibos, viajes y pedidos avisan que todavia no hay convenio en vez de cobrarte por algo que no se puede entregar',
        'Si usas iPhone, la aplicacion ya te avisa de las versiones nuevas por el canal que le corresponde',
      ],
    },
    {
      version: '2.3.6',
      buildNumber: 12,
      releaseDate: '2026-09-04',
      changes: [
        'Los precios de cripto ya no se inventan: si no se pueden obtener, la pantalla lo dice en vez de mostrar valores que no son',
        'Si dejas la aplicacion abierta y sale una version nueva, te avisa y se actualiza sola',
        'Los enlaces que abren la aplicacion desde fuera vuelven a funcionar',
        'La aplicacion ya no se queda en blanco al encontrar datos guardados de una version anterior',
        'Correcciones de seguridad en el manejo de saldos',
      ],
    },
    {
      version: '2.3.5',
      buildNumber: 11,
      releaseDate: '2026-09-03',
      changes: [
        'La pantalla "Acerca de" muestra la version que de verdad tienes instalada, y el historial de cambios vuelve a estar al dia',
        'Apagar la verificacion en dos pasos queda registrado en el historial de seguridad de tu cuenta',
      ],
    },
    {
      version: '2.3.4',
      buildNumber: 10,
      releaseDate: '2026-09-03',
      changes: [
        'Las cuentas de demostracion se pueden programar para que dejen de funcionar en una fecha, y se cierran solas al llegar',
        'Al bloquear una cuenta, la sesion que tuviera abierta se corta en el acto',
        'La invitacion a referidos vuelve a aparecer, ahora que las recompensas son reales',
      ],
    },
    {
      version: '2.3.3',
      buildNumber: 9,
      releaseDate: '2026-09-02',
      changes: [
        'Icono y marca nuevos, en la aplicacion y en la pantalla de inicio del telefono',
        'El registro explica con claridad por que falla, en vez de un error generico',
        'Nueva pregunta frecuente sobre como se protege tu informacion',
      ],
    },
    {
      version: '2.3.2',
      buildNumber: 8,
      releaseDate: '2026-09-02',
      changes: [
        'Programa de referidos: comparte tu enlace y gana puntos por cada persona que se registre',
      ],
    },
    {
      version: '2.3.1',
      buildNumber: 7,
      releaseDate: '2026-09-01',
      changes: [
        'Grafico circular de gastos en la seccion de analisis',
        'Aviso claro al alcanzar el limite de intentos de ingreso',
      ],
    },
    {
      version: '2.3.0',
      buildNumber: 6,
      releaseDate: '2026-09-01',
      changes: [
        'La aplicacion se actualiza sola: avisa cuando hay una version nueva y se instala en un toque',
        'Los montos se muestran con separador de miles',
        'Avisos ocasionales dentro de la aplicacion con las novedades',
      ],
    },
    {
      version: '2.2.0',
      buildNumber: 5,
      releaseDate: '2026-09-01',
      changes: [
        'Ingreso con cedula, correo o telefono: el que prefieras',
        'Se acabaron los cierres de sesion inesperados mientras usabas la aplicacion',
        'Seccion de analisis rediseñada, con comparacion contra el periodo anterior',
        'Pantalla principal y graficos renovados',
        'Precios de cripto mas estables',
      ],
    },
    {
      version: '2.1.0',
      buildNumber: 4,
      releaseDate: '2026-08-31',
      changes: [
        'Codigo de verificacion por correo al registrarse',
        'Notificaciones en tiempo real, sin recargar la pantalla',
        'Al cerrar sesion, tus datos dejan de quedar guardados en el dispositivo',
      ],
    },
    {
      version: '2.0.0',
      buildNumber: 3,
      releaseDate: '2026-02-16',
      changes: [
        'Proteccion avanzada de cuenta: bloqueo automatico tras intentos fallidos',
        'Verificacion de sesion en tiempo real para mayor seguridad',
        'Registro de actividad para detectar accesos no autorizados',
        'Carga mas rapida: las pantallas se cargan bajo demanda',
        'Optimizacion de estilos para mejor rendimiento',
        'Notificaciones push para transferencias y alertas de precios',
        'Tasas de cambio actualizadas en tiempo real',
        'Precios crypto mas estables con proteccion ante fallos del proveedor',
        'Notificaciones personalizadas por usuario via WebSocket',
        'Deep links: abrir pagos y transferencias desde enlaces externos',
        'Autenticacion biometrica obligatoria en transacciones grandes',
        'Preparacion para Google Play Store',
        'Restructuracion de base de datos para mayor escalabilidad',
        'Sistema de respaldos automaticos diarios',
        'Mejoras de conexion a base de datos para multiples usuarios simultaneos',
      ],
    },
    {
      version: '1.1.0',
      buildNumber: 2,
      releaseDate: '2024-12-30',
      changes: [
        'Sistema de autenticacion con cedula y PIN',
        'Soporte para biometria (huella/Face ID)',
        'Persistencia local de datos',
        'Vista de notificaciones funcional',
        'Seccion de preguntas frecuentes',
        'Agregar contactos SINPE con banco',
        'Botones de copiar y compartir funcionales',
        'Historial de pagos de servicios y recargas',
        'Sistema de versionado con changelog',
        'Confirmacion PIN para cambios de seguridad',
      ],
    },
    {
      version: '1.0.0',
      buildNumber: 1,
      releaseDate: '2024-12-28',
      changes: [
        'Version inicial de KiramoPay',
        'Pantalla principal con balance',
        'SINPE Movil: enviar y recibir dinero',
        'Pago de servicios (ICE, AyA, CNFL)',
        'Recargas telefonicas (Kolbi, Claro, Movistar)',
        'Marketplace: Uber, DiDi, Uber Eats',
        'Perfil de usuario con configuraciones',
        'Modo oscuro',
        'Tarjetas virtuales',
      ],
    },
  ],
};

// Version formateada para la interfaz: sale del build, no del changelog.
export const getVersionString = (): string => `v${BUILD_VERSION} (${BUILD_SHA})`;

// Fecha del build en formato legible, para la pantalla "Acerca de".
export const getBuildDate = (locale = 'es-CR'): string => {
  const d = new Date(BUILD_DATE);
  return Number.isNaN(d.getTime())
    ? BUILD_DATE
    : d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Helper para obtener todas las versiones (actual + historial)
export const getAllVersions = (): VersionInfo[] => {
  return [APP_VERSION.current, ...APP_VERSION.history];
};

// Las notas de cada version en los demas idiomas, por version y por idioma, en
// el mismo orden que el changelog de arriba (notasTraducidas.json).
export type NotasTraducidas = Record<string, Partial<Record<Language, string[]>>>;

// El archivo pesa unos 90 KB y lo lee quien abre "Acerca de" en un idioma que no
// es el espanol, no quien arranca la app: se pide con import() para que viaje en
// su propio chunk y no en el principal (el CI limita cada chunk a 200 KB). Por
// eso version.ts NO lo importa de forma estatica; hay una prueba que lo vigila.
export const cargarNotasTraducidas = async (): Promise<NotasTraducidas> =>
  (await import('./notasTraducidas.json')).default as NotasTraducidas;

// Los cambios de una version en el idioma de la persona. Si falta la traduccion
// (todavia no se cargo, o la version no la tiene), o tiene otro numero de cambios
// (los textos se correrian), sale el espanol: mejor eso que una lista vacia o
// mezclada.
export const cambiosEn = (version: VersionInfo, idioma: Language, traducidas: NotasTraducidas = {}): string[] => {
  if (idioma === 'es') return version.changes;
  const textos = traducidas[version.version]?.[idioma];
  return textos && textos.length === version.changes.length ? textos : version.changes;
};
