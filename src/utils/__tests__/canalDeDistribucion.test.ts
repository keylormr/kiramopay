import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCapacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: mockCapacitor }));

const {
  canalDeDistribucion,
  fichaDePlayValida,
  FICHA_DE_PLAY,
  MARCA_CANAL_PLAY,
  ID_DE_LA_APP,
  ACTUALIZACION_WEB_EN_PLAY,
} = await import('../canalDeDistribucion');

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36';

function conUserAgent(ua: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
}

describe('canalDeDistribucion', () => {
  beforeEach(() => {
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('android');
  });
  afterEach(() => vi.restoreAllMocks());

  it('un Android sin la marca es el APK: asi son todos los binarios ya instalados', () => {
    conUserAgent(UA_ANDROID);
    expect(canalDeDistribucion()).toBe('apk');
  });

  it('un Android con la marca del CI es el de Play', () => {
    conUserAgent(`${UA_ANDROID} ${MARCA_CANAL_PLAY}`);
    expect(canalDeDistribucion()).toBe('play');
  });

  it('la marca tiene que ser la palabra entera, no un pedazo de otro texto', () => {
    conUserAgent(`${UA_ANDROID} X${MARCA_CANAL_PLAY}`);
    expect(canalDeDistribucion()).toBe('apk');
    conUserAgent(`${UA_ANDROID} ${MARCA_CANAL_PLAY}2`);
    expect(canalDeDistribucion()).toBe('apk');
  });

  it('en web no hay canal: nada cambia aunque el texto aparezca', () => {
    mockCapacitor.isNativePlatform.mockReturnValue(false);
    mockCapacitor.getPlatform.mockReturnValue('web');
    conUserAgent(`${UA_ANDROID} ${MARCA_CANAL_PLAY}`);
    expect(canalDeDistribucion()).toBe('apk');
  });

  it('en iOS no hay canal de Play', () => {
    mockCapacitor.getPlatform.mockReturnValue('ios');
    conUserAgent(`${UA_ANDROID} ${MARCA_CANAL_PLAY}`);
    expect(canalDeDistribucion()).toBe('apk');
  });
});

// Encender la actualizacion interna en Play es una decision del titular, despues
// de consultar a Google (ver el comentario de la constante). Esta prueba existe
// para que no se encienda sin querer: si se cambia a proposito, se cambia aca.
describe('ACTUALIZACION_WEB_EN_PLAY', () => {
  it('viene apagada: la app de Play se actualiza solo por Play', () => {
    expect(ACTUALIZACION_WEB_EN_PLAY).toBe(false);
  });
});

describe('fichaDePlayValida', () => {
  it('acepta la ficha de esta app', () => {
    expect(fichaDePlayValida(FICHA_DE_PLAY)).toBe(FICHA_DE_PLAY);
    expect(FICHA_DE_PLAY).toBe(`https://play.google.com/store/apps/details?id=${ID_DE_LA_APP}`);
  });

  it('acepta la ficha con el idioma pedido', () => {
    const url = `${FICHA_DE_PLAY}&hl=es_419`;
    expect(fichaDePlayValida(url)).toBe(url);
  });

  it('rechaza el .apk de GitHub: una app de Play nunca debe abrirlo', () => {
    expect(fichaDePlayValida('https://github.com/keylormr/kiramopay/releases/latest/download/kiramopay.apk')).toBeNull();
  });

  it('rechaza la ficha de otra app, otro host y otros esquemas', () => {
    expect(fichaDePlayValida('https://play.google.com/store/apps/details?id=com.otra.app')).toBeNull();
    expect(fichaDePlayValida(`https://play.google.com.evil.example/store/apps/details?id=${ID_DE_LA_APP}`)).toBeNull();
    expect(fichaDePlayValida(`https://play.google.com@evil.example/store/apps/details?id=${ID_DE_LA_APP}`)).toBeNull();
    expect(fichaDePlayValida(`http://play.google.com/store/apps/details?id=${ID_DE_LA_APP}`)).toBeNull();
    expect(fichaDePlayValida(`market://details?id=${ID_DE_LA_APP}`)).toBeNull();
    expect(fichaDePlayValida(`https://play.google.com/store/apps/other?id=${ID_DE_LA_APP}`)).toBeNull();
  });

  it('rechaza lo que no es una URL', () => {
    expect(fichaDePlayValida('')).toBeNull();
    expect(fichaDePlayValida('no es una url')).toBeNull();
    expect(fichaDePlayValida(undefined)).toBeNull();
    expect(fichaDePlayValida(42)).toBeNull();
  });
});
