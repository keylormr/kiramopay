import fs from 'fs';
import path from 'path';
import { fireEvent, waitFor } from '@testing-library/react';

// La pagina publica /eliminar-cuenta (public/eliminar-cuenta). Con el codigo
// correcto la persona ya probo que el contacto es suyo, y la pagina le muestra
// la MISMA respuesta escrita que le llega por correo (Ley 8968): cuando se
// suprime, que se conserva por ley y hasta cuando, y la PRODHAB. Si algo lo
// impide, que resolver. Si la atiende una persona, nada sobre la cuenta.
// Se prueba el HTML y el script de verdad, con la red simulada.

const raiz = process.cwd();
const html = fs.readFileSync(path.join(raiz, 'public/eliminar-cuenta/index.html'), 'utf-8');
const script = fs.readFileSync(path.join(raiz, 'public/eliminar-cuenta/app.js'), 'utf-8');

const fetchMock = vi.fn();

const responder = (estado: number, cuerpo: unknown) => ({ status: estado, json: async () => cuerpo });

function montar() {
  const cuerpo = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = cuerpo.replace(/<script[\s\S]*?<\/script>/gi, '');
  // El script es un IIFE que busca sus elementos por id.
  new Function(script)();
}

const porId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Pide el codigo, lo confirma y devuelve el paso final con lo que respondio la
// verificacion.
async function confirmar(verificacion: ReturnType<typeof responder>) {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/verify') ? verificacion : responder(202, { success: true, data: { status: 'received' } }),
  );
  montar();
  porId<HTMLInputElement>('contacto').value = 'maria@ejemplo.test';
  porId<HTMLInputElement>('acepto-plazo').checked = true;
  fireEvent.submit(porId('paso-contacto'));
  await waitFor(() => expect(porId('paso-codigo').hidden).toBe(false));
  porId<HTMLInputElement>('codigo').value = '123456';
  fireEvent.submit(porId('paso-codigo'));
  await waitFor(() => expect(porId('paso-listo').hidden).toBe(false));
  return porId('paso-listo').textContent ?? '';
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('Pagina /eliminar-cuenta — la respuesta escrita al confirmar', () => {
  it('con el plazo iniciado muestra la respuesta con sus fechas', async () => {
    const texto = await confirmar(
      responder(200, {
        success: true,
        data: {
          status: 'verified',
          outcome: 'scheduled',
          deletion_due_at: '2026-11-17T18:00:00Z',
          retained_until: '2031-11-17T18:00:00Z',
        },
      }),
    );
    expect(texto).toContain('17 de noviembre de 2026');
    expect(texto).toContain('17 de noviembre de 2031');
    expect(texto).toMatch(/Ley 7786/);
    expect(texto).toMatch(/PRODHAB/);
    expect(texto).toMatch(/reactivar/);
    expect(texto).toMatch(/correo/);
    expect(texto).not.toMatch(/\bUIF\b|\bROS\b|sospechos|diez años|10 años/i);
  });

  it('si algo impide empezar, dice que resolver y que no se borro nada', async () => {
    const texto = await confirmar(
      responder(200, {
        success: true,
        data: { status: 'verified', outcome: 'blocked', blockers: ['BALANCE_POSITIVE', 'ESCROW_OPEN'] },
      }),
    );
    expect(texto).toMatch(/Tienes saldo en tu billetera/);
    expect(texto).toMatch(/acuerdo de garantía abierto/);
    expect(texto).toMatch(/No se borró nada/);
    expect(texto).not.toContain('2031');
  });

  it('si la atiende una persona, no dice nada sobre la cuenta', async () => {
    const texto = await confirmar(
      responder(200, { success: true, data: { status: 'verified', outcome: 'received', respond_by: '2026-10-27T18:00:00Z' } }),
    );
    expect(texto).toMatch(/una persona del equipo/);
    // El plazo legal, contado desde que se verifico el codigo.
    expect(texto).toContain('27 de octubre de 2026');
    expect(texto).not.toMatch(/saldo|2031|se suprimen/);
  });

  it('una cuenta que no se elimina por esta via lo dice y lleva al correo de soporte', async () => {
    const texto = await confirmar(responder(200, { success: true, data: { status: 'verified', outcome: 'rejected' } }));
    expect(texto).toMatch(/no se puede eliminar desde esta página/);
    const enlace = porId('paso-listo').querySelector('a[href="mailto:soporte@kiramopay.com"]');
    expect(enlace).not.toBeNull();
    expect(enlace?.textContent).toBe('soporte@kiramopay.com');
    // Ya no manda a buscar un "contacto de privacidad" que la politica no define.
    expect(porId('paso-listo').querySelector('a[href="/privacidad/#contacto"]')).toBeNull();
    // Tambien es una respuesta escrita: no se borro nada, y el derecho de acudir
    // a la PRODHAB. Sin el motivo.
    expect(texto).toMatch(/No se borró nada/);
    expect(texto).toMatch(/PRODHAB/);
    expect(texto).toMatch(/por escrito/);
    expect(texto).not.toMatch(/bloque|revisión|demostración|administrador/i);
    expect(texto).not.toMatch(/2031|se suprimen/);
  });
});
