#!/usr/bin/env bash
# Instala el APK de depuracion en el emulador que levanto
# android-emulator-runner, abre la app, la recorre (recorrido.mjs) y revisa que
# no se haya caido. Lo corre .github/workflows/apk-emulador.yml.
#
# Uso: bash scripts/emulador/recorrido.sh <apk> <carpeta de salida>
#
# Falla si logcat trae un FATAL EXCEPTION o una linea de AndroidRuntime del
# paquete, si el proceso de la app ya no existe al final, o si el recorrido
# fallo. Las capturas, logcat y el resumen quedan en la carpeta de salida para
# subirlos como artefacto pase lo que pase.

set -uo pipefail

APK="$1"
SALIDA="$2"
PAQUETE=com.kiramopay.app

mkdir -p "$SALIDA"
fallas=()

nivel=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
echo "Emulador con API $nivel"

# El WebView del sistema es el que corre la app: su version decide si el
# recorrido tiene sentido (ver recorrido.mjs).
adb shell dumpsys webviewupdate | tr -d '\r' > "$SALIDA/webview.txt" || true
version_webview=$(grep -oE 'Current WebView package \(name, version\): \([^,]+, [0-9.]+' "$SALIDA/webview.txt" | grep -oE '[0-9][0-9.]*$' || true)
echo "WebView del sistema: ${version_webview:-desconocida}"

adb logcat -c || true
adb install -r -g "$APK"

# -W espera a que la actividad termine de arrancar.
adb shell am start -W -n "$PAQUETE/.MainActivity"

WEBVIEW_VERSION="$version_webview" API_LEVEL="$nivel" node scripts/emulador/recorrido.mjs "$SALIDA"
estado_recorrido=$?
if [ "$estado_recorrido" -ne 0 ]; then
  fallas+=("el recorrido termino con codigo $estado_recorrido")
fi

adb logcat -d > "$SALIDA/logcat.txt" 2>&1 || true
adb logcat -b crash -d > "$SALIDA/logcat-crash.txt" 2>&1 || true

# Un FATAL EXCEPTION de cualquier proceso trae en las lineas siguientes el
# "Process: <paquete>": se mira el bloque, no solo la linea.
if grep -A3 'FATAL EXCEPTION' "$SALIDA/logcat.txt" "$SALIDA/logcat-crash.txt" | grep -q "$PAQUETE"; then
  fallas+=("logcat trae un FATAL EXCEPTION de $PAQUETE")
fi
if grep 'AndroidRuntime' "$SALIDA/logcat.txt" | grep -q "$PAQUETE"; then
  fallas+=("logcat trae lineas de AndroidRuntime de $PAQUETE")
fi

# pidof no existe en todas las imagenes viejas: ps como respaldo (en API 26+
# hace falta -A para ver procesos de otras apps).
if adb shell pidof "$PAQUETE" > /dev/null 2>&1 \
  || adb shell ps -A 2>/dev/null | tr -d '\r' | grep -q " $PAQUETE$" \
  || adb shell ps 2>/dev/null | tr -d '\r' | grep -q " $PAQUETE$"; then
  echo "El proceso de la app sigue vivo."
else
  fallas+=("el proceso de $PAQUETE ya no existe")
fi

adb exec-out screencap -p > "$SALIDA/99-final.png" || true

if [ "${#fallas[@]}" -gt 0 ]; then
  for f in "${fallas[@]}"; do
    echo "::error::API $nivel: $f"
  done
  grep -B2 -A20 'FATAL EXCEPTION' "$SALIDA/logcat.txt" | head -80 || true
  exit 1
fi
echo "API $nivel: sin caidas."
