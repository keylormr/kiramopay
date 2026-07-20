package kyc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	repo        *Repository
	auditLogger *audit.Logger
	hacienda    *HaciendaClient
}

type Options struct {
	AuditLogger *audit.Logger
	// Hacienda enables the automated N1 identity check. Nil-safe: when unset,
	// VerifyIdentity reports the service as unavailable rather than panicking.
	Hacienda *HaciendaClient
}

func NewService(repo *Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{repo: repo, auditLogger: opts.AuditLogger, hacienda: opts.Hacienda}
}

// IdentityResult is the outcome of an automated N1 identity check.
type IdentityResult struct {
	Status       string `json:"status"` // verified | mismatch | not_found
	VerifiedName string `json:"verified_name,omitempty"`
	IDType       string `json:"id_type,omitempty"`
	KYCLevel     int    `json:"kyc_level"`
}

// VerifyIdentity runs an automated N1 check: it looks up the user's OWN
// registered cedula against the Hacienda registry and, if the official name
// matches the account name, promotes the user to KYC level 1 (reusing the same
// ApplyApproval path admin approval uses, so wallet limits stay consistent).
// Fail-open on service unavailability (never a false negative from an outage).
// BusinessLookupResult is the slice of public tax-registry data used to
// prefill merchant sign-up: the registered name and the id type, nothing else.
type BusinessLookupResult struct {
	Name   string `json:"name"`
	IDType string `json:"id_type"`
}

// LookupBusinessCedula resolves a business cedula against the public tax
// registry so merchant sign-up can prefill the legal name (fewer typos, fewer
// rejections at review).
//
// Unlike VerifyIdentity — which only ever reads the caller's OWN cedula — this
// takes a cedula from the request, so it could be used to enumerate cedulas to
// names. The registry is public, but enumeration is not a use case we want to
// host: the route is authenticated, tightly rate limited per user, and every
// call is audited. It returns no PII beyond the registered name.
func (s *Service) LookupBusinessCedula(ctx context.Context, userID, cedula, ipAddr string) (*BusinessLookupResult, error) {
	if s.hacienda == nil {
		return nil, ErrIdentityUnavailable
	}
	res, err := s.hacienda.Lookup(ctx, cedula)
	if errors.Is(err, ErrIdentityNotFound) {
		s.audit(userID, "business_cedula_lookup_not_found", "", "low", ipAddr)
		return nil, ErrIdentityNotFound
	}
	if err != nil {
		return nil, ErrIdentityUnavailable
	}
	s.audit(userID, "business_cedula_lookup", "", "low", ipAddr)
	return &BusinessLookupResult{Name: res.Name, IDType: res.IDType}, nil
}

func (s *Service) VerifyIdentity(ctx context.Context, userID, ipAddr string) (*IdentityResult, error) {
	if s.hacienda == nil {
		return nil, ErrIdentityUnavailable
	}
	cedula, first, last, cedulaHash, err := s.repo.GetUserIdentity(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}
	level, _, _ := s.repo.GetUserKYC(ctx, userID)

	res, lerr := s.hacienda.Lookup(ctx, cedula)
	if errors.Is(lerr, ErrIdentityUnavailable) {
		return nil, ErrIdentityUnavailable
	}
	if errors.Is(lerr, ErrIdentityNotFound) {
		_ = s.repo.RecordIdentityVerification(ctx, userID, cedulaHash, "", "", "none", false)
		s.audit(userID, "kyc_identity_not_found", "", "medium", ipAddr)
		return &IdentityResult{Status: "not_found", KYCLevel: level}, nil
	}
	if lerr != nil {
		return nil, ErrIdentityUnavailable
	}

	matched := namesMatch(res.Name, first+" "+last)
	_ = s.repo.RecordIdentityVerification(ctx, userID, cedulaHash, res.Name, res.IDType, res.Source, matched)
	if !matched {
		s.audit(userID, "kyc_identity_mismatch", "", "medium", ipAddr)
		return &IdentityResult{Status: "mismatch", VerifiedName: res.Name, KYCLevel: level}, nil
	}

	if level < LevelVerified {
		if err := s.repo.ApplyApproval(ctx, userID, LevelVerified, "verified", LevelLimits[LevelVerified]); err != nil {
			return nil, fmt.Errorf("apply approval: %w", err)
		}
		level = LevelVerified
	}
	s.audit(userID, "kyc_identity_verified", "", "low", ipAddr)
	return &IdentityResult{Status: "verified", VerifiedName: res.Name, IDType: res.IDType, KYCLevel: level}, nil
}

