import { render, screen } from '@testing-library/react';
import { TextoConCorreo } from '../TextoConCorreo';

// Los textos de la app que mandan a escribir a soporte llevan la direccion
// dentro de la frase ("Escribe a soporte@kiramopay.com."). El componente la
// vuelve un enlace mailto sin tocar el resto de la frase: asi la persona toca
// la direccion en vez de copiarla.
describe('TextoConCorreo', () => {
  it('convierte la direccion de soporte en un enlace mailto', () => {
    render(<p>Esta cuenta está bloqueada. <TextoConCorreo texto="Escribe a soporte@kiramopay.com." /></p>);

    const enlace = screen.getByRole('link', { name: 'soporte@kiramopay.com' });
    expect(enlace).toHaveAttribute('href', 'mailto:soporte@kiramopay.com');
  });

  it('conserva la frase completa, con el punto final fuera del enlace', () => {
    const { container } = render(<TextoConCorreo texto="Escribe a soporte@kiramopay.com. Gracias." />);

    expect(container.textContent).toBe('Escribe a soporte@kiramopay.com. Gracias.');
    expect(screen.getByRole('link').textContent).toBe('soporte@kiramopay.com');
  });

  it('sin la direccion, deja el texto tal cual y sin enlaces', () => {
    render(<TextoConCorreo texto="Intenta de nuevo en un minuto." />);

    expect(screen.getByText('Intenta de nuevo en un minuto.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('si la direccion aparece dos veces, las dos son enlaces', () => {
    render(<TextoConCorreo texto="soporte@kiramopay.com o, si prefieres, soporte@kiramopay.com" />);

    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('el enlace abre el correo sin dejar una pestana en blanco', () => {
    render(<TextoConCorreo texto="Escribe a soporte@kiramopay.com" />);

    // mailto no abre una pestana: nada de target="_blank".
    expect(screen.getByRole('link')).not.toHaveAttribute('target');
  });
});
