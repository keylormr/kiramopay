-- Down migration for 025_kyc.sql
BEGIN;
DROP TABLE IF EXISTS sanction_screenings;
DROP TABLE IF EXISTS sanction_list;
DROP TABLE IF EXISTS kyc_documents;
DROP TABLE IF EXISTS kyc_verifications;
COMMIT;
