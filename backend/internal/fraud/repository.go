package fraud

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ── Risk Assessments ─────────────────────────────────────────────────────────

func (r *Repository) CreateAssessment(ctx context.Context, a *RiskAssessment) error {
	factorsJSON, _ := json.Marshal(a.Factors)
	_, err := r.db.Exec(ctx,
		`INSERT INTO fraud_assessments (id, user_id, tx_type, tx_id, amount, risk_score, risk_level, factors, action)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		a.ID, a.UserID, a.TxType, a.TxID, a.Amount, a.RiskScore, a.RiskLevel,
		string(factorsJSON), a.Action)
	return err
}

func (r *Repository) GetAssessment(ctx context.Context, assessmentID string) (*RiskAssessment, error) {
	var a RiskAssessment
	var factorsJSON string
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, tx_type, tx_id, amount, risk_score, risk_level, factors, action,
		 COALESCE(reviewed_by, ''), reviewed_at, created_at
		 FROM fraud_assessments WHERE id = $1`, assessmentID).Scan(
		&a.ID, &a.UserID, &a.TxType, &a.TxID, &a.Amount, &a.RiskScore, &a.RiskLevel,
		&factorsJSON, &a.Action, &a.ReviewedBy, &a.ReviewedAt, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(factorsJSON), &a.Factors)
	return &a, nil
}

func (r *Repository) ListUserAssessments(ctx context.Context, userID string, limit int) ([]RiskAssessment, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, tx_type, tx_id, amount, risk_score, risk_level, factors, action,
		 COALESCE(reviewed_by, ''), reviewed_at, created_at
		 FROM fraud_assessments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assessments []RiskAssessment
	for rows.Next() {
		var a RiskAssessment
		var factorsJSON string
		if err := rows.Scan(&a.ID, &a.UserID, &a.TxType, &a.TxID, &a.Amount,
			&a.RiskScore, &a.RiskLevel, &factorsJSON, &a.Action,
			&a.ReviewedBy, &a.ReviewedAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(factorsJSON), &a.Factors)
		assessments = append(assessments, a)
	}
	return assessments, nil
}

// ── Fraud Alerts ─────────────────────────────────────────────────────────────

func (r *Repository) CreateAlert(ctx context.Context, alert *FraudAlert) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO fraud_alerts (id, user_id, assessment_id, type, severity, message, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		alert.ID, alert.UserID, alert.AssessmentID, alert.Type, alert.Severity,
		alert.Message, alert.Status)
	return err
}

func (r *Repository) GetOpenAlerts(ctx context.Context) ([]FraudAlert, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, assessment_id, type, severity, message, status,
		 COALESCE(resolved_by, ''), resolved_at, created_at
		 FROM fraud_alerts WHERE status IN ('open', 'investigating')
		 ORDER BY CASE severity
		   WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4
		 END, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []FraudAlert
	for rows.Next() {
		var alert FraudAlert
		if err := rows.Scan(&alert.ID, &alert.UserID, &alert.AssessmentID, &alert.Type,
			&alert.Severity, &alert.Message, &alert.Status,
			&alert.ResolvedBy, &alert.ResolvedAt, &alert.CreatedAt); err != nil {
			return nil, err
		}
		alerts = append(alerts, alert)
	}
	return alerts, nil
}

func (r *Repository) ResolveAlert(ctx context.Context, alertID, resolvedBy, status string) error {
	result, err := r.db.Exec(ctx,
		`UPDATE fraud_alerts SET status = $2, resolved_by = $3, resolved_at = NOW()
		 WHERE id = $1`, alertID, status, resolvedBy)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("alert not found")
	}
	return nil
}

// ── User Risk Profile ────────────────────────────────────────────────────────

