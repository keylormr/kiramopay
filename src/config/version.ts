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
    version: '2.3.5',
    buildNumber: 11,
    releaseDate: '2026-09-03',
    changes: [
      'La pantalla "Acerca de" muestra la version que de verdad tienes instalada, y el historial de cambios vuelve a estar al dia',
      'Apagar la verificacion en dos pasos queda registrado en el historial de seguridad de tu cuenta',
    ],
  },
  history: [
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
