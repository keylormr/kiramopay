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
  history: [
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
