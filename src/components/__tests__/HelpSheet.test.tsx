import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HelpButton } from '../HelpSheet';

function setup(topic: string, extra?: React.ReactNode) {
  return render(
    <LanguageProvider>
      {extra}
      <HelpButton topic={topic} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('HelpButton', () => {
  it('abre la hoja con el título y el cuerpo del tema', async () => {
    const user = userEvent.setup();
    setup('payout');

    // Cerrada al principio: la ayuda no debe estorbar.
    expect(screen.queryByText('Retiros a cuentas externas')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('¿Qué es esto?'));

    expect(await screen.findByText('Retiros a cuentas externas')).toBeInTheDocument();
    expect(screen.getByText(/no hay ningún riel habilitado/)).toBeInTheDocument();
  });

  it('resuelve un tema distinto a partir del mismo componente', async () => {
    const user = userEvent.setup();
    setup('kyc');

    await user.click(screen.getByLabelText('¿Qué es esto?'));

    expect(await screen.findByText('Validación de cédula (nivel 1)')).toBeInTheDocument();
  });

  // La ayuda vive dentro de filas y tarjetas que ya son pulsables. Sin frenar la
  // propagación, pedir ayuda dispararía además la acción de la fila — por
  // ejemplo abrir un retiro en vez de explicarlo.
  it('no dispara la acción del contenedor que la rodea', async () => {
    const user = userEvent.setup();
    const alContenedor = vi.fn();

    render(
      <LanguageProvider>
        <div onClick={alContenedor}>
          <HelpButton topic="mfa" />
        </div>
      </LanguageProvider>,
    );

    await user.click(screen.getByLabelText('¿Qué es esto?'));

    expect(await screen.findByText('Verificación en dos pasos')).toBeInTheDocument();
    expect(alContenedor).not.toHaveBeenCalled();
  });

  // El contenido describe lo que la app hace HOY, incluidas las partes que aún
  // no funcionan. Si alguien las "mejora" quitando las advertencias, la ayuda
  // pasa a prometer cosas que el producto no cumple.
  it('mantiene las advertencias de lo que todavía no funciona', async () => {
    const user = userEvent.setup();
    setup('staking');

    await user.click(screen.getByLabelText('¿Qué es esto?'));

    expect(await screen.findByText(/el rendimiento todavía NO se acredita/i)).toBeInTheDocument();
  });
});
