export interface User {
  id: string;
  cedula?: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  avatar?: string;
  kycLevel: 0 | 1 | 2;
  createdAt: string;
}
