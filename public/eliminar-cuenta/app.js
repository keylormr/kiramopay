// Formulario publico de solicitud de eliminacion de cuenta.
//
// Tres pasos: el contacto con que se registro (mas la casilla que acepta el plazo
// de 30 dias), el codigo que le llega, y la confirmacion. El codigo correcto es el
// dia 0: la cuenta se bloquea y empieza el plazo. La API responde IGUAL exista o
// no la cuenta, asi que esta pagina no puede (ni debe) decir si el contacto esta
// registrado, ni en que estado esta.
//
// Es un archivo aparte, y no un script dentro del HTML, porque la politica de
// seguridad del sitio solo admite scripts del mismo origen.
(function () {
  'use strict';

  // Misma regla que usa la aplicacion: el servidor tiene su propio host. En
  // desarrollo local, el backend en el puerto 8080.
  var host = window.location.hostname;
  var API = host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:8080' : 'https://api.kiramopay.com';

  var $ = function (id) { return document.getElementById(id); };
  var pasoContacto = $('paso-contacto');
  var pasoCodigo = $('paso-codigo');
  var pasoListo = $('paso-listo');
  var contacto = $('contacto');
  var codigo = $('codigo');
  var acepto = $('acepto-plazo');
  var botonEnviar = $('enviar-codigo');
  var botonConfirmar = $('confirmar');
  var errorContacto = $('error-contacto');
  var errorPlazo = $('error-plazo');
  var errorCodigo = $('error-codigo');
  var avisoCodigo = $('aviso-codigo');

  if (!pasoContacto || !pasoCodigo || !pasoListo || !acepto || !errorPlazo) return;

  // Sin la casilla marcada no se envia nada: el servidor tambien lo rechaza con
  // TERMS_NOT_ACCEPTED, y se usa este mismo mensaje.
  var MENSAJE_PLAZO = 'Marca la casilla para continuar: debes aceptar que, al confirmar el código, tu cuenta se bloquea y se elimina 30 días después.';

  function mostrar(paso) {
    pasoContacto.hidden = paso !== pasoContacto;
    pasoCodigo.hidden = paso !== pasoCodigo;
    pasoListo.hidden = paso !== pasoListo;
    var foco = paso === pasoContacto ? contacto : paso === pasoCodigo ? codigo : null;
    if (foco) foco.focus();
  }

  function error(elemento, texto) {
    elemento.textContent = texto;
    elemento.hidden = !texto;
  }

  // POST JSON. Devuelve { estado, codigo } y nunca lanza: una caida de red es
  // estado 0.
  function pedir(ruta, cuerpo) {
    return fetch(API + ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (json) {
          var cod = json && json.error ? json.error.code : '';
          return { estado: res.status, codigo: cod };
        });
      })
      .catch(function () { return { estado: 0, codigo: '' }; });
  }

  function mensajeDeFallo(r, porDefecto) {
    if (r.estado === 0) return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
    if (r.estado === 429) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    return porDefecto;
  }

  pasoContacto.addEventListener('submit', function (e) {
    e.preventDefault();
    var valor = contacto.value.trim();
    error(errorContacto, '');
    error(errorPlazo, '');
    if (!valor) {
      error(errorContacto, 'Escribe el correo o el teléfono con que te registraste.');
      if (!acepto.checked) error(errorPlazo, MENSAJE_PLAZO);
      contacto.focus();
      return;
    }
    if (!acepto.checked) {
      error(errorPlazo, MENSAJE_PLAZO);
      acepto.focus();
      return;
    }
    botonEnviar.disabled = true;
    pedir('/api/v1/public/account-deletion-requests', { contact: valor, accept_terms: true }).then(function (r) {
      botonEnviar.disabled = false;
      if (r.estado === 202 || r.estado === 200) {
        // Misma frase exista o no la cuenta.
        avisoCodigo.textContent = 'Si ese contacto tiene una cuenta, te enviamos un código. Escríbelo aquí para confirmar la solicitud.';
        codigo.value = '';
        error(errorCodigo, '');
        mostrar(pasoCodigo);
        return;
      }
      if (r.codigo === 'TERMS_NOT_ACCEPTED') {
        error(errorPlazo, MENSAJE_PLAZO);
        acepto.focus();
        return;
      }
      if (r.codigo === 'INVALID_CONTACT') {
        error(errorContacto, 'Escribe un correo o un teléfono válido. No podemos usar la cédula ni el nombre de usuario.');
        return;
      }
      error(errorContacto, mensajeDeFallo(r, 'No pudimos enviar la solicitud. Inténtalo de nuevo en unos minutos.'));
    });
  });

  acepto.addEventListener('change', function () {
    if (acepto.checked) error(errorPlazo, '');
  });

  codigo.addEventListener('input', function () {
    codigo.value = codigo.value.replace(/\D/g, '').slice(0, 6);
  });

  pasoCodigo.addEventListener('submit', function (e) {
    e.preventDefault();
    error(errorCodigo, '');
    if (codigo.value.length !== 6) {
      error(errorCodigo, 'El código tiene 6 dígitos.');
      codigo.focus();
      return;
    }
    botonConfirmar.disabled = true;
    pedir('/api/v1/public/account-deletion-requests/verify', { contact: contacto.value.trim(), code: codigo.value })
      .then(function (r) {
        botonConfirmar.disabled = false;
        if (r.estado === 200) {
          // Misma respuesta en todos los casos (empezo el plazo, hay algo
          // pendiente, o la atiende una persona): el texto esta en el HTML y no
          // revela el estado de la cuenta.
          mostrar(pasoListo);
          return;
        }
        if (r.codigo === 'INVALID_CODE') {
          error(errorCodigo, 'El código no es válido o ya venció. Revisa el último que te llegó, o pide uno nuevo.');
          codigo.select();
          return;
        }
        error(errorCodigo, mensajeDeFallo(r, 'No pudimos confirmar la solicitud. Inténtalo de nuevo.'));
      });
  });

  $('otro-contacto').addEventListener('click', function () {
    error(errorContacto, '');
    error(errorPlazo, '');
    // Cada solicitud acepta el plazo por separado.
    acepto.checked = false;
    mostrar(pasoContacto);
  });
})();
