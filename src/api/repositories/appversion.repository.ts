import type { ApiResponse } from '../types';

// Ultima version publicada (la sirve el backend desde el release de GitHub).
export interface VersionApp {
  version: string;
  url: string;
  /**
   * Lo que trae la version, del notas.json del release. Un backend anterior a
   * la 2.8.0 no lo manda.
   */
  notes?: string[];
  /**
   * Las mismas novedades en los demas idiomas de la app, por codigo (en, fr, pt,
   * zh-cn, ja, hi). Un backend anterior no lo manda; un idioma que falta se lee
   * en espanol (`notes`).
   */
  notes_i18n?: Record<string, string[]>;
  /**
   * La capa web de esta version para actualizar por dentro, sin otro APK: el
   * manifiesto firmado (base64), su firma y la URL del .zip. Solo si el release
   * lo trae para la plataforma que pregunta; la app verifica la firma antes de
   * usarlo (utils/paqueteFirmado).
   */
  web?: PaqueteWeb;
}

export interface PaqueteWeb {
  manifest: string;
  signature: string;
  url: string;
}

// Las dos plataformas comparten la version pero no la URL: Android baja el .apk
// y el sistema lo instala encima, iOS no puede instalar un binario bajado de un
// link y hay que mandarlo a su canal (TestFlight, App Store o un manifiesto
// OTA). Por eso la consulta lleva plataforma.
export type PlataformaApp = 'android' | 'ios';

export interface IAppVersionRepository {
  /** Sin plataforma el backend asume android, por los APK ya instalados. */
  getLatest(plataforma?: PlataformaApp): Promise<ApiResponse<VersionApp>>;
}
