# KiramoPay - Configuracion de Servidor

## Puerto Estandar: 9999

Este proyecto utiliza el puerto **9999** para todas las operaciones de desarrollo y despliegue.

---

## Comandos Disponibles

### Desarrollo
```bash
npm run dev
# Inicia servidor de desarrollo en http://localhost:9999
```

### Vista Previa de Build
```bash
npm run preview
# Previsualiza el build en http://localhost:9999
```

### Servidor de Descarga APK
```bash
npm run serve:apk
# Sirve el APK para descarga en http://[TU-IP]:9999
```

### Construir APK
```bash
npm run build:android
# Compila el APK de Android
```

---

## Descarga del APK

Desde cualquier dispositivo en la misma red:

1. **URL directa del APK:**
   ```
   http://192.168.100.18:9999/app-debug.apk
   ```

2. **Ver todos los archivos:**
   ```
   http://192.168.100.18:9999/
   ```

> **Nota:** La IP puede cambiar segun tu red. Ejecuta `ipconfig` para obtener la IP actual.

---

## Flujo Completo de Build y Despliegue

```bash
# 1. Compilar la aplicacion web
npm run build

# 2. Sincronizar con Capacitor
npx cap sync android

# 3. Construir el APK
npm run build:android

# 4. Iniciar servidor de descarga
npm run serve:apk
```

---

*Puerto estandarizado: 9999*
*Ultima actualizacion: Enero 2026*
