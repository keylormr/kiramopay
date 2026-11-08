/** Sin tildes, en minusculas y con los espacios colapsados: para comparar. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}
