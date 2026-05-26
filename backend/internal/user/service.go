package user

import (
	"context"
	"fmt"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetProfile(ctx context.Context, userID string) (*UserRecord, error) {
	u, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}
	return u, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID string, req *UpdateProfileRequest) (*UserRecord, error) {
	if err := s.repo.UpdateProfile(ctx, userID, req); err != nil {
		return nil, fmt.Errorf("update profile: %w", err)
	}
	return s.repo.FindByID(ctx, userID)
}
