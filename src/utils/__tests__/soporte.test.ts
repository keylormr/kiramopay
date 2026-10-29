import { CORREO_SOPORTE, ENLACE_SOPORTE } from '../soporte';

// El correo de soporte lo definio el dueno. Es el unico canal de contacto con
// una persona: el chat en vivo no existe. Toda la app (ayuda, bloqueo de
// cuenta, errores) lo toma de aqui para que no haya dos direcciones distintas.
describe('correo de soporte', () => {
  it('es soporte@kiramopay.com', () => {
    expect(CORREO_SOPORTE).toBe('soporte@kiramopay.com');
  });

  it('el enlace abre el programa de correo con esa direccion y nada mas', () => {
    expect(ENLACE_SOPORTE).toBe('mailto:soporte@kiramopay.com');
  });
});
