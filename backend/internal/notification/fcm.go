package notification

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Avisos nativos por Firebase Cloud Messaging (API HTTP v1).
//
// Sin dependencias nuevas: el token de acceso se obtiene con el flujo de cuenta
// de servicio de Google (un JWT firmado RS256 que se canjea en el endpoint de
// tokens), con la misma libreria JWT que ya usa el proyecto.
// https://developers.google.com/identity/protocols/oauth2/service-account

const (
	alcanceFCM      = "https://www.googleapis.com/auth/firebase.messaging"
	concesionJWT    = "urn:ietf:params:oauth:grant-type:jwt-bearer"
	uriTokenGoogle  = "https://oauth2.googleapis.com/token"
	baseEnvioFCM    = "https://fcm.googleapis.com"
	canalDeAvisos   = "avisos" // el canal que crea la app; sin el, FCM usa el de respaldo
	margenDelAcceso = 5 * time.Minute
)

// cuentaDeServicio es el JSON que descarga la consola de Firebase (Configuracion
// del proyecto > Cuentas de servicio > Generar nueva clave privada).
type cuentaDeServicio struct {
	ProjectID    string `json:"project_id"`
	PrivateKeyID string `json:"private_key_id"`
	PrivateKey   string `json:"private_key"`
	ClientEmail  string `json:"client_email"`
	TokenURI     string `json:"token_uri"`
}

// EnviadorFCM entrega avisos a los telefonos Android.
type EnviadorFCM struct {
	proyecto string
	correo   string
	idClave  string
	clave    *rsa.PrivateKey
	uriToken string
	baseURL  string
	http     *http.Client
	ahora    func() time.Time

	mu     sync.Mutex
	acceso string
	vence  time.Time
}

// ErrCredencialesFCM: la cuenta de servicio no se pudo leer. Se reporta al
// arrancar; los avisos nativos quedan apagados pero el resto sigue.
var ErrCredencialesFCM = errors.New("notification: FCM service account is invalid")

// NuevoEnviadorFCM lee la cuenta de servicio, cruda o en base64 (Render guarda
// mejor una sola linea). Credenciales vacias devuelven nil, nil: los avisos
// nativos quedan apagados y la app no ofrece activarlos.
func NuevoEnviadorFCM(credenciales string) (*EnviadorFCM, error) {
	crudo := strings.TrimSpace(credenciales)
	if crudo == "" {
		return nil, nil
	}
	if !strings.HasPrefix(crudo, "{") {
		dec, err := base64.StdEncoding.DecodeString(crudo)
		if err != nil {
			return nil, fmt.Errorf("%w: not JSON and not base64", ErrCredencialesFCM)
		}
		crudo = string(dec)
	}
	var c cuentaDeServicio
	if err := json.Unmarshal([]byte(crudo), &c); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCredencialesFCM, err)
	}
	if c.ProjectID == "" || c.ClientEmail == "" || c.PrivateKey == "" {
		return nil, fmt.Errorf("%w: project_id, client_email and private_key are required", ErrCredencialesFCM)
	}
	clave, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(c.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("%w: private_key: %v", ErrCredencialesFCM, err)
	}
	uriToken := c.TokenURI
	if uriToken == "" {
		uriToken = uriTokenGoogle
	}
	if u, err := url.Parse(uriToken); err != nil || u.Scheme != "https" {
		return nil, fmt.Errorf("%w: token_uri must be https", ErrCredencialesFCM)
	}
	return &EnviadorFCM{
		proyecto: c.ProjectID,
		correo:   c.ClientEmail,
		idClave:  c.PrivateKeyID,
		clave:    clave,
		uriToken: uriToken,
		baseURL:  baseEnvioFCM,
		http:     &http.Client{Timeout: 10 * time.Second},
		ahora:    time.Now,
	}, nil
}

