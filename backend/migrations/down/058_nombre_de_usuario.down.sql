DROP INDEX IF EXISTS uq_users_username;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_username_formato;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_username_reservado;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_demo_login_no_admin;
ALTER TABLE users DROP COLUMN IF EXISTS username;
ALTER TABLE users DROP COLUMN IF EXISTS demo_login;
