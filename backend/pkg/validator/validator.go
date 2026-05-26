package validator

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	cedulaRegex = regexp.MustCompile(`^\d{9,12}$`)
	phoneRegex  = regexp.MustCompile(`^\+506\d{8}$`)
	emailRegex  = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	pinRegex    = regexp.MustCompile(`^\d{4,6}$`)
)

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

type ValidationErrors []ValidationError

func (ve ValidationErrors) Error() string {
	msgs := make([]string, len(ve))
	for i, e := range ve {
		msgs[i] = e.Error()
	}
	return strings.Join(msgs, "; ")
}

func (ve ValidationErrors) HasErrors() bool {
	return len(ve) > 0
}

func ValidateCedula(cedula string) *ValidationError {
	cleaned := strings.ReplaceAll(cedula, "-", "")
	if !cedulaRegex.MatchString(cleaned) {
		return &ValidationError{Field: "cedula", Message: "cédula must be 9-12 digits"}
	}
	return nil
}

func ValidatePhone(phone string) *ValidationError {
	if !phoneRegex.MatchString(phone) {
		return &ValidationError{Field: "phone", Message: "phone must be in +506XXXXXXXX format"}
	}
	return nil
}

func ValidateEmail(email string) *ValidationError {
	if email == "" {
		return nil // optional
	}
	if !emailRegex.MatchString(email) {
		return &ValidationError{Field: "email", Message: "invalid email format"}
	}
	return nil
}

func ValidatePin(pin string) *ValidationError {
	if !pinRegex.MatchString(pin) {
		return &ValidationError{Field: "pin", Message: "PIN must be 4-6 digits"}
	}
	return nil
}

func ValidatePassword(password string) *ValidationError {
	if len(password) < 8 {
		return &ValidationError{Field: "password", Message: "password must be at least 8 characters"}
	}
	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, c := range password {
		switch {
		case 'A' <= c && c <= 'Z':
			hasUpper = true
		case 'a' <= c && c <= 'z':
			hasLower = true
		case '0' <= c && c <= '9':
			hasDigit = true
		default:
			hasSpecial = true
		}
	}
	if !hasUpper || !hasLower || !hasDigit || !hasSpecial {
		return &ValidationError{Field: "password", Message: "password must include uppercase, lowercase, digit, and special character"}
	}
	return nil
}

func ValidateRequired(field, value string) *ValidationError {
	if strings.TrimSpace(value) == "" {
		return &ValidationError{Field: field, Message: field + " is required"}
	}
	return nil
}
