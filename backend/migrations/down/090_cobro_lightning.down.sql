-- Bajada de 090_cobro_lightning.sql
--
-- Borra las facturas Lightning y los medios de cobro. Los cobros que se
-- pagaron por Lightning quedan 'paid' sin decir por donde: antes de bajar,
-- exportar qr_charge_lightning si hace falta conservar el registro.
DROP TABLE IF EXISTS qr_charge_lightning;
ALTER TABLE qr_charges DROP CONSTRAINT IF EXISTS chk_qr_charge_paid_via;
ALTER TABLE qr_charges DROP COLUMN IF EXISTS paid_via;
DROP TABLE IF EXISTS merchant_payment_methods;
