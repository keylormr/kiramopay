-- 067_push_dispositivos.sql
--
-- Avisos nativos del APK (Firebase Cloud Messaging).
--
-- La WebView de Android no tiene Push API: el web push de push_subscriptions
-- nunca puede llegar a la app instalada. El telefono se registra en FCM y
-- recibe un token; el servidor lo guarda aqui y entrega por la API HTTP v1.
--
-- Un token identifica una instalacion, no una persona: si otra cuenta entra en
-- el mismo telefono y activa los avisos, el token pasa a esa cuenta (UNIQUE +
-- upsert), igual que un endpoint de push_subscriptions.
--
-- Es una credencial de entrega, no un registro: se borra al darse de baja, al
-- bloquear la cuenta y cuando FCM responde UNREGISTERED.

CREATE TABLE IF NOT EXISTS push_dispositivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    plataforma VARCHAR(16) NOT NULL CHECK (plataforma IN ('android')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_dispositivos_user ON push_dispositivos(user_id);
