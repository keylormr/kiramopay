-- La cola de cumplimiento no podia recibir un solo caso.
--
-- Los umbrales de reporte siguen la Ley 8204 (unos USD 10.000 o su equivalente)
-- y la aplicacion los comparaba contra UN movimiento y contra el agregado de UN
-- dia. Los topes de KYC son mucho mas bajos —el nivel mas alto permite
-- ₡2.000.000 y USD 3.800 al dia—, asi que ninguna de las dos reglas podia
-- dispararse: el PR #169 lo dejo visible en el log de arranque, sin moverlo.
--
-- El tope diario se reinicia cada dia. Quien quiera mover mucho sin que se vea
-- lo reparte en DIAS, no en movimientos: con el nivel completo, ₡2.000.000
-- diarios durante un mes son ₡60.000.000 sin una sola alerta.
--
-- Esta migracion agrega la regla que si ve eso: el acumulado de salidas de los
-- ultimos 30 dias que cruza el mismo umbral. NO baja el umbral legal ni reporta
-- nada a la UIF por su cuenta: crea un caso en la cola de REVISION, que es lo
-- que ya era esta tabla (el oficial de cumplimiento lo marca enviado o
-- descartado).

ALTER TABLE uif_reports DROP CONSTRAINT IF EXISTS chk_uif_type;
ALTER TABLE uif_reports
    ADD CONSTRAINT chk_uif_type
    CHECK (report_type IN ('single_threshold', 'structuring', 'manual', 'acumulado_30d'));

-- El acumulado de 30 dias que disparo el caso. Va en su propia columna: meterlo
-- en daily_total_minor le haria decir al reporte algo que no es.
ALTER TABLE uif_reports ADD COLUMN IF NOT EXISTS acumulado_30d_minor BIGINT;
