-- Un escrow fondeado no vencia nunca.
--
-- Si el comprador se callaba, la plata quedaba retenida en SYSTEM:ESCROW para
-- siempre: no habia columna de vencimiento, ni barrido, ni una accion del
-- vendedor para decir "ya entregue". Desde el #183 cualquiera puede abrir un
-- escrow desde la app, asi que esto dejo de ser teorico.
--
-- La regla (recomendada el 2026-09-11, siguiendo a Escrow.com: el periodo de
-- revision del comprador empieza cuando se confirma la entrega): cuando un plazo
-- vence, pierde quien tenia que actuar y no lo hizo.
--
--   * El vendedor tiene `entregar_antes` para marcar la entrega. Si no lo hace,
--     se le devuelve la plata al comprador.
--   * Desde que la marca, el comprador tiene `revisar_antes` para liberar o
--     reclamar. Si no hace nada, se le paga al vendedor.
--   * Una disputa detiene el reloj: el barrido solo mira acuerdos 'funded'.
--
-- Los plazos se guardan como FECHAS y no como "dias desde": cambiar la
-- configuracion no mueve el plazo de un acuerdo que ya lo tenia fijado.

ALTER TABLE escrow_agreements
    ADD COLUMN IF NOT EXISTS delivered_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS entregar_antes          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revisar_antes           TIMESTAMPTZ,
    -- Cuando se aviso a las partes que el plazo vigente esta por vencer. Se
    -- vuelve NULL al marcar la entrega, porque empieza otro plazo.
    ADD COLUMN IF NOT EXISTS aviso_vencimiento_at    TIMESTAMPTZ,
    -- Si el acuerdo lo cerro un vencimiento y cual: la pantalla lo explica.
    ADD COLUMN IF NOT EXISTS cerrado_por_vencimiento VARCHAR(16);

ALTER TABLE escrow_agreements DROP CONSTRAINT IF EXISTS chk_escrow_cierre_vencimiento;
ALTER TABLE escrow_agreements
    ADD CONSTRAINT chk_escrow_cierre_vencimiento
    CHECK (cerrado_por_vencimiento IS NULL OR cerrado_por_vencimiento IN ('entrega', 'revision'));

-- Los acuerdos que ya estaban fondeados no tenian plazo: arrancan a contar
-- desde HOY con el valor por defecto (14 dias), no desde que se fondearon.
-- Contar desde el fondeo podria devolverle la plata a un comprador al instante
-- por un plazo que el vendedor nunca tuvo forma de cumplir: la accion de
-- marcar la entrega no existia.
UPDATE escrow_agreements
   SET entregar_antes = NOW() + INTERVAL '14 days'
 WHERE status = 'funded'
   AND entregar_antes IS NULL
   AND delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_escrow_plazos
    ON escrow_agreements (entregar_antes, revisar_antes)
    WHERE status = 'funded';