func (r *Repository) GetOrCreateProfile(ctx context.Context, userID string) (*UserRiskProfile, error) {
	var p UserRiskProfile
	err := r.db.QueryRow(ctx,
		`INSERT INTO user_risk_profiles (user_id) VALUES ($1)
		 ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
		 RETURNING id, user_id, overall_risk_score, total_transactions, total_flagged,
		 avg_tx_amount, max_tx_amount, last_activity_at, account_age_days, is_restricted, updated_at`,
		userID).Scan(&p.ID, &p.UserID, &p.OverallRiskScore, &p.TotalTransactions,
		&p.TotalFlagged, &p.AvgTxAmount, &p.MaxTxAmount, &p.LastActivityAt,
		&p.AccountAge, &p.IsRestricted, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) UpdateProfile(ctx context.Context, userID string, totalTx, flagged int64, avgAmount, maxAmount int64, score int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE user_risk_profiles SET
		 total_transactions = $2, total_flagged = $3, avg_tx_amount = $4,
		 max_tx_amount = $5, overall_risk_score = $6,
		 last_activity_at = NOW(), updated_at = NOW()
		 WHERE user_id = $1`,
		userID, totalTx, flagged, avgAmount, maxAmount, score)
	return err
}

func (r *Repository) RestrictUser(ctx context.Context, userID string, restricted bool) error {
	_, err := r.db.Exec(ctx,
		`UPDATE user_risk_profiles SET is_restricted = $2, updated_at = NOW() WHERE user_id = $1`,
		userID, restricted)
	return err
}

// ── Fraud Rules ──────────────────────────────────────────────────────────────

func (r *Repository) GetActiveRules(ctx context.Context) ([]FraudRule, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, name, description, category, condition, score_weight, active
		 FROM fraud_rules WHERE active = TRUE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []FraudRule
	for rows.Next() {
		var rule FraudRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Description, &rule.Category,
			&rule.Condition, &rule.ScoreWeight, &rule.Active); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

// ── Velocity Checks ──────────────────────────────────────────────────────────

func (r *Repository) CountRecentTransactions(ctx context.Context, userID string, minutes int) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM fraud_assessments
		 WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute' * $2`,
		userID, minutes).Scan(&count)
	return count, err
}

func (r *Repository) SumRecentAmounts(ctx context.Context, userID string, hours int) (int64, error) {
	var total int64
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM fraud_assessments
		 WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour' * $2`,
		userID, hours).Scan(&total)
	return total, err
}

// ── Seeding ──────────────────────────────────────────────────────────────────

func (r *Repository) SeedRules(ctx context.Context) error {
	rules := []struct {
		Name, Description, Category, Condition string
		ScoreWeight                            int
	}{
		{
			"High amount single transaction",
			"Transaction amount exceeds 500,000 CRC",
			"amount",
			`{"field":"amount","operator":"gt","value":50000000}`,
			30,
		},
		{
			"Velocity: 5+ transactions in 10 minutes",
			"More than 5 transactions within 10 minutes",
			"velocity",
			`{"field":"tx_count_10min","operator":"gt","value":5}`,
			40,
		},
		{
			"Volume: 2M+ CRC in 24 hours",
			"Total transaction volume exceeds 2,000,000 CRC in 24 hours",
			"velocity",
			`{"field":"volume_24h","operator":"gt","value":200000000}`,
			35,
		},
		{
			"New account high value",
			"High-value transaction from account less than 7 days old",
			"pattern",
			`{"field":"account_age_days","operator":"lt","value":7,"and":{"field":"amount","operator":"gt","value":10000000}}`,
			45,
		},
		{
			"Rapid successive transfers",
			"3+ transfers to different recipients in 5 minutes",
			"velocity",
			`{"field":"unique_recipients_5min","operator":"gt","value":3}`,
			50,
		},
	}

	for _, rule := range rules {
		_, err := r.db.Exec(ctx,
			`INSERT INTO fraud_rules (name, description, category, condition, score_weight)
			 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
			rule.Name, rule.Description, rule.Category, rule.Condition, rule.ScoreWeight)
		if err != nil {
			return err
		}
	}
	return nil
}
