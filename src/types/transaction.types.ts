export interface Transaction {
  id: string;
  title: string;
  amount: number;
  ccy: string;
  date: string;
  // Machine-readable timestamp (ISO 8601) used for date filtering / charts.
  // `date` above is a localized display string and is NOT reliably parseable.
  dateISO?: string;
  type: 'credit' | 'debit';
  category?: string;
  status?: 'completed' | 'pending';
  icon?: string;
  description?: string;
}
