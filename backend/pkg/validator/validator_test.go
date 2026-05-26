package validator

import "testing"

func TestValidateCedula(t *testing.T) {
	tests := []struct {
		cedula string
		valid  bool
	}{
		{"702650930", true},
		{"700000000", true},
		{"1-2345-6789", true}, // dashes stripped
		{"123", false},        // too short
		{"abc", false},        // not digits
		{"", false},           // empty
	}

	for _, tt := range tests {
		err := ValidateCedula(tt.cedula)
		if tt.valid && err != nil {
			t.Errorf("ValidateCedula(%q) should be valid, got error: %v", tt.cedula, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("ValidateCedula(%q) should be invalid", tt.cedula)
		}
	}
}

func TestValidatePhone(t *testing.T) {
	tests := []struct {
		phone string
		valid bool
	}{
		{"+50688880000", true},
		{"+50612345678", true},
		{"88880000", false},     // no country code
		{"+1234567890", false},  // wrong country
		{"", false},
	}

	for _, tt := range tests {
		err := ValidatePhone(tt.phone)
		if tt.valid && err != nil {
			t.Errorf("ValidatePhone(%q) should be valid, got: %v", tt.phone, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("ValidatePhone(%q) should be invalid", tt.phone)
		}
	}
}

func TestValidatePin(t *testing.T) {
	tests := []struct {
		pin   string
		valid bool
	}{
		{"1234", true},
		{"123456", true},
		{"123", false},       // too short
		{"1234567", false},   // too long
		{"abcd", false},      // not digits
		{"", false},
	}

	for _, tt := range tests {
		err := ValidatePin(tt.pin)
		if tt.valid && err != nil {
			t.Errorf("ValidatePin(%q) should be valid, got: %v", tt.pin, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("ValidatePin(%q) should be invalid", tt.pin)
		}
	}
}

func TestValidateEmail(t *testing.T) {
	tests := []struct {
		email string
		valid bool
	}{
		{"user@example.com", true},
		{"test@kiramopay.cr", true},
		{"", true},              // optional
		{"not-an-email", false},
		{"@example.com", false},
	}

	for _, tt := range tests {
		err := ValidateEmail(tt.email)
		if tt.valid && err != nil {
			t.Errorf("ValidateEmail(%q) should be valid, got: %v", tt.email, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("ValidateEmail(%q) should be invalid", tt.email)
		}
	}
}

func TestValidateRequired(t *testing.T) {
	if err := ValidateRequired("name", "John"); err != nil {
		t.Errorf("non-empty should be valid, got: %v", err)
	}
	if err := ValidateRequired("name", ""); err == nil {
		t.Error("empty should be invalid")
	}
	if err := ValidateRequired("name", "   "); err == nil {
		t.Error("whitespace-only should be invalid")
	}
}