// ── N2 (full identity verification) integration point ────────────────────────
//
// VerifyIdentity above is N1: an existence + name check against the public
// registry. It does NOT prove the person IS the cedula holder. Full identity
// verification (N2) requires a licensed provider that checks the id against the
// TSE with document capture + liveness (e.g. Didit ~$0.20/lookup, or Truora),
// complying with SUGEF Acuerdo 10-07 and Ley 8968 (PRODHAB).
//
// When a provider is contracted, add its verified-callback handler here: on a
// confirmed match, promote to level 2 through the SAME path the manual admin
// approval uses, so wallet limits stay consistent:
//
//	s.repo.ApplyApproval(ctx, userID, LevelComplete, "verified", LevelLimits[LevelComplete])
//	s.repo.RecordIdentityVerification(ctx, userID, cedulaHash, name, idType, "didit", true)
//
// Do NOT use the TSE electoral padron directly as a KYC source (finalidad
// electoral / PRODHAB risk) — go through the licensed provider.

// namesMatch reports whether the account name is contained in the official
// registry name (token subset, accent-folded). The registry name usually has
// two surnames plus given names, so we require every account token to appear
// (tolerating extra official tokens) rather than exact equality.
func namesMatch(official, account string) bool {
	o := identityTokens(official)
	a := identityTokens(account)
	if len(o) == 0 || len(a) == 0 {
		return false
	}
	oset := make(map[string]bool, len(o))
	for _, t := range o {
		oset[t] = true
	}
	matched := 0
	for _, t := range a {
		if oset[t] {
			matched++
		}
	}
	return matched == len(a)
}

func identityTokens(s string) []string {
	folded := strings.NewReplacer(
		"á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n",
		"Á", "a", "É", "e", "Í", "i", "Ó", "o", "Ú", "u", "Ü", "u", "Ñ", "n",
	).Replace(strings.ToLower(strings.TrimSpace(s)))
	return strings.Fields(folded)
}

var validDocTypes = map[string]bool{"national_id": true, "passport": true, "dimex": true}

// Submit records a KYC submission and screens the declared name against the
// sanction watchlist. A screening hit parks the verification in
// `screening_hit` (never auto-approved) and emits a high-risk audit event.
func (s *Service) Submit(ctx context.Context, userID string, req *SubmitRequest, ipAddr string) (*Verification, error) {
	if req.LevelRequested != LevelVerified && req.LevelRequested != LevelComplete {
		return nil, fmt.Errorf("level_requested must be 1 or 2")
	}
	if req.FullLegalName == "" {
		return nil, fmt.Errorf("full_legal_name is required")
	}
	if !validDocTypes[req.DocumentType] {
		return nil, fmt.Errorf("invalid document_type")
	}
	if req.DocumentNumber == "" {
		return nil, fmt.Errorf("document_number is required")
	}

	// Sanction screening.
	screen, err := s.screen(ctx, userID, nil, req.FullLegalName)
	if err != nil {
		return nil, fmt.Errorf("sanction screening: %w", err)
	}

	status := StatusPending
	if screen.Result == ScreenHit {
		status = StatusScreeningHit
	}

	v := &Verification{
		UserID:          userID,
		LevelRequested:  req.LevelRequested,
		Status:          status,
		FullLegalName:   req.FullLegalName,
		BirthDate:       req.BirthDate,
		Nationality:     req.Nationality,
		DocumentType:    req.DocumentType,
		DocumentNumber:  req.DocumentNumber,
		ScreeningResult: screen.Result,
	}
	if err := s.repo.CreateVerification(ctx, v); err != nil {
		return nil, fmt.Errorf("create verification: %w", err)
	}
	for _, d := range req.Documents {
		if d.DocType == "" || d.FileRef == "" {
			continue
		}
		if err := s.repo.AddDocument(ctx, v.ID, d); err != nil {
			return nil, fmt.Errorf("add document: %w", err)
		}
	}

	if screen.Result == ScreenHit && s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       userID,
			Action:       "kyc_sanction_hit",
			ResourceType: "kyc_verification",
			ResourceID:   v.ID,
			RiskLevel:    "high",
			IPAddress:    ipAddr,
		})
	}
	return v, nil
}

