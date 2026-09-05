-- Nombre de usuario: la forma nueva de entrar.
--
-- Hasta aqui la identidad de login eran tres tokens HMAC ilegibles (cedula,
-- telefono, correo). Esta es la primera columna de identidad EN CLARO desde el
-- corte de la migracion 041, y lo es a proposito: un nombre de usuario es un
-- identificador ELEGIDO, no un dato de identidad civil. Para que no arrastre
-- PII pese a eso, el CHECK de formato exige empezar por letra, lo que deja
-- fuera por construccion cualquier cosa con forma de cedula o de telefono, y
-- el alfabeto no admite '@', asi que tampoco un correo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(20);

-- El formato espeja EXACTAMENTE identifier.ValidUsername (pkg/identifier).
-- Vive tambien en la base porque un INSERT que no pase por el servicio -una
-- migracion futura, un arreglo a mano- no puede meter un nombre que el login
-- no sepa leer. Es el mismo razonamiento del gate ErrCedulaNoUsableEnLogin.
DO $$
BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_users_username_formato
        CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9._-]{2,19}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Nombres que nadie puede reclamar. Sin esta lista, el primero que se registre
-- se queda con 'admin' o con 'soporte' y puede hacerse pasar por el equipo en
-- cualquier pantalla donde el nombre de usuario se muestre.
DO $$
BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_users_username_reservado
        CHECK (username IS NULL OR (
            username NOT IN ('admin', 'administrador', 'soporte', 'support', 'ayuda',
                             'help', 'seguridad', 'security', 'root', 'sistema',
                             'system', 'oficial', 'official', 'info', 'contacto',
                             'kiramo', 'kiramopay', 'nadie', 'null', 'undefined')
            AND username NOT LIKE 'kiramo%'
        ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Unico entre las cuentas que lo tienen. Parcial porque la mayoria lo tendra
-- en NULL hasta que su duenno elija uno.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username
    ON users (username) WHERE username IS NOT NULL;

-- ── Entrada sin contrasena ───────────────────────────────────────────────
-- Marca por cuenta. Sola no alcanza: el servidor ademas exige que la variable
-- DEMO_LOGIN_ENABLED este encendida, y nace apagada. Las dos condiciones
-- juntas son deliberadas: la bandera se enciende para una demostracion y se
-- apaga despues, sin tener que tocar ninguna fila.
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_login BOOLEAN NOT NULL DEFAULT false;

-- Una cuenta de administrador NUNCA se abre sin contrasena. El panel expone la
-- PII enmascarada de todas las cuentas y puede bloquearlas; esa puerta no
-- puede quedar detras de un nombre que esta escrito en el repositorio.
DO $$
BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_users_demo_login_no_admin
        CHECK (NOT (demo_login AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Backfill de las cuentas sembradas ────────────────────────────────────
-- Por cedula_hash y NO por id: en una base recien creada las migraciones
-- corren ANTES del sembrador (cmd/api/main.go), asi que un UPDATE por id no
-- tocaria ninguna fila y la funcion naceria muerta sin que nadie lo note. El
-- sembrador escribe username y demo_login al insertar, para ese caso.
--
-- Se salta la fila si el nombre ya esta tomado, igual que la migracion 050:
-- una colision no puede tumbar el arranque con RUN_MIGRATIONS=true.
DO $$
DECLARE
    par   RECORD;
    tocadas INT := 0;
BEGIN
    FOR par IN
        SELECT * FROM (VALUES
            ('702650930', 'keilor',    true),
            ('700000000', 'admin.kp',  false),  -- administrador: jamas sin contrasena
            ('701234567', 'demo',      true),
            ('101010101', 'victor',    true),
            ('202020202', 'emmanuel',  true)
        ) AS t(cedula, nombre, demo)
    LOOP
        IF EXISTS (SELECT 1 FROM users WHERE username = par.nombre) THEN
            RAISE NOTICE 'nombre de usuario % ya tomado, se salta', par.nombre;
            CONTINUE;
        END IF;
        UPDATE users
           SET username   = par.nombre,
               demo_login = par.demo
         WHERE cedula_hash = fn_pii_hmac(par.cedula)
           AND username IS NULL
           AND deleted_at IS NULL;
        IF FOUND THEN
            tocadas := tocadas + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'nombres de usuario asignados a % cuentas sembradas', tocadas;
END $$;
