import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zh from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';

// Textos que prometian lo que la app no hace, o que no decian lo que la
// persona necesita saber. Se prueban en los siete idiomas: un texto honesto en
// espanol y el viejo en los otros seis es el mismo defecto.

type Diccionario = Record<string, string | undefined>;

const idiomas: Array<[string, Diccionario]> = [
  ['es', es as unknown as Diccionario],
  ['en', en as unknown as Diccionario],
  ['fr', fr as unknown as Diccionario],
  ['pt', pt as unknown as Diccionario],
  ['zh-cn', zh as unknown as Diccionario],
  ['ja', ja as unknown as Diccionario],
  ['hi', hi as unknown as Diccionario],
];

// Una frase que el texto nuevo tiene que contener, por idioma.
function conLaFrase(clave: string, frases: Record<string, string>) {
  describe(clave, () => {
    it.each(idiomas)('%s', (idioma, d) => {
      expect(d[clave], `${clave} en ${idioma}`).toContain(frases[idioma]);
    });
  });
}

describe('tarjeta: sin cajeros ni retiros', () => {
  const CAJERO = /ATM|cajero|distributeur|caixa|取款|提款|引き出し|एटीएम|निकासी/i;

  it.each(idiomas)('%s: la descripcion de los limites no menciona cajeros', (_idioma, d) => {
    expect(d.card_limits_desc?.trim()).toBeTruthy();
    expect(d.card_limits_desc).not.toMatch(CAJERO);
  });

  it.each(idiomas)('%s: ya no existe el rotulo del limite de cajero', (_idioma, d) => {
    expect(d.card_atm_limit).toBeUndefined();
  });
});

describe('Agregar dinero: dice como entra dinero hoy', () => {
  conLaFrase('add_money_bank_soon', {
    es: 'SINPE', en: 'SINPE', fr: 'SINPE', pt: 'SINPE', 'zh-cn': 'SINPE', ja: 'SINPE', hi: 'SINPE',
  });

  it.each(idiomas)('%s: tiene titulo y explicacion', (_idioma, d) => {
    expect(d.add_money_today_title?.trim()).toBeTruthy();
    expect(d.add_money_today_desc?.trim()).toBeTruthy();
    expect(d.add_money_bank_soon?.trim()).toBeTruthy();
  });
});

describe('Limites del perfil: sin boton que no hace nada', () => {
  it.each(idiomas)('%s: ya no existe el rotulo "solicitar aumento"', (_idioma, d) => {
    expect(d.request_increase).toBeUndefined();
  });

  conLaFrase('limits_kyc_hint', {
    es: 'verificación avanzada', en: 'advanced verification', fr: 'vérification avancée',
    pt: 'verificação avançada', 'zh-cn': '高级验证', ja: '高度な本人確認', hi: 'उन्नत सत्यापन',
  });

  it.each(idiomas)('%s: dice que todavia no esta disponible', (idioma, d) => {
    const marca: Record<string, string> = {
      es: 'todavía no está disponible', en: 'not available yet', fr: "pas encore disponible",
      pt: 'ainda não está disponível', 'zh-cn': '尚不可用', ja: 'まだ利用できません', hi: 'अभी उपलब्ध नहीं',
    };
    expect(d.limits_kyc_hint).toContain(marca[idioma]);
  });
});

describe('Retiros a otros bancos: lenguaje simple', () => {
  conLaFrase('payout_no_rails', {
    es: 'todavía no está disponible', en: 'not available yet', fr: 'pas encore disponible',
    pt: 'ainda não está disponível', 'zh-cn': '尚不可用', ja: 'まだ利用できません', hi: 'अभी उपलब्ध नहीं',
  });

  it.each(idiomas)('%s: no habla de rieles', (_idioma, d) => {
    expect(d.payout_no_rails).not.toMatch(/rail|riel|rieles|轨道/i);
  });
});

