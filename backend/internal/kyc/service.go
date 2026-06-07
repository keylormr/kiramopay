package kyc

import (
	"context"
	"fmt"

	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	repo        *Repository
	auditLogger *audit.Logger
}

type Options struct {
	AuditLogger *audit.Logger
}

func NewService(repo *Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{repo: repo, auditLogger: opts.AuditLogger}
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
