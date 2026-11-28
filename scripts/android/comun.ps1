# Datos comunes de preparar-pc.ps1 y publicar.ps1. No se ejecuta solo.
#
# KiramoPay se compila en una PC, no en GitHub. Estos scripts hacen lo que hacia el flujo
# .github/workflows/android-apk.yml (que queda solo como referencia, desactivado): las mismas
# versiones de Java y del SDK de Android, los mismos pasos y las mismas revisiones.
#
# Solo ASCII en estos archivos: Windows PowerShell 5.1 lee un .ps1 sin BOM con la pagina de codigos
# del sistema, y una tilde saldria rota en los mensajes.
#
# Sumas SHA-256, tomadas el 23-11-2026 de quien distribuye cada archivo:
#   Java:    api.adoptium.net y el archivo .sha256.txt de la descarga (github.com/adoptium)
#   Android: developer.android.com/studio, seccion "Command line tools only"
# Gradle no se instala aparte: lo baja el wrapper del proyecto (android/gradlew), con su propia suma.

# Fuera de AppData a proposito: una app empaquetada (MSIX) que abre una terminal ve AppData\Local
# redirigido a su propia carpeta, y la misma ruta deja de ser la misma segun desde donde se corra (las
# claves guardadas no aparecerian, y Vite falla al ver dos rutas para el mismo index.html).
$script:Raiz = Join-Path $env:USERPROFILE '.kiramopay'
# Si Java 21 y el SDK de Android ya estan en otra carpeta (con la misma forma: java\ y
# android-sdk\), KIRAMOPAY_HERRAMIENTAS apunta ahi y no se instalan de nuevo.
$script:Herramientas = if ($env:KIRAMOPAY_HERRAMIENTAS) { $env:KIRAMOPAY_HERRAMIENTAS } else { Join-Path $script:Raiz 'herramientas' }
$script:RutaJava = Join-Path $script:Herramientas 'java'
$script:RutaSdk = Join-Path $script:Herramientas 'android-sdk'
$script:Bitacora = Join-Path $script:Raiz 'publicaciones.log'

# compileSdk 36 (android/variables.gradle). build-tools trae apksigner, con el que se revisa la firma.
$script:VersionBuildTools = '36.0.0'
$script:PaquetesSdk = @('platform-tools', 'platforms;android-36', "build-tools;$($script:VersionBuildTools)")

# Huella SHA-256 del certificado de la llave de firma de KiramoPay (kiramopay-release.jks, alias
# kiramopay). Es la de todos los APK publicados: un APK firmado con otra llave no se instala encima del
# que la persona ya tiene. publicar.ps1 no publica nada que no salga con esta firma.
$script:HuellaFirma = 'b90ade41a73d2bb2c205b7977bf33f5e72970e3b8e9508c662bccd0d4418a5bf'

$script:Repositorio = 'keylormr/kiramopay'

$script:EsArm64 = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64

# Java nativo para cada arquitectura. Las herramientas de Android de Google son solo x64: en Windows ARM
# corren con la emulacion x64 de Windows 11.
if ($script:EsArm64) {
    $javaDescarga = @{
        Nombre  = 'Java (Temurin 21.0.12.1+1, Windows ARM64)'
        Url     = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_aarch64_windows_hotspot_21.0.12.1_1.zip'
        Sha256  = 'ccf2e51f527d542a70ba5794a600d3aac04b4e967950e227834c7566cb1bec7b'
        Destino = $script:RutaJava
    }
}
else {
    $javaDescarga = @{
        Nombre  = 'Java (Temurin 21.0.13.1+2, Windows x64)'
        Url     = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13.1_2.zip'
        Sha256  = 'bbebea1469996b276683c9299c227b294f85c847039c82633218186a4ad4fbf2'
        Destino = $script:RutaJava
    }
}

$script:Descargas = [ordered]@{
    java    = $javaDescarga
    android = @{
        Nombre  = 'Herramientas de linea de comandos de Android (15859902)'
        Url     = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
        Sha256  = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
        Destino = (Join-Path $script:RutaSdk 'cmdline-tools\latest')
    }
}

# Detiene el script; el catch de cada script muestra el mensaje con "ALTO:".
function Stop-ConMensaje([string]$mensaje) {
    throw $mensaje
}

function Write-Alto($registro) {
    Write-Host ''
    Write-Host "ALTO: $($registro.Exception.Message)" -ForegroundColor Red
}

function Write-Paso([string]$texto) {
    Write-Host ''
    Write-Host "== $texto" -ForegroundColor Cyan
}

# Pone Java y el SDK de Android solo en este proceso: no toca las variables del sistema.
function Set-EntornoHerramientas {
    $env:JAVA_HOME = $script:RutaJava
    $env:ANDROID_HOME = $script:RutaSdk
    $env:ANDROID_SDK_ROOT = $script:RutaSdk
    $env:Path = (Join-Path $script:RutaJava 'bin') + ';' + (Join-Path $script:RutaSdk 'cmdline-tools\latest\bin') + ';' +
        (Join-Path $script:RutaSdk 'platform-tools') + ';' + $env:Path
}

function Test-ArquitecturaSoportada {
    $arq = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    if ($arq -eq [System.Runtime.InteropServices.Architecture]::X64) { return }
    if ($script:EsArm64) {
        Write-Host 'Windows ARM: Java corre nativo y las herramientas de Android de Google (solo x64) corren emuladas. Es mas lento.' -ForegroundColor Yellow
        return
    }
    Stop-ConMensaje "Esta PC es $arq. Hace falta Windows x64 o ARM64."
}
