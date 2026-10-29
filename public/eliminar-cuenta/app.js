// Formulario publico de solicitud de eliminacion de cuenta.
//
// Tres pasos: el contacto con que se registro (mas la casilla que acepta el plazo
// de 30 dias), el codigo que le llega, y la confirmacion. El codigo correcto es el
// dia 0: la cuenta se bloquea y empieza el plazo. Antes del codigo la API responde
// IGUAL exista o no la cuenta, asi que esta pagina no puede (ni debe) decir si el
// contacto esta registrado, ni en que estado esta. Con el codigo correcto la
// persona ya probo que el contacto es suyo, y la confirmacion le muestra la misma
// respuesta escrita que le llega por correo (Ley 8968): cuando se suprimen sus
// datos, que se conserva por ley y hasta cuando, y la PRODHAB.
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
  var respuesta = $('respuesta');
  var contacto = $('contacto');
  var codigo = $('codigo');
  var acepto = $('acepto-plazo');
  var botonEnviar = $('enviar-codigo');
  var botonConfirmar = $('confirmar');
  var errorContacto = $('error-contacto');
  var errorPlazo = $('error-plazo');
  var errorCodigo = $('error-codigo');
  var avisoCodigo = $('aviso-codigo');

  // El texto generico del HTML (el de "Solicitud recibida") se guarda tal cual
  // esta, para volver a el si el servidor no dice cual fue el resultado.
  var respuestaGenerica = respuesta ? respuesta.cloneNode(true) : null;

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

  // POST JSON. Devuelve { estado, codigo, datos } y nunca lanza: una caida de red
  // es estado 0. "datos" es el contenido de la respuesta (el campo data del sobre
  // del servidor) o null.
  function pedir(ruta, cuerpo) {
    return fetch(API + ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (json) {
          var cod = json && json.error ? json.error.code : '';
          return { estado: res.status, codigo: cod, datos: json && json.data ? json.data : json };
        });
      })
      .catch(function () { return { estado: 0, codigo: '', datos: null }; });
  }

  function mensajeDeFallo(r, porDefecto) {
    if (r.estado === 0) return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
    if (r.estado === 429) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    return porDefecto;
  }

  // ---- La respuesta escrita del paso final ----
  //
  // Todo se construye con createElement y textContent: lo que llega del servidor
  // (fechas y codigos) nunca se interpreta como HTML.

  // Que resolver, una frase por cada motivo que puede impedir que empiece el plazo.
  var PENDIENTES = {
    BALANCE_POSITIVE: 'Tienes saldo en tu billetera: envíalo, retíralo o gástalo hasta dejarla en cero',
    SAVINGS_BALANCE: 'Tienes dinero en tus metas de ahorro: pásalo a tu billetera',
    CRYPTO_BALANCE: 'Tienes criptomonedas: véndelas o envíalas',
    STAKING_ACTIVE: 'Tienes cripto en staking: retírala',
    REGIONAL_BALANCE: 'Tienes saldo en una billetera regional',
    MERCHANT_BALANCE: 'Tu comercio tiene saldo: pásalo a tu billetera',
    MERCHANT_PENDING_CHARGES: 'Tu comercio tiene cobros por QR sin pagar: cancélalos',
    TX_PENDING: 'Tienes un movimiento en proceso: espera a que termine',
    ESCROW_OPEN: 'Tienes un acuerdo de garantía abierto: ciérralo o espera a que se liquide',
    PAYOUT_PENDING: 'Tienes un retiro en proceso: espera a que termine',
    CROSS_BORDER_PENDING: 'Tienes una transferencia internacional en proceso: espera a que termine',
    MARKETPLACE_IN_PROGRESS: 'Tienes un viaje o un pedido en curso: espera a que termine',
  };
  // Un motivo que esta pagina todavia no conoce no se esconde ni se inventa.
  var PENDIENTE_GENERICO = 'Tienes algo pendiente en tu cuenta: revísalo en la app';

  function elemento(etiqueta, texto) {
    var el = document.createElement(etiqueta);
    if (texto) el.textContent = texto;
    return el;
  }

  function vaciar(nodo) {
    while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

  // "17 de noviembre de 2026", en la hora de Costa Rica: la fecha que ve la
  // persona es la de su calendario, no la del servidor. Vacio si no es una fecha.
  function fecha(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('es-CR', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Costa_Rica',
      }).format(d);
    } catch (err) {
      return '';
    }
  }

  // El plazo empezo: cuando se suprime, que se conserva por ley y hasta cuando,
  // como reactivarla y la PRODHAB.
  function respuestaProgramada(datos) {
    var vence = fecha(datos.deletion_due_at);
    var conserva = fecha(datos.retained_until);
    // Sin las dos fechas no se afirma nada: queda el texto generico.
    if (!vence || !conserva) return null;
    return [
      elemento('h3', 'Tu cuenta se cierra el ' + vence),
      elemento('p',
        'Tu cuenta quedó bloqueada y todavía no se borró nada. El ' + vence + ' se suprimen de forma definitiva ' +
        'los datos personales que tienes derecho a borrar y la cuenta se cierra.'),
      elemento('p',
        'Hasta ese día puedes reactivarla entrando a la aplicación con tu contraseña: reactivar cancela el ' +
        'proceso y la cuenta vuelve a funcionar.'),
      elemento('p',
        'Lo que la Ley 7786 nos obliga a conservar (tu identificación y el registro de tus operaciones) se ' +
        'guarda hasta el ' + conserva + ' (más tiempo únicamente si la ley o una autoridad competente lo exige) y ' +
        'después se desasocia de ti de forma irreversible.'),
      elemento('p',
        'Si consideras que no se respetaron tus derechos sobre tus datos, puedes acudir a la Agencia de ' +
        'Protección de Datos de los Habitantes (PRODHAB), según la Ley 8968.'),
      elemento('p',
        'Esta respuesta también te llega por escrito al correo de tu cuenta; si la cuenta no tiene correo, una ' +
        'persona del equipo te la hace llegar por otro medio. Si no la ves, revisa la carpeta de correo no deseado.'),
    ];
  }

  // Algo lo impide: no se borro nada, y una frase por cada cosa que resolver.
  function respuestaPendiente(datos) {
    var codigos = Array.isArray(datos.blockers) ? datos.blockers : [];
    var frases = [];
    codigos.forEach(function (c) {
      var frase = typeof c === 'string' && Object.prototype.hasOwnProperty.call(PENDIENTES, c) ? PENDIENTES[c] : PENDIENTE_GENERICO;
      if (frases.indexOf(frase) === -1) frases.push(frase);
    });
    if (!frases.length) frases.push(PENDIENTE_GENERICO);
    var lista = elemento('ul');
    frases.forEach(function (frase) { lista.appendChild(elemento('li', frase + '.')); });
    return [
      elemento('h3', 'Falta resolver algo antes de eliminar tu cuenta'),
      elemento('p', 'No se borró nada y el plazo de 30 días todavía no empezó. Para poder empezar, resuelve esto:'),
      lista,
      elemento('p', 'Cuando lo hayas resuelto, puedes volver a pedir la eliminación desde esta página.'),
    ];
  }

  // La atiende una persona: nada sobre la cuenta, ni siquiera que algo la frena.
  // Si el servidor la trae, la fecha limite de la respuesta, contada desde que
  // se verifico el codigo.
  function respuestaEnRevision(datos) {
    var plazo = fecha(datos && datos.respond_by);
    return [
      elemento('h3', 'Solicitud recibida'),
      elemento('p',
        'Listo. Tu solicitud la revisa una persona del equipo, que te responde por escrito' +
        (plazo ? ' a más tardar el ' + plazo : '') + '. Revisa también la carpeta de correo no deseado.'),
    ];
  }

  // Esa cuenta no se elimina por esta via: se la lleva al correo de soporte,
  // sin decir por que. Tambien es una respuesta escrita: no se borro nada y la
  // persona puede acudir a la PRODHAB.
  function respuestaNoDisponible() {
    var correoSoporte = elemento('a', 'soporte@kiramopay.com');
    correoSoporte.href = 'mailto:soporte@kiramopay.com';
    var aviso = elemento('p', 'Para tratar tu caso, escribe a ');
    aviso.appendChild(correoSoporte);
    aviso.appendChild(document.createTextNode('.'));
    return [
      elemento('h3', 'Esta solicitud no se puede completar aquí'),
      elemento('p', 'Esta cuenta no se puede eliminar desde esta página. No se borró nada.'),
      aviso,
      elemento('p',
        'Si consideras que no se respetaron tus derechos sobre tus datos, puedes acudir a la Agencia de ' +
        'Protección de Datos de los Habitantes (PRODHAB), según la Ley 8968.'),
      elemento('p',
        'Esta respuesta también te llega por escrito al correo de tu cuenta; si la cuenta no tiene correo, una ' +
        'persona del equipo te la hace llegar por otro medio. Si no la ves, revisa la carpeta de correo no deseado.'),
    ];
  }

  var RESPUESTAS = {
    scheduled: respuestaProgramada,
    blocked: respuestaPendiente,
    received: respuestaEnRevision,
    rejected: respuestaNoDisponible,
  };

  // Escribe en el paso final la respuesta que corresponde a lo que dijo el
  // servidor. Si no trae un resultado conocido (un servidor anterior a este
  // cambio), queda el texto generico del HTML.
  function pintarRespuesta(datos) {
    if (!respuesta) return;
    var resultado = datos && typeof datos.outcome === 'string' ? datos.outcome : '';
    var nodos = Object.prototype.hasOwnProperty.call(RESPUESTAS, resultado) ? RESPUESTAS[resultado](datos) : null;
    vaciar(respuesta);
    if (nodos) {
      nodos.forEach(function (nodo) { respuesta.appendChild(nodo); });
      return;
    }
    if (respuestaGenerica) {
      Array.prototype.forEach.call(respuestaGenerica.childNodes, function (nodo) {
        respuesta.appendChild(nodo.cloneNode(true));
      });
    }
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
          // Con el codigo correcto la persona ya probo que el contacto es suyo:
          // se le dice lo que paso (empezo el plazo, hay algo pendiente, la
          // atiende una persona, o no se elimina por esta via).
          pintarRespuesta(r.datos);
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
