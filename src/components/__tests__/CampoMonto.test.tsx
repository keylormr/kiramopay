import { useState, type ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampoMonto } from '../CampoMonto';

/**
 * Envoltorio controlado, igual a como lo usa cada pantalla real: `value` solo
 * fija el estado INICIAL (numero limpio, sin comas) — de ahi en mas manda el
 * estado interno, como en cualquier input controlado de verdad.
 */
function Controlado({
  value: initialValue,
  onChange,
  ...rest
}: Partial<ComponentProps<typeof CampoMonto>> = {}) {
  const [value, setValue] = useState(initialValue ?? '');
  return (
    <CampoMonto
      aria-label="monto"
      {...rest}
      value={value}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
    />
  );
}

describe('CampoMonto', () => {
  it('es type="text", nunca type="number" (sin flechas de spinner)', () => {
    render(<Controlado />);
    const input = screen.getByLabelText('monto');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'decimal');
  });

  it('agrupa miles mientras se escribe', async () => {
    const user = userEvent.setup();
    render(<Controlado />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.type(input, '252200');

    expect(input.value).toBe('252,200');
  });

  it('entrega a la pantalla el numero limpio, sin comas', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.type(input, '252200');

    expect(onChange).toHaveBeenLastCalledWith('252200');
  });

  it('acepta decimales hasta el maximo configurado', async () => {
    const user = userEvent.setup();
    render(<Controlado decimals={2} />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.type(input, '10.999');

    // El tercer decimal se descarta: nunca llega a mostrarse ni a guardarse.
    expect(input.value).toBe('10.99');
  });

  it('sin type="number" acepta mas decimales para cantidades cripto y no agrupa miles', async () => {
    const user = userEvent.setup();
    render(<Controlado decimals={8} thousands={false} />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.type(input, '1234.12345678');

    expect(input.value).toBe('1234.12345678');
  });

  it('borrar deja el campo vacio, no en 0', async () => {
    const user = userEvent.setup();
    render(<Controlado value="500" />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.clear(input);

    expect(input.value).toBe('');
  });

  it('rechaza letras y signos negativos', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.type(input, 'abc-500');

    expect(input.value).toBe('500');
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('-'));
  });

  it('pegar texto con simbolo de moneda y comas lo limpia a un numero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');

    await user.click(input);
    await user.paste('₡252,200.50');

    expect(input.value).toBe('252,200.50');
    expect(onChange).toHaveBeenLastCalledWith('252200.50');
  });

  it('el cursor queda despues del ultimo digito escrito, no al final del texto formateado', async () => {
    const user = userEvent.setup();
    // value es el numero LIMPIO ("25200"); el componente lo muestra como
    // "25,200".
    render(<Controlado value="25200" />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');
    expect(input.value).toBe('25,200');

    // Cursor justo despues del primer "2" (posicion 1) y se escribe un "9":
    // insertar ahi da "295200" limpio -> se muestra "295,200" con el cursor
    // tras el "9" insertado (posicion 2), no arrastrado al final del texto.
    await user.click(input);
    input.setSelectionRange(1, 1);
    await user.keyboard('9');

    expect(input.value).toBe('295,200');
    expect(input.selectionStart).toBe(2);
  });

  it('permite forzar un valor inicial ya limpio', () => {
    render(<Controlado value="1234567" />);
    const input = screen.getByLabelText<HTMLInputElement>('monto');
    expect(input.value).toBe('1,234,567');
  });
});
