package splitpay

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/transaction"
)

type Service struct {
	repo *Repository
	tx   *transaction.Service
}

func NewService(repo *Repository, tx *transaction.Service) *Service {
	return &Service{repo: repo, tx: tx}
}

func (s *Service) CreateSplit(ctx context.Context, creatorID string, req *CreateSplitRequest) (*SplitGroup, []SplitShare, error) {
	if req.Title == "" {
		return nil, nil, fmt.Errorf("title is required")
	}
	if req.TotalAmount <= 0 {
		return nil, nil, fmt.Errorf("total amount must be positive")
	}
	if len(req.Participants) < 2 {
		return nil, nil, fmt.Errorf("at least 2 participants required")
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}

	group := &SplitGroup{
		ID:          uuid.New().String(),
		CreatorID:   creatorID,
		Title:       req.Title,
		Description: req.Description,
		TotalAmount: req.TotalAmount,
		Currency:    req.Currency,
		SplitType:   req.SplitType,
		Status:      "active",
	}

	if err := s.repo.CreateGroup(ctx, group); err != nil {
		return nil, nil, err
	}

	// Calculate shares based on split type
	shares, err := s.calculateShares(group.ID, req)
	if err != nil {
		return nil, nil, err
	}

	for _, share := range shares {
		if err := s.repo.CreateShare(ctx, &share); err != nil {
			return nil, nil, err
		}
	}

	return group, shares, nil
}

func (s *Service) GetSplit(ctx context.Context, groupID string) (*SplitGroup, []SplitShare, error) {
	group, err := s.repo.GetGroup(ctx, groupID)
	if err != nil {
		return nil, nil, fmt.Errorf("split group not found")
	}

	shares, err := s.repo.GetGroupShares(ctx, groupID)
	if err != nil {
		return nil, nil, err
	}

	return group, shares, nil
}

func (s *Service) ListUserSplits(ctx context.Context, userID string) ([]SplitGroup, error) {
	return s.repo.ListUserGroups(ctx, userID)
}

func (s *Service) PayShare(ctx context.Context, userID, groupID string) error {
	group, err := s.repo.GetGroup(ctx, groupID)
	if err != nil {
		return fmt.Errorf("split group not found")
	}
	if group.Status != "active" {
		return fmt.Errorf("split is no longer active")
	}

	// Locate this user's pending share.
	shares, err := s.repo.GetGroupShares(ctx, groupID)
	if err != nil {
		return err
	}
	var share *SplitShare
	for i := range shares {
		if shares[i].UserID == userID {
			share = &shares[i]
			break
		}
	}
	if share == nil {
		return fmt.Errorf("no share for this user in the split")
	}
	if share.Status == "paid" {
		return nil // idempotent: already settled
	}

	// Settle the money THROUGH THE LEDGER: the participant pays their share to
	// the split creator. The creator's own share moves no money. Only mark the
	// share paid AFTER the transfer succeeds.
	if userID != group.CreatorID && share.Amount > 0 {
		idem := fmt.Sprintf("split:%s:%s", groupID, userID)
		if _, _, err := s.tx.CreateTransfer(ctx, &transaction.CreateTransferRequest{
			FromUserID:     userID,
			ToUserID:       group.CreatorID,
			Amount:         share.Amount,
			Currency:       group.Currency,
			Fee:            0,
			Description:    "Split: " + group.Title,
			IdempotencyKey: idem,
			TxType:         transaction.TypeP2PSend,
			ReceiveType:    transaction.TypeP2PReceive,
		}); err != nil {
			return fmt.Errorf("settle split share: %w", err)
		}
	}

	if err := s.repo.PayShare(ctx, groupID, userID); err != nil {
		return err
	}

	// Check if all shares are paid → auto-settle
	pending, err := s.repo.CountPendingShares(ctx, groupID)
	if err != nil {
		return nil // non-critical
	}
	if pending == 0 {
		_ = s.repo.UpdateGroupStatus(ctx, groupID, "settled") // best-effort; reconciled later
	}

	return nil
}

func (s *Service) DeclineShare(ctx context.Context, userID, groupID string) error {
	return s.repo.DeclineShare(ctx, groupID, userID)
}

func (s *Service) CancelSplit(ctx context.Context, userID, groupID string) error {
	group, err := s.repo.GetGroup(ctx, groupID)
	if err != nil {
		return fmt.Errorf("split group not found")
	}
	if group.CreatorID != userID {
		return fmt.Errorf("only the creator can cancel a split")
	}
	return s.repo.UpdateGroupStatus(ctx, groupID, "cancelled")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func (s *Service) calculateShares(groupID string, req *CreateSplitRequest) ([]SplitShare, error) {
	var shares []SplitShare

	switch req.SplitType {
	case "equal":
		perPerson := req.TotalAmount / int64(len(req.Participants))
		remainder := req.TotalAmount - perPerson*int64(len(req.Participants))

		for i, p := range req.Participants {
			amount := perPerson
			if i == 0 {
				amount += remainder // first person gets remainder
			}
			shares = append(shares, SplitShare{
				ID:        uuid.New().String(),
				GroupID:   groupID,
				UserID:    p.UserID,
				UserPhone: p.UserPhone,
				UserName:  p.UserName,
				Amount:    amount,
				Status:    "pending",
			})
		}

	case "custom":
		var total int64
		for _, p := range req.Participants {
			total += p.Amount
		}
		if total != req.TotalAmount {
			return nil, fmt.Errorf("custom amounts (%d) don't match total (%d)", total, req.TotalAmount)
		}
		for _, p := range req.Participants {
			shares = append(shares, SplitShare{
				ID:        uuid.New().String(),
				GroupID:   groupID,
				UserID:    p.UserID,
				UserPhone: p.UserPhone,
				UserName:  p.UserName,
				Amount:    p.Amount,
				Status:    "pending",
			})
		}

	case "percentage":
		var totalPct float64
		for _, p := range req.Participants {
			totalPct += p.Percentage
		}
		if totalPct < 99.9 || totalPct > 100.1 {
			return nil, fmt.Errorf("percentages must sum to 100 (got %.1f)", totalPct)
		}
		for _, p := range req.Participants {
			amount := int64(float64(req.TotalAmount) * p.Percentage / 100)
			shares = append(shares, SplitShare{
				ID:        uuid.New().String(),
				GroupID:   groupID,
				UserID:    p.UserID,
				UserPhone: p.UserPhone,
				UserName:  p.UserName,
				Amount:    amount,
				Status:    "pending",
			})
		}

	default:
		return nil, fmt.Errorf("invalid split type: %s", req.SplitType)
	}

	return shares, nil
}
