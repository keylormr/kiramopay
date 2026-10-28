// Comprobaciones de un paso. Las "suaves" (ok, igual, cercano, respuesta) no
// detienen el paso: se acumulan y al final lanzan UN error con la lista
// completa, para que un paso con varias aserciones diga todo lo que esta mal de
// una vez. Las "duras" (exigir) lanzan en el acto, porque lo que sigue no tiene
// sentido si falla.

function mostrar(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export class Comprobaciones {
  constructor() {
    this.fallos = [];
  }

  ok(condicion, mensaje) {
    if (!condicion) this.fallos.push(mensaje);
    return !!condicion;
  }

  igual(real, esperado, mensaje) {
    if (String(real) !== String(esperado)) {
      this.fallos.push(`${mensaje}: se esperaba ${mostrar(esperado)} y se obtuvo ${mostrar(real)}`);
      return false;
    }
    return true;
  }

  /** |real - esperado| <= tolerancia (numeros o cadenas numericas). */
  cercano(real, esperado, tolerancia, mensaje) {
    const r = Number(real);
    const e = Number(esperado);
    if (!Number.isFinite(r) || !Number.isFinite(e) || Math.abs(r - e) > tolerancia) {
      this.fallos.push(`${mensaje}: se esperaba ${e} (±${tolerancia}) y se obtuvo ${mostrar(real)}`);
      return false;
    }
    return true;
  }

  /** La respuesta de la API tiene el estado (y el codigo de error) esperados. */
  respuesta(r, status, mensaje, codigo) {
    const bien = r.status === status && (codigo === undefined || r.codigo === codigo);
    if (!bien) {
      const quiero = codigo ? `${status} ${codigo}` : `${status}`;
      this.fallos.push(`${mensaje}: se esperaba HTTP ${quiero} y se obtuvo ${r.resumen()}`);
    }
    return bien;
  }

  exigir(condicion, mensaje) {
    if (!condicion) throw new Error(mensaje);
  }

  exigirRespuesta(r, status, mensaje, codigo) {
    const bien = r.status === status && (codigo === undefined || r.codigo === codigo);
    if (!bien) {
      const quiero = codigo ? `${status} ${codigo}` : `${status}`;
      throw new Error(`${mensaje}: se esperaba HTTP ${quiero} y se obtuvo ${r.resumen()}`);
    }
  }

  cerrar() {
    if (this.fallos.length) throw new Error(this.fallos.join('\n'));
  }
}
