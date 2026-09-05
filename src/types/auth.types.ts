export interface User {
  id: string;
  cedula?: string;
  /** Nombre de usuario con el que se entra. Vacio en cuentas anteriores a el. */
  username?: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  avatar?: string;
  kycLevel: 0 | 1 | 2;
  createdAt: string;
  /** Código de invitación propio (programa de referidos). Lo asigna el backend. */
  referralCode?: string;
}
