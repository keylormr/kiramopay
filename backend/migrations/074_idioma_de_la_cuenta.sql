-- El idioma en que cada persona usa la app.
--
-- El servidor no lo sabia, asi que todo aviso y todo push salia en espanol,
-- aunque la persona usara la app en ingles o en japones. La app lo guarda con
-- PUT /api/v1/users/me/language al entrar y cada vez que se cambia, y el
-- servidor escribe los avisos en ese idioma (notification/textos.go).
--
-- Las cuentas que ya existen quedan en espanol, que es lo que venian
-- recibiendo, hasta que la app les diga otro. Con un DEFAULT constante el
-- ADD COLUMN no reescribe la tabla (Postgres 11+). Solo los siete idiomas de
-- la app (src/i18n/translations.ts).
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'es';

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_language;
ALTER TABLE users ADD CONSTRAINT chk_users_language
    CHECK (language IN ('es', 'en', 'fr', 'pt', 'zh-cn', 'ja', 'hi'));
