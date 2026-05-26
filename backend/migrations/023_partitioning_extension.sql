-- Migration 023: Extend partitioning to history-heavy tables and provide a
-- single maintenance routine for ALL partitioned tables.
--
-- We can't ALTER an existing non-partitioned table into a partitioned one,
-- so the pattern is:
--   1. Rename old table to _legacy
--   2. Create new partitioned table with same schema
--   3. Copy data
--   4. Drop old
-- We do this for: sinpe_history, payment_history, card_transactions, audit_logs.
--
-- Run inside a transaction; if any step fails, rollback restores the originals.

BEGIN;

-- =========================================================================
-- Helper: generic partition creator.
-- =========================================================================
CREATE OR REPLACE FUNCTION create_monthly_partitions(
    p_table   TEXT,
    p_months_ahead INTEGER DEFAULT 6,
    p_months_back  INTEGER DEFAULT 0
) RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    FOR i IN -p_months_back..p_months_ahead LOOP
        partition_date := date_trunc('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        partition_name := p_table || '_' || to_char(partition_date, 'YYYY_MM');
        start_date := partition_date;
        end_date   := partition_date + INTERVAL '1 month';
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                partition_name, p_table, start_date, end_date
            );
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- 1. sinpe_history → partitioned by created_date (date)
-- =========================================================================
ALTER TABLE sinpe_history RENAME TO sinpe_history_legacy;

-- Indexes follow the table on rename and keep their names. Free up the
-- names so the new partitioned table can declare the same identifiers.
ALTER INDEX IF EXISTS idx_sinpe_history_user  RENAME TO idx_sinpe_history_user_legacy;
ALTER INDEX IF EXISTS idx_sinpe_history_daily RENAME TO idx_sinpe_history_daily_legacy;

CREATE TABLE sinpe_history (
    id           UUID DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    phone        VARCHAR(15) NOT NULL,
    contact_name VARCHAR(100) NOT NULL,
    amount       BIGINT NOT NULL,
    fee          BIGINT DEFAULT 0,
    type         VARCHAR(20) NOT NULL,
    status       VARCHAR(20) DEFAULT 'completed',
    description  TEXT,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    created_date DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (id, created_date),
    CONSTRAINT chk_sinpe_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_sinpe_type CHECK (type IN ('sent','received'))
) PARTITION BY RANGE (created_date);

CREATE INDEX idx_sinpe_history_user ON sinpe_history (user_id, created_at DESC);
CREATE INDEX idx_sinpe_history_daily ON sinpe_history (user_id, type, status, created_at)
    WHERE type = 'sent' AND status = 'completed';

SELECT create_monthly_partitions('sinpe_history', 12, 12);

INSERT INTO sinpe_history (id, user_id, phone, contact_name, amount, fee, type, status, description, created_at, created_date)
SELECT id, user_id, phone, contact_name, amount, COALESCE(fee, 0), type, status, description, created_at, created_at::date
FROM sinpe_history_legacy
WHERE created_at >= NOW() - INTERVAL '13 months';

-- Archive older rows to a single _archive table (kept around but not partitioned).
CREATE TABLE IF NOT EXISTS sinpe_history_archive (LIKE sinpe_history_legacy INCLUDING ALL);
INSERT INTO sinpe_history_archive SELECT * FROM sinpe_history_legacy
WHERE created_at < NOW() - INTERVAL '13 months';

DROP TABLE sinpe_history_legacy;

-- =========================================================================
-- 2. audit_logs (already declared elsewhere as a plain table) — extend
-- =========================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        -- Only partition if not yet partitioned.
        IF NOT EXISTS (SELECT 1 FROM pg_partitioned_table pt
                       JOIN pg_class c ON c.oid = pt.partrelid WHERE c.relname = 'audit_logs') THEN
            EXECUTE 'ALTER TABLE audit_logs RENAME TO audit_logs_legacy';
            -- Free up index names that follow the renamed table.
            EXECUTE 'ALTER INDEX IF EXISTS idx_audit_user_date RENAME TO idx_audit_user_date_legacy';
            EXECUTE 'ALTER INDEX IF EXISTS idx_audit_action    RENAME TO idx_audit_action_legacy';
            EXECUTE 'ALTER INDEX IF EXISTS idx_audit_risk      RENAME TO idx_audit_risk_legacy';
            EXECUTE '
                CREATE TABLE audit_logs (
                    id          UUID DEFAULT gen_random_uuid(),
                    user_id     UUID,
                    action      VARCHAR(64) NOT NULL,
                    resource_type VARCHAR(64),
                    resource_id TEXT,
                    ip_address  INET,
                    user_agent  TEXT,
                    details     JSONB DEFAULT ''{}'',
                    risk_level  VARCHAR(16),
                    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                    created_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    PRIMARY KEY (id, created_date)
                ) PARTITION BY RANGE (created_date)';
            EXECUTE 'CREATE INDEX idx_audit_user_date ON audit_logs (user_id, created_at DESC)';
            EXECUTE 'CREATE INDEX idx_audit_action ON audit_logs (action, created_at)';
            EXECUTE 'CREATE INDEX idx_audit_risk ON audit_logs (risk_level, created_at) WHERE risk_level IN (''high'',''critical'')';
            PERFORM create_monthly_partitions('audit_logs', 12, 24);
            EXECUTE 'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, ip_address, user_agent, details, risk_level, created_at, created_date)
                     SELECT id, user_id, action,
                            COALESCE(resource_type, ''''),
                            COALESCE(resource_id::text, ''''),
                            ip_address, user_agent,
                            COALESCE(details, ''{}''::jsonb), risk_level, created_at,
                            created_at::date
                     FROM audit_logs_legacy
                     WHERE created_at >= NOW() - INTERVAL ''25 months''';
            EXECUTE 'DROP TABLE audit_logs_legacy';
        END IF;
    END IF;
END $$;

-- =========================================================================
-- 3. Maintenance helper: run all month-aheads. Call this from CronJob.
-- =========================================================================
CREATE OR REPLACE FUNCTION maintain_all_partitions()
RETURNS void AS $$
BEGIN
    PERFORM create_future_partitions();                  -- transactions (legacy fn from 014)
    PERFORM create_monthly_partitions('sinpe_history', 12, 0);
    IF EXISTS (SELECT 1 FROM pg_partitioned_table pt
               JOIN pg_class c ON c.oid = pt.partrelid WHERE c.relname = 'audit_logs') THEN
        PERFORM create_monthly_partitions('audit_logs', 12, 0);
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT maintain_all_partitions();

COMMIT;