describe('Centro de ayuda, viajes y comida: dice lo que pasa en produccion', () => {
  // En produccion el servidor rechaza el cobro (SIN_INTEGRACION) y no debita.
  conLaFrase('help_marketplace_body', {
    es: 'no te cobra nada',
    en: 'does not charge you anything',
    fr: 'ne vous débite rien',
    pt: 'não cobra nada',
    'zh-cn': '不会扣你任何款项',
    ja: '料金は一切請求されません',
    hi: 'आपसे कुछ नहीं काटता',
  });

  it.each(idiomas)('%s: ya no dice que cobra de la billetera', (idioma, d) => {
    const promesa: Record<string, RegExp> = {
      es: /te cobra de la billetera|cobro es real/i,
      en: /charges your wallet|charge is real/i,
      fr: /débite votre portefeuille|débit est réel/i,
      pt: /cobra da carteira|cobrança é real/i,
      'zh-cn': /从钱包扣款|扣款是真实的/,
      ja: /ウォレットから請求|請求は実際/,
      hi: /वॉलेट से पैसे काट|कटौती असली/,
    };
    expect(d.help_marketplace_body).not.toMatch(promesa[idioma]);
  });
});

describe('Dividir cuenta, detalle: estado del grupo y cancelacion', () => {
  it.each(idiomas)('%s: tiene los tres estados del grupo y los avisos', (_idioma, d) => {
    for (const clave of [
      'splitpay_detail_state_active',
      'splitpay_detail_state_settled',
      'splitpay_detail_state_cancelled',
      'splitpay_detail_cancelled_note',
      'splitpay_share_not_charged',
      'splitpay_cancel_blocked_paid',
    ]) {
      expect(d[clave]?.trim(), clave).toBeTruthy();
    }
  });

  // Una division donde alguien ya pago no se cancela (decision del dueno): el
  // texto dice el motivo, en lugar de ofrecer el boton.
  conLaFrase('splitpay_cancel_blocked_paid', {
    es: 'ya pagó su parte',
    en: 'already paid their share',
    fr: 'déjà payé sa part',
    pt: 'já pagou a sua parte',
    'zh-cn': '已经有人付了',
    ja: 'すでに支払った人がいる',
    hi: 'पहले ही चुका दिया',
  });

  // El aviso viejo prometia lo contrario: que cancelar era posible y que lo
  // pagado se quedaba con quien creo la division.
  it.each(idiomas)('%s: ya no existe el aviso de cancelar con pagos hechos', (_idioma, d) => {
    expect(d.splitpay_cancel_paid_warning).toBeUndefined();
  });

  // La ayuda tampoco puede prometer que el creador cancela siempre.
  conLaFrase('help_splitpay_body', {
    es: 'mientras nadie haya pagado su parte',
    en: 'as long as nobody has paid their share',
    fr: "tant que personne n'a payé sa part",
    pt: 'enquanto ninguém tiver pago a sua parte',
    'zh-cn': '只要还没有人付款',
    ja: 'まだ誰も支払っていない間',
    hi: 'जब तक किसी ने अपना हिस्सा न चुकाया हो',
  });
});

describe('Pagos protegidos: fecha de creacion y moneda del monto', () => {
  it.each(idiomas)('%s: tiene el rotulo de la fecha y la moneda', (_idioma, d) => {
    expect(d.escrow_date_created?.trim()).toBeTruthy();
    expect(d.escrow_amount_hint?.trim()).toBeTruthy();
  });

  it.each(idiomas)('%s: la moneda del monto se nombra', (_idioma, d) => {
    expect(d.escrow_amount_hint).toContain('CRC');
  });
});

describe('Detalle de un movimiento: tipo, contraparte y nota', () => {
  it.each(idiomas)('%s: tiene los rotulos', (_idioma, d) => {
    for (const clave of [
      'transaction_type', 'transaction_to', 'transaction_note',
      'tx_title_merchant_withdrawal', 'tx_title_refund',
    ]) {
      expect(d[clave]?.trim(), clave).toBeTruthy();
    }
  });
});

describe('Tarjetas: motivos del rechazo al crear', () => {
  it.each(idiomas)('%s: tiene texto para crear y para el nombre que falta', (_idioma, d) => {
    expect(d.card_err_create?.trim()).toBeTruthy();
    expect(d.card_err_no_name?.trim()).toBeTruthy();
  });
});
