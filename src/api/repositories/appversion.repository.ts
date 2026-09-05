import type { ApiResponse } from '../types';

// Ultima version publicada (la sirve el backend desde el release de GitHub).
export interface VersionApp {
  version: string;
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
