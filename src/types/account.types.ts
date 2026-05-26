export interface Account {
  ccy: string;
  balance: number;
  symbol: string;
  flag: string;
  iban: string;
  name: string;
  type: 'fiat' | 'crypto';
  rateToUsd?: number;
}

export interface Budget {
  id: string;
  label: string;
  spent: number;
  limit: number;
  ccy: string;
  icon?: string;     // lucide icon name
  color?: string;    // hex color for the category
}
