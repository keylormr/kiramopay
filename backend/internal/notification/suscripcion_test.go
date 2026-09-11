package notification

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// El navegador serializa la suscripcion como {endpoint, keys: {p256dh, auth}}
// y el servidor solo leia la forma plana: las claves llegaban vacias, se
// guardaban vacias, y todo envio fallaba. Nadie recibio nunca un aviso push.

func TestSeAceptaLaSuscripcionComoLaMandaElNavegador(t *testing.T) {
	// La forma exacta de PushSubscription.toJSON().
	cuerpo := `{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","expirationTime":null,` +
		`"keys":{"p256dh":"BPublica","auth":"secreto"}}`
	var req SubscribeRequest
	if err := json.Unmarshal([]byte(cuerpo), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if err := req.normalizar(); err != nil {
		t.Fatalf("normalizar: %v", err)
	}
	if req.Auth != "secreto" || req.P256dh != "BPublica" {
		t.Fatalf("claves = %q / %q, se esperaban las del navegador", req.Auth, req.P256dh)
	}
}

func TestSeSigueAceptandoLaFormaPlana(t *testing.T) {
	req := SubscribeRequest{Endpoint: "https://x.example/push", Auth: "a", P256dh: "p"}
	if err := req.normalizar(); err != nil {
		t.Fatalf("normalizar: %v", err)
	}
}

// Una suscripcion sin claves se guardaba igual y fallaba en cada envio, en
// silencio. Ahora se rechaza al suscribir.
func TestUnaSuscripcionSinClavesSeRechaza(t *testing.T) {
	casos := []SubscribeRequest{
		{Endpoint: "https://x.example/push"},
		{Endpoint: "https://x.example/push", Auth: "a"},
		{Auth: "a", P256dh: "p"},
		{Endpoint: "   ", Auth: "a", P256dh: "p"},
	}
	for _, c := range casos {
		c := c
		if err := c.normalizar(); !errors.Is(err, ErrSuscripcionIncompleta) {
			t.Fatalf("%+v: err = %v, se esperaba ErrSuscripcionIncompleta", c, err)
		}
	}
}

// 404 y 410 dicen que la suscripcion ya no existe; otro error puede ser
// pasajero y no justifica borrarla.
func TestSoloCuatrocientosCuatroYDiezVencenLaSuscripcion(t *testing.T) {
	for _, s := range []int{404, 410} {
		if !suscripcionVencida(s) {
			t.Fatalf("%d deberia vencer la suscripcion", s)
		}
	}
	for _, s := range []int{200, 201, 400, 401, 403, 413, 429, 500, 503} {
		if suscripcionVencida(s) {
			t.Fatalf("%d NO deberia vencer la suscripcion", s)
		}
	}
}

// Sin las dos claves VAPID el web push esta apagado, y la pantalla no ofrece
// activarlo.
func TestLaClavePublicaDiceSiHayPush(t *testing.T) {
	if _, ok := NewService(nil, "", "").ClavePublica(); ok {
		t.Fatal("sin claves no puede estar habilitado")
	}
	if _, ok := NewService(nil, "publica", "").ClavePublica(); ok {
		t.Fatal("sin la privada no puede estar habilitado")
	}
	if clave, ok := NewService(nil, "publica", "privada").ClavePublica(); !ok || clave != "publica" {
		t.Fatalf("con las dos: %q %v", clave, ok)
	}
}

// webpush-go antepone "mailto:" a todo suscriptor que no sea una URL https.
// Pasarlo ya con el prefijo producia sub="mailto:mailto:...", y el servicio de
// push de Apple rechaza ese token.
func TestSuscriptorVAPIDSinPrefijo(t *testing.T) {
	if strings.HasPrefix(suscriptorVAPID, "mailto:") || strings.HasPrefix(suscriptorVAPID, "https:") {
		t.Fatalf("suscriptorVAPID = %q: la libreria agrega el prefijo, aqui va solo el correo", suscriptorVAPID)
	}
	if !strings.Contains(suscriptorVAPID, "@") {
		t.Fatalf("suscriptorVAPID = %q: tiene que ser un correo", suscriptorVAPID)
	}
}
