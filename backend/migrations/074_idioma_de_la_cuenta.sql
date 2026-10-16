-- El idioma en que cada persona usa la app.
--
-- El servidor no lo sabia, asi que todo aviso y todo push salia en espanol,
-- aunque la persona usara la app en ingles o en japones. La app lo guarda con
-- PUT /api/v1/users/me/language y el servidor escribe los avisos en ese
-- idioma (notification/textos.go).
--
-- NULL es "la persona todavia no eligio": todas las cuentas que ya existen y
-- las nuevas. Sus avisos salen en espanol, como siempre. La app distingue asi
-- una cuenta sin idioma (le da el de la pantalla, aunque solo lo haya adivinado
-- el navegador) de una con idioma (solo lo cambia una eleccion de la persona):
-- con 'es' por defecto, entrar desde una PC con Chrome en ingles dejaba los
-- push del telefono en ingles. Sin DEFAULT el ADD COLUMN no reescribe la
-- tabla. Solo los siete idiomas de la app (src/i18n/translations.ts).
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5);

-- El CHECK en dos pasos (docs/ZERO_DOWNTIME_MIGRATIONS.md, seccion 8): NOT VALID
-- no escanea la tabla al agregarlo; VALIDATE la escanea sin bloquear las
-- escrituras.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_language;
ALTER TABLE users ADD CONSTRAINT chk_users_language
    CHECK (language IN ('es', 'en', 'fr', 'pt', 'zh-cn', 'ja', 'hi')) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_users_language;
