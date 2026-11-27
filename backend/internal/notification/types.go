package notification

import (
	"errors"
	"strings"
	"time"
)

// PushSubscription represents a browser push subscription.
type PushSubscription struct {
	ID       string `json:"id"`
	UserID   string `json:"user_id"`
	Endpoint string `json:"endpoint"`
	Auth     string `json:"auth"`
	P256dh   string `json:"p256dh"`
}

// NotificationPayload is the content of a push notification.
type NotificationPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Icon  string `json:"icon,omitempty"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
	// Data son los datos con que la app abre la pantalla del aviso (ver
	// DatosParaLaApp). Viajan en el historial, en el aviso en vivo y en el
	// push.
	Data map[string]string `json:"data,omitempty"`
	// ID es el del aviso guardado. Lo pone SendToUser: el push lo lleva para
	// que tocarlo en el telefono lo marque leido.
	ID string `json:"id,omitempty"`
}

// NotificationRecord is a persisted notification for history.
type NotificationRecord struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	Type   string `json:"type"`
	// Datos para abrir la pantalla del aviso. nil en los avisos de antes de la
	// migracion 092 y en los que no llevan a ninguna pantalla.
	Datos     map[string]string `json:"data,omitempty"`
	ReadAt    *time.Time        `json:"read_at,omitempty"`
	CreatedAt time.Time         `json:"created_at"`
}

// datosParaLaApp son los datos del catalogo que la app usa para abrir la
// pantalla de un aviso. Lo demas (montos, nombres, notas) se queda en el texto:
// no hace falta para navegar y viajaria de mas en el push.
var datosParaLaApp = []string{"activo", "movimiento"}

// DatosParaLaApp saca de los datos de un aviso los que abren su pantalla: el
// activo de una alerta de precio y el movimiento de un SINPE recibido. Solo
// textos no vacios; sin ninguno devuelve nil.
func DatosParaLaApp(datos map[string]any) map[string]string {
	var out map[string]string
	for _, clave := range datosParaLaApp {
		texto, ok := datos[clave].(string)
		if !ok || strings.TrimSpace(texto) == "" {
			continue
		}
		if out == nil {
			out = map[string]string{}
		}
		out[clave] = texto
	}
	return out
}

// SubscribeRequest is the request body for subscribing.
type SubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Auth     string `json:"auth"`
	P256dh   string `json:"p256dh"`
	// Keys es la forma en que el NAVEGADOR serializa una suscripcion
	// (PushSubscription.toJSON(): {endpoint, keys: {p256dh, auth}}). El servidor
	// solo leia la forma plana, asi que las claves llegaban vacias, se
	// guardaban vacias, y todo envio fallaba: sin claves no se puede cifrar.
	// Se aceptan las dos.
	Keys *struct {
		Auth   string `json:"auth"`
		P256dh string `json:"p256dh"`
	} `json:"keys,omitempty"`
}

// ErrSuscripcionIncompleta: faltan el endpoint o alguna de las dos claves.
var ErrSuscripcionIncompleta = errors.New("notification: subscription needs endpoint, auth and p256dh")

// normalizar deja la suscripcion en forma plana y rechaza la incompleta: una
// suscripcion sin claves se guardaba igual y fallaba en cada envio, en
// silencio.
func (r *SubscribeRequest) normalizar() error {
	r.Endpoint = strings.TrimSpace(r.Endpoint)
	if r.Keys != nil {
		if r.Auth == "" {
			r.Auth = r.Keys.Auth
		}
		if r.P256dh == "" {
			r.P256dh = r.Keys.P256dh
		}
	}
	r.Auth = strings.TrimSpace(r.Auth)
	r.P256dh = strings.TrimSpace(r.P256dh)
	if r.Endpoint == "" || r.Auth == "" || r.P256dh == "" {
		return ErrSuscripcionIncompleta
	}
	return nil
}