// Decide approves or rejects a pending verification. Approval bumps the user's
// KYC level and scales their wallet limits. A screening_hit can never be
// approved.
func (s *Service) Decide(ctx context.Context, verificationID, adminID string, req *DecisionRequest, ipAddr string) (*Verification, error) {
	v, err := s.repo.GetVerificationByID(ctx, verificationID)
	if err != nil {
		return nil, fmt.Errorf("verification not found")
	}
	if v.Status != StatusPending {
		return nil, fmt.Errorf("verification is not pending (status=%s)", v.Status)
	}

	if !req.Approve {
		if err := s.repo.UpdateDecision(ctx, v.ID, StatusRejected, adminID, req.Notes); err != nil {
			return nil, err
		}
		s.audit(adminID, "kyc_rejected", v.ID, "medium", ipAddr)
		v.Status = StatusRejected
		return v, nil
	}

	if v.ScreeningResult == ScreenHit {
		return nil, fmt.Errorf("cannot approve a verification with a sanction hit")
	}

	lim, ok := LevelLimits[v.LevelRequested]
	if !ok {
		return nil, fmt.Errorf("no limit profile for level %d", v.LevelRequested)
	}
	status := "verified"
	if v.LevelRequested >= LevelComplete {
		status = "complete"
	}
	if err := s.repo.ApplyApproval(ctx, v.UserID, v.LevelRequested, status, lim); err != nil {
		return nil, fmt.Errorf("apply approval: %w", err)
	}
	if err := s.repo.UpdateDecision(ctx, v.ID, StatusApproved, adminID, req.Notes); err != nil {
		return nil, err
	}
	s.audit(adminID, "kyc_approved", v.ID, "medium", ipAddr)
	v.Status = StatusApproved
	return v, nil
}

func (s *Service) GetStatus(ctx context.Context, userID string) (*StatusResponse, error) {
	level, status, err := s.repo.GetUserKYC(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("load kyc: %w", err)
	}
	lim, ok := LevelLimits[level]
	if !ok {
		lim = LevelLimits[LevelBasic]
	}
	latest, err := s.repo.GetLatestVerification(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &StatusResponse{KYCLevel: level, KYCStatus: status, Limits: lim, Latest: latest}, nil
}

// ScreenIsClear screens a name with no verification context. Used at
// registration to refuse onboarding of sanctioned individuals.
func (s *Service) ScreenIsClear(ctx context.Context, fullName string) (bool, error) {
	res, err := s.screen(ctx, "", nil, fullName)
	if err != nil {
		return false, err
	}
	return res.Result == ScreenClean, nil
}

// screen runs the watchlist match, records the screening, and returns the result.
func (s *Service) screen(ctx context.Context, userID string, verificationID *string, name string) (ScreenResult, error) {
	norm := normalizeName(name)
	matches, err := s.repo.ScreenSanctions(ctx, norm)
	if err != nil {
		_ = s.repo.RecordScreening(ctx, userID, verificationID, name, norm, ScreenError, nil)
		return ScreenResult{Result: ScreenError}, err
	}
	result := ScreenClean
	ids := make([]string, 0, len(matches))
	if len(matches) > 0 {
		result = ScreenHit
		for _, m := range matches {
			ids = append(ids, m.ID)
		}
	}
	if err := s.repo.RecordScreening(ctx, userID, verificationID, name, norm, result, ids); err != nil {
		return ScreenResult{Result: result, Matches: matches}, fmt.Errorf("record screening: %w", err)
	}
	return ScreenResult{Result: result, Matches: matches}, nil
}

func (s *Service) audit(userID, action, resourceID, risk, ip string) {
	if s.auditLogger == nil {
		return
	}
	s.auditLogger.Log(audit.Event{
		UserID:       userID,
		Action:       action,
		ResourceType: "kyc_verification",
		ResourceID:   resourceID,
		RiskLevel:    risk,
		IPAddress:    ip,
	})
}