// tokenDeAcceso devuelve un token vigente, pidiendo uno nuevo cuando falta
// poco para que venza. El candado cubre la peticion: varios avisos a la vez
// no piden varios tokens.
func (e *EnviadorFCM) tokenDeAcceso(ctx context.Context) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	ahora := e.ahora()
	if e.acceso != "" && ahora.Before(e.vence) {
		return e.acceso, nil
	}

	aserto := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":   e.correo,
		"scope": alcanceFCM,
		"aud":   e.uriToken,
		"iat":   ahora.Unix(),
		"exp":   ahora.Add(time.Hour).Unix(),
	})
	if e.idClave != "" {
		aserto.Header["kid"] = e.idClave
	}
	firmado, err := aserto.SignedString(e.clave)
	if err != nil {
		return "", fmt.Errorf("fcm: sign assertion: %w", err)
	}

	form := url.Values{"grant_type": {concesionJWT}, "assertion": {firmado}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.uriToken, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := e.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("fcm: token request: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	cuerpo, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fcm: token endpoint returned %d: %s", resp.StatusCode, recortar(cuerpo))
	}
	var r struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(cuerpo, &r); err != nil || r.AccessToken == "" {
		return "", errors.New("fcm: token endpoint returned no access_token")
	}
	vigencia := time.Duration(r.ExpiresIn) * time.Second
	if vigencia <= margenDelAcceso {
		vigencia = margenDelAcceso + time.Minute
	}
	e.acceso = r.AccessToken
	e.vence = ahora.Add(vigencia - margenDelAcceso)
	return e.acceso, nil
}

// olvidarAcceso tira el token en cache: el siguiente envio pide otro.
func (e *EnviadorFCM) olvidarAcceso() {
	e.mu.Lock()
	e.acceso = ""
	e.mu.Unlock()
}

type notificacionFCM struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type androidFCM struct {
	Priority     string `json:"priority"`
	Notification struct {
		ChannelID string `json:"channel_id"`
	} `json:"notification"`
}

type mensajeFCM struct {
	Message struct {
		Token        string            `json:"token"`
		Notification notificacionFCM   `json:"notification"`
		Data         map[string]string `json:"data"`
		Android      androidFCM        `json:"android"`
	} `json:"message"`
}

// armarMensajeFCM: un aviso de notificacion (lo pinta el sistema con la app
// cerrada), con la ruta en data para cuando se toca, en el canal de la app y
// con prioridad alta, que es la que despierta al telefono para un movimiento
// de dinero.
func armarMensajeFCM(token string, p *NotificationPayload) mensajeFCM {
	var m mensajeFCM
	m.Message.Token = token
	m.Message.Notification = notificacionFCM{Title: p.Title, Body: p.Body}
	ruta := p.URL
	if ruta == "" {
		ruta = "/"
	}
	m.Message.Data = map[string]string{"url": ruta}
	if p.Tag != "" {
		m.Message.Data["tipo"] = p.Tag
	}
	m.Message.Android.Priority = "HIGH"
	m.Message.Android.Notification.ChannelID = canalDeAvisos
	return m
}

// errorFCM es el cuerpo de error de la API v1.
type errorFCM struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			Type      string `json:"@type"`
			ErrorCode string `json:"errorCode"`
		} `json:"details"`
	} `json:"error"`
}

// tokenNoRegistrado: solo UNREGISTERED dice que el token murio. Un 404 sin ese
// detalle puede ser el proyecto mal configurado, y borrar por eso vaciaria la
// tabla entera en el primer envio. INVALID_ARGUMENT tampoco se toma como token
// muerto: la documentacion de FCM advierte que tambien sale por un mensaje mal
// armado.
func tokenNoRegistrado(status int, cuerpo []byte) bool {
	if status != http.StatusNotFound {
		return false
	}
	var e errorFCM
	if json.Unmarshal(cuerpo, &e) != nil {
		return false
	}
	for _, d := range e.Error.Details {
		if d.ErrorCode == "UNREGISTERED" {
			return true
		}
	}
	return false
}

// Enviar entrega un aviso a un telefono. invalido = true cuando FCM responde
// que el token ya no existe: el que llama lo borra.
func (e *EnviadorFCM) Enviar(ctx context.Context, token string, p *NotificationPayload) (invalido bool, err error) {
	acceso, err := e.tokenDeAcceso(ctx)
	if err != nil {
		return false, err
	}
	cuerpo, err := json.Marshal(armarMensajeFCM(token, p))
	if err != nil {
		return false, err
	}
	destino := e.baseURL + "/v1/projects/" + url.PathEscape(e.proyecto) + "/messages:send"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, destino, bytes.NewReader(cuerpo))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+acceso)
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.http.Do(req)
	if err != nil {
		return false, fmt.Errorf("fcm: send: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	respuesta, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
	switch {
	case resp.StatusCode == http.StatusOK:
		return false, nil
	case tokenNoRegistrado(resp.StatusCode, respuesta):
		return true, errors.New("fcm: token unregistered")
	case resp.StatusCode == http.StatusUnauthorized:
		// El token de acceso se revoco o vencio antes de lo esperado.
		e.olvidarAcceso()
	}
	return false, fmt.Errorf("fcm: send returned %d: %s", resp.StatusCode, recortar(respuesta))
}

func recortar(b []byte) string {
	const max = 300
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}
