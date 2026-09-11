// Fecha y hora de un plazo, en el idioma de la app.
//
// Los plazos del escrow deciden a quien se le paga, asi que la hora importa
// tanto como el dia: "hasta el 20/09" no dice si es a las 00:01 o a las 23:59.

const LOCALE: Record<string, string> = {
  es: 'es-CR',
  en: 'en-US',
  fr: 'fr-FR',
  pt: 'pt-BR',
  hi: 'hi-IN',
  ja: 'ja-JP',
  'zh-cn': 'zh-CN',
};

export function fechaYHora(iso: string | undefined, idioma: string): string {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(LOCALE[idioma] ?? 'es-CR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Si un plazo ya paso segun el reloj del dispositivo. Sin plazo, no vencio. */
export function plazoVencido(iso: string | undefined, ahora: number = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t <= ahora;
}
