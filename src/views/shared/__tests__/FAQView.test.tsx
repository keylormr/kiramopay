import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { FAQView } from '../FAQView';

function setup() {
  return render(
    <LanguageProvider>
      <FAQView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('Centro de ayuda', () => {
  // El defecto que arregla esta pantalla: el "?" solo lo ve quien ya llego a la
  // funcion. Aca tienen que estar TODOS los temas a la vista, sin buscar nada.
  it('muestra los temas de las funciones sin filtrar', () => {
    setup();

    expect(screen.getByText('Tarjetas')).toBeInTheDocument();
    expect(screen.getByText('Viajes y comida')).toBeInTheDocument();
    expect(screen.getByText('Retiros a cuentas externas')).toBeInTheDocument();
    expect(screen.getByText('¿Qué es KiramoPay?')).toBeInTheDocument();
  });

  it('abre la explicación al tocar un tema', async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.queryByText(/el número es simulado/)).not.toBeInTheDocument();
    await user.click(screen.getByText('Tarjetas'));

    expect(await screen.findByText(/el número es simulado/)).toBeInTheDocument();
  });

  // Buscar tiene que atravesar las categorias: si escribis "staking" no deberias
  // tener que adivinar primero en que pestaña vive.
  it('encuentra un tema aunque la categoría activa sea otra', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'General' }));
    expect(screen.queryByText(/Staking/)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Buscar en la ayuda...'), 'staking');

    expect(await screen.findByText(/Staking/)).toBeInTheDocument();
  });

  it('avisa cuando la búsqueda no encuentra nada', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('Buscar en la ayuda...'), 'zzzzz');

    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
  });

  // La lista vieja estaba escrita a mano y prometia cosas que el producto no
  // cumple. Estas afirmaciones se fijan aqui para que nadie las reponga.
  it('no promete lo que la app todavía no hace', async () => {
    const user = userEvent.setup();
    setup();

    // Ni chat 24/7 ni telefono de soporte: el unico canal real es el asistente.
    expect(screen.queryByText(/24\/7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/800-KIRAMO/)).not.toBeInTheDocument();
    expect(screen.getByText(/chat en vivo llegará pronto/)).toBeInTheDocument();

    // Y los envios a numeros sin cuenta se rechazan; no cuestan ₡150.
    await user.click(screen.getByText('¿Cuánto cuesta enviar por SINPE Móvil?'));
    expect(await screen.findByText(/el envío se rechaza/)).toBeInTheDocument();
  });

  // La entrada de proteccion de datos vive en Seguridad y solo afirma lo que
  // el sistema hace de verdad: cedula, telefono y correo cifrados en reposo,
  // contrasena guardada como hash, sesion en cookie que los scripts no leen.
  it('explica cómo se protege la información dentro de Seguridad', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /seguridad/i }));
    expect(screen.getByText('¿Cómo se protege mi información?')).toBeInTheDocument();
    expect(screen.queryByText('¿Qué es KiramoPay?')).not.toBeInTheDocument();

    await user.click(screen.getByText('¿Cómo se protege mi información?'));
    expect(await screen.findByText(/Tu contraseña nunca se guarda/)).toBeInTheDocument();
    expect(screen.getByText(/Ningún sistema es infalible/)).toBeInTheDocument();
  });

  it('se traduce con el idioma de la app', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    setup();

    expect(await screen.findByText('What is KiramoPay?')).toBeInTheDocument();
    expect(screen.getByText('Cards')).toBeInTheDocument();
  });
});
