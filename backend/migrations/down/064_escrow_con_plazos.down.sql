DROP INDEX IF EXISTS idx_escrow_plazos;
ALTER TABLE escrow_agreements DROP CONSTRAINT IF EXISTS chk_escrow_cierre_vencimiento;
ALTER TABLE escrow_agreements
    DROP COLUMN IF EXISTS cerrado_por_vencimiento,
    DROP COLUMN IF EXISTS aviso_vencimiento_at,
    DROP COLUMN IF EXISTS revisar_antes,
    DROP COLUMN IF EXISTS entregar_antes,
    DROP COLUMN IF EXISTS delivered_at;
