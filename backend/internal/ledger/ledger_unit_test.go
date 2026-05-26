package ledger

import "testing"

func TestValidatePosting(t *testing.T) {
	tests := []struct {
		name    string
		p       *Posting
		wantErr bool
	}{
		{
			name:    "nil",
			p:       nil,
			wantErr: true,
		},
		{
			name: "no description",
			p: &Posting{
				Entries: []Entry{
					{Account: Account{UserID: "a"}, Side: Debit, AmountMinor: 1, Currency: "CRC"},
					{Account: Account{UserID: "b"}, Side: Credit, AmountMinor: 1, Currency: "CRC"},
				},
			},
			wantErr: true,
		},
		{
			name: "single entry",
			p: &Posting{
				Description: "x",
				Entries: []Entry{
					{Account: Account{UserID: "a"}, Side: Debit, AmountMinor: 1, Currency: "CRC"},
				},
			},
			wantErr: true,
		},
		{
			name: "balanced 2 entries",
			p: &Posting{
				Description: "x",
				Entries: []Entry{
					{Account: Account{UserID: "a"}, Side: Debit, AmountMinor: 5, Currency: "CRC"},
					{Account: Account{UserID: "b"}, Side: Credit, AmountMinor: 5, Currency: "CRC"},
				},
			},
			wantErr: false,
		},
		{
			name: "unbalanced",
			p: &Posting{
				Description: "x",
				Entries: []Entry{
					{Account: Account{UserID: "a"}, Side: Debit, AmountMinor: 5, Currency: "CRC"},
					{Account: Account{UserID: "b"}, Side: Credit, AmountMinor: 4, Currency: "CRC"},
				},
			},
			wantErr: true,
		},
		{
			name: "balanced multi-currency",
			p: &Posting{
				Description: "x",
				Entries: []Entry{
					{Account: Account{UserID: "a"}, Side: Debit, AmountMinor: 5, Currency: "CRC"},
					{Account: Account{UserID: "b"}, Side: Credit, AmountMinor: 5, Currency: "CRC"},
					{Account: Account{UserID: "c"}, Side: Debit, AmountMinor: 1, Currency: "USD"},
					{Account: Account{UserID: "d"}, Side: Credit, AmountMinor: 1, Currency: "USD"},
				},
			},
			wantErr: false,
		},
		{
			name: "negative amount",
			p: &Posting{
				Description: "x",
				Entries: []Entry{
					{Account: Account{UserID: "a"}, Side: Debit, AmountMinor: -1, Currency: "CRC"},
					{Account: Account{UserID: "b"}, Side: Credit, AmountMinor: -1, Currency: "CRC"},
				},
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePosting(tt.p)
			if (err != nil) != tt.wantErr {
				t.Errorf("validatePosting() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
