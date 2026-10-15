package analytics

import (
	"context"
	"log/slog"
)

type Service struct {
	repo   Repository
	logger *slog.Logger
}

func NewService(repo Repository, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		repo:   repo,
		logger: logger,
	}
}

func (s *Service) GetPlatformSummary(ctx context.Context) (*AnalyticsSummaryResponse, error) {
	return s.repo.GetAnalyticsSummary(ctx)
}
