-- Down migration for 030_b2b_api.sql
BEGIN;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_endpoints;
DROP TABLE IF EXISTS api_keys;
COMMIT;
