-- OJO: si ya hay casos 'acumulado_30d', la restriccion vieja no los admite y
-- esta vuelta atras falla. Hay que resolverlos (o borrarlos a mano, sabiendo
-- que son rastro de cumplimiento) antes de revertir.
ALTER TABLE uif_reports DROP COLUMN IF EXISTS acumulado_30d_minor;
ALTER TABLE uif_reports DROP CONSTRAINT IF EXISTS chk_uif_type;
ALTER TABLE uif_reports
    ADD CONSTRAINT chk_uif_type
    CHECK (report_type IN ('single_threshold', 'structuring', 'manual'));
