<#
.SYNOPSIS
Prepara una PC con Windows (x64 o ARM64) para compilar el APK de KiramoPay sin GitHub Actions.

.DESCRIPTION
Una sola vez por PC. Instala, solo para el usuario actual y sin tocar el sistema ni sus variables:
  - Java 21 (Temurin), el que piden Capacitor 8 y sus plugins
  - las herramientas de linea de comandos de Android, con platform-tools, la plataforma 36 y
    build-tools 35.0.0
en %USERPROFILE%\.kiramopay\herramientas (o en KIRAMOPAY_HERRAMIENTAS, si esta definida). No hace falta
Android Studio. Gradle lo baja el propio proyecto (android\gradlew) la primera vez que compila.

Cada descarga se compara con su suma SHA-256 oficial (anotada en comun.ps1). Si no coincide, se borra
y el script se detiene sin instalar nada. Lo que ya esta instalado y verificado no se vuelve a bajar,
asi que se puede correr de nuevo sin problema.

Google pide aceptar las licencias del SDK de Android: el script las muestra y las aceptas tu,
respondiendo "y" a cada una.

Ocupa unos 3 GB contando lo que Gradle y npm bajan la primera vez que se compila.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\android\preparar-pc.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
. (Join-Path $PSScriptRoot 'comun.ps1')

function Install-Descarga([string]$clave) {
    $d = $script:Descargas[$clave]
    $marca = Join-Path $d.Destino '.kiramopay-verificado'
    if ((Test-Path $marca) -and ((Get-Content $marca -Raw).Trim() -eq $d.Sha256)) {
        Write-Host "$($d.Nombre): ya instalado y verificado."
        return
    }
    $temporal = Join-Path ([IO.Path]::GetTempPath()) ("kiramopay-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporal | Out-Null
    try {
        $zip = Join-Path $temporal 'descarga.zip'
        Write-Host "$($d.Nombre): descargando de $($d.Url)"
        # --progress-bar: sin barra, una descarga larga parece congelada.
        & curl.exe --fail --location --progress-bar --show-error --retry 3 --output $zip $d.Url
        if ($LASTEXITCODE -ne 0) { Stop-ConMensaje "No se pudo descargar $($d.Nombre)." }

        $suma = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
        if ($suma -ne $d.Sha256) {
            Stop-ConMensaje "La suma SHA-256 de $($d.Nombre) no coincide (esperada $($d.Sha256), obtenida $suma). No se instala nada."
        }
        Write-Host "$($d.Nombre): suma SHA-256 correcta."

        $extraido = Join-Path $temporal 'extraido'
        New-Item -ItemType Directory -Path $extraido | Out-Null
        & tar.exe -xf $zip -C $extraido
        if ($LASTEXITCODE -ne 0) { Stop-ConMensaje "No se pudo descomprimir $($d.Nombre)." }

        # Cada zip trae una sola carpeta (jdk-21..., cmdline-tools): esa es la que se instala.
        $carpetas = @(Get-ChildItem -Path $extraido -Directory)
        if ($carpetas.Count -ne 1) { Stop-ConMensaje "El zip de $($d.Nombre) no tiene la forma esperada." }

        if (Test-Path $d.Destino) { Remove-Item -Recurse -Force $d.Destino }
        New-Item -ItemType Directory -Path (Split-Path $d.Destino -Parent) -Force | Out-Null
        Move-Item -Path $carpetas[0].FullName -Destination $d.Destino
        Set-Content -Path $marca -Value $d.Sha256 -Encoding ASCII
        Write-Host "$($d.Nombre): instalado en $($d.Destino)"
    }
    finally {
        Remove-Item -Recurse -Force $temporal -ErrorAction SilentlyContinue
    }
}

try {
    Test-ArquitecturaSoportada

    $unidad = (Get-Item $env:USERPROFILE).PSDrive
    $libreGb = [math]::Round($unidad.Free / 1GB, 1)
    if ($libreGb -lt 5) { Stop-ConMensaje "Hay $libreGb GB libres en $($unidad.Name): hacen falta al menos 5." }

    Write-Paso 'Programas que tienen que estar instalados'
    foreach ($programa in 'git', 'node', 'npm', 'gh') {
        if (-not (Get-Command $programa -ErrorAction SilentlyContinue)) { Stop-ConMensaje "Falta $programa. Instalalo y vuelve a correr este script." }
    }
    $node = (& node --version).Trim()
    if ($node -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { Stop-ConMensaje "Hace falta Node 22 o mas nuevo; esta PC tiene $node." }
    Write-Host "git, Node $node, npm y gh estan instalados."

    Write-Paso 'Descargas verificadas'
    foreach ($clave in $script:Descargas.Keys) { Install-Descarga $clave }

    Set-EntornoHerramientas
    $sdkmanager = Join-Path $script:RutaSdk 'cmdline-tools\latest\bin\sdkmanager.bat'

    Write-Paso 'Licencias del SDK de Android'
    Write-Host 'Google muestra sus licencias. Leelas y responde "y" para aceptarlas.'
    & $sdkmanager "--sdk_root=$($script:RutaSdk)" --licenses
    if ($LASTEXITCODE -ne 0) { Stop-ConMensaje 'No se aceptaron las licencias del SDK de Android.' }

    Write-Paso 'Paquetes del SDK (sdkmanager verifica cada uno)'
    & $sdkmanager "--sdk_root=$($script:RutaSdk)" --install @($script:PaquetesSdk)
    if ($LASTEXITCODE -ne 0) { Stop-ConMensaje 'No se pudieron instalar los paquetes del SDK.' }

    Write-Paso 'Comprobacion'
    & (Join-Path $script:RutaJava 'bin\java.exe') -version
    $apksigner = Join-Path $script:RutaSdk "build-tools\$($script:VersionBuildTools)\apksigner.bat"
    if (-not (Test-Path $apksigner)) { Stop-ConMensaje "Falta apksigner en $apksigner." }

    Write-Host ''
    Write-Host 'Listo. Esta PC ya puede compilar y publicar KiramoPay con scripts\android\publicar.ps1.' -ForegroundColor Green
}
catch {
    Write-Alto $_
    Write-Host 'La preparacion no termino. Corrige lo indicado y vuelve a correr el script.' -ForegroundColor Yellow
    exit 1
}
