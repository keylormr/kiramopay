<#
.SYNOPSIS
Compila, firma y publica una version de KiramoPay para Android desde una PC, sin GitHub Actions.

.DESCRIPTION
Hace lo que hacia el flujo .github/workflows/android-apk.yml, con las mismas revisiones:

  1. Compila SIEMPRE lo integrado en main. Baja la ultima version de main a una carpeta aparte
     (git worktree), asi que no importa en que rama ni con que cambios este tu copia: nunca sale una
     version con algo que no este integrado.
  2. Revisa que la version diga lo mismo en todos los archivos (scripts/check-version-sync.mjs) y que
     no este publicada todavia.
  3. Revisa que ningun flujo de GitHub se dispare con una etiqueta: la version se compila aqui, y
     empujar la etiqueta no puede compilar nada en GitHub.
  4. Arma las notas de la version, la capa web (npm run build) y el paquete firmado de la
     actualizacion interna (scripts/paquete-web.mjs).
  5. Compila el APK firmado y, aparte, el AAB para Google Play con la marca de su canal, y revisa
     que cada uno lleve el canal que le toca.
  6. Comprueba que la firma del APK sea la de KiramoPay (la huella de comun.ps1). Si no lo es, se
     detiene: nunca publica un APK con otra llave.
  7. Guarda todo en Documentos\KiramoPay\<version>, muestra el resumen y solo publica si escribes
     PUBLICAR.
  8. Publica: etiqueta anotada, release en GitHub con las notas, despues el paquete interno y al
     final el APK. El servidor ofrece la version recien cuando ve el APK, y para entonces las notas y
     el paquete ya tienen que estar.

Lo que se pide la primera vez (las contrasenas y la llave de Breez no se ven al escribirlas):
  - la llave de firma (kiramopay-release.jks), su contrasena y su alias (kiramopay);
  - el google-services.json de Firebase (proyecto kiramopay), para los avisos del telefono;
  - la llave de la API de Breez, para bitcoin;
  - el archivo .pem con la llave privada de la actualizacion interna. Sin ella, o con
    -SinActualizacionInterna, la version sale solo con el APK y los telefonos la instalan por APK.
Cuando ya se comprobo que sirven, el script ofrece guardarlas en %LOCALAPPDATA%\KiramoPay\claves.json,
cifradas con tu usuario de Windows (DPAPI). Ese archivo solo se puede abrir con la misma sesion de
Windows en la misma PC: copiado a otro lado no sirve. Para borrarlas: publicar.ps1 -OlvidarClaves.

iOS no se compila aqui: el .ipa necesita una Mac.

Requisito: haber corrido scripts\android\preparar-pc.ps1 una vez en esta PC.

.PARAMETER Ensayo
Hace todo (compilacion, firma con la llave real y revisiones) pero NO publica nada.

.PARAMETER SinFirma
Solo con -Ensayo: prueba la PC sin pedir ninguna clave. Compila el APK y el AAB sin firmar, sin
Breez, sin avisos y sin paquete interno. Lo que sale no se puede instalar encima de la app ni
publicar: sirve para saber que la PC compila.

.PARAMETER SinActualizacionInterna
Publica solo el APK, sin el paquete de la actualizacion interna: cada telefono instala la version
por APK.

.PARAMETER Rama
Solo con -Ensayo: prueba otra rama de GitHub (por ejemplo la de un PR) en lugar de main.

.PARAMETER OlvidarClaves
Borra las claves guardadas en esta PC y termina. La proxima corrida las vuelve a pedir.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\android\publicar.ps1 -Ensayo -SinFirma

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\android\publicar.ps1 -Ensayo

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\android\publicar.ps1
#>
[CmdletBinding()]
param(
    [switch]$Ensayo,
    [switch]$SinFirma,
    [switch]$SinActualizacionInterna,
    [string]$Rama = 'main',
    [switch]$OlvidarClaves
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
. (Join-Path $PSScriptRoot 'comun.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ArchivoClaves = Join-Path $script:Raiz 'claves.json'

# Lo que se hornea en la capa web, igual que en android-apk.yml.
$ApiUrl = 'https://api.kiramopay.com'
$ApkUrl = "https://github.com/$($script:Repositorio)/releases/latest/download/kiramopay.apk"
$DominioLightning = 'pay.kiramopay.com'

if ($OlvidarClaves) {
    if (Test-Path $ArchivoClaves) { Remove-Item -Force $ArchivoClaves; Write-Host "Claves borradas de esta PC ($ArchivoClaves)." }
    else { Write-Host 'No habia claves guardadas en esta PC.' }
    exit 0
}

function ConvertTo-TextoPlano([Security.SecureString]$seguro) {
    $puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero) }
}

function Read-SecretoSeguro([string]$pregunta) {
    $valor = Read-Host -Prompt $pregunta -AsSecureString
    if ($valor.Length -eq 0) { Stop-ConMensaje "No se escribio: $pregunta." }
    return $valor
}

function Read-Ruta([string]$pregunta) {
    $ruta = (Read-Host -Prompt $pregunta).Trim('"', ' ')
    if (-not $ruta -or -not (Test-Path -PathType Leaf $ruta)) { Stop-ConMensaje "No existe el archivo: '$ruta'." }
    return (Resolve-Path $ruta).Path
}

# Claves guardadas en esta PC. Los secretos van cifrados con DPAPI (ConvertFrom-SecureString sin -Key):
# solo los descifra el mismo usuario de Windows en la misma PC. Las rutas y el alias no son secretos y
# van en claro.
$CamposEnClaro = @('llave', 'alias', 'googleServices')
$CamposSecretos = @('almacen', 'clave', 'breez', 'actualizacion')

function Get-ClavesGuardadas {
    $r = @{}
    if (-not (Test-Path $ArchivoClaves)) { return $r }
    try {
        $j = Get-Content -Raw -Path $ArchivoClaves | ConvertFrom-Json
        foreach ($campo in $CamposEnClaro) {
            if ($j.PSObject.Properties[$campo] -and $j.$campo) { $r[$campo] = [string]$j.$campo }
        }
        foreach ($campo in $CamposSecretos) {
            if ($j.PSObject.Properties[$campo] -and $j.$campo) { $r[$campo] = ConvertTo-SecureString -String $j.$campo }
        }
    }
    catch {
        Stop-ConMensaje "No se pudieron leer las claves guardadas en $ArchivoClaves (quizas se guardaron con otro usuario de Windows o en otra PC). Corre publicar.ps1 -OlvidarClaves y vuelve a escribirlas."
    }
    return $r
}

function Save-Claves([hashtable]$claves) {
    $datos = [ordered]@{ guardado = (Get-Date -Format 'yyyy-MM-dd HH:mm') }
    foreach ($campo in $CamposEnClaro) { if ($claves.ContainsKey($campo)) { $datos[$campo] = $claves[$campo] } }
    foreach ($campo in $CamposSecretos) {
        if ($claves.ContainsKey($campo)) { $datos[$campo] = ConvertFrom-SecureString -SecureString $claves[$campo] }
    }
    New-Item -ItemType Directory -Path $script:Raiz -Force | Out-Null
    Set-Content -Path $ArchivoClaves -Value ($datos | ConvertTo-Json) -Encoding UTF8
}

# Corre un programa y se detiene si falla. En Windows PowerShell 5.1, con 'Stop', lo que un programa
# escribe en la salida de error (npm y Gradle escriben avisos ahi) puede volverse una excepcion aunque
# termine bien: se corre con 'Continue' y se decide por el codigo de salida.
function Invoke-Programa([string]$programa, [string[]]$argumentos, [string]$siFalla) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $programa @argumentos; $codigo = $LASTEXITCODE }
    finally { $ErrorActionPreference = $anterior }
    if ($codigo -ne 0) { Stop-ConMensaje "$siFalla (codigo de salida $codigo)." }
}

# Igual, pero devuelve lo que el programa escribio.
function Get-SalidaDe([string]$programa, [string[]]$argumentos) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $texto = & $programa @argumentos 2>&1 | Out-String; $codigo = $LASTEXITCODE }
    finally { $ErrorActionPreference = $anterior }
    return @{ Texto = $texto; Codigo = $codigo }
}

# Si el bloque on: de un flujo lo dispararia la etiqueta o el release. Ante la duda, si: un push sin
# filtro de ramas tambien corre con las etiquetas, y un bloque on: que no se entiende no se da por bueno.
function Test-DisparoPorEtiqueta([string]$texto) {
    $texto = $texto -replace "`r", ''
    $m = [regex]::Match($texto, '(?ms)^["'']?on["'']?:(.*?)(?=^[^\s#]|\z)')
    if (-not $m.Success) { return $true }
    $lineas = @($m.Groups[1].Value -split "`n" | ForEach-Object { ($_ -replace '\s#.*$', '') } | Where-Object { $_ -notmatch '^\s*#' })
    # Lo que va en la misma linea de on: (on: push, on: [push, release]).
    $enLinea = $lineas[0]
    $bloque = $lineas -join "`n"
    $evento = { param($nombre) ($enLinea -match "\b$nombre\b") -or ($bloque -match "(?m)^\s+$($nombre):") -or ($bloque -match "(?m)^\s*-\s*$nombre\s*$") }
    if ((& $evento 'release') -or (& $evento 'create') -or ($bloque -match '(?m)^\s+tags(-ignore)?\s*:')) { return $true }
    if ((& $evento 'push') -and $bloque -notmatch '(?m)^\s+branches(-ignore)?\s*:') { return $true }
    return $false
}

function Get-VersionDe([string]$etiqueta) {
    if ($etiqueta -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { return $null }
    return [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
}

# El texto de un archivo dentro de un .zip (el APK y el AAB lo son), o $null si no esta.
function Get-TextoEnZip([string]$zip, [string]$entrada) {
    $archivo = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $e = $archivo.GetEntry($entrada)
        if ($null -eq $e) { return $null }
        $lector = New-Object IO.StreamReader($e.Open())
        try { return $lector.ReadToEnd() } finally { $lector.Dispose() }
    }
    finally { $archivo.Dispose() }
}

# Borra la copia temporal de main (y su registro en git) si quedo de una corrida anterior o de esta.
function Remove-CopiaTemporal([string]$repo, [string]$ruta) {
    if (-not (Test-Path $ruta)) { return }
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git -C $repo worktree remove --force $ruta 2>$null
    if (Test-Path $ruta) {
        # node_modules tiene rutas largas que Remove-Item no siempre borra; robocopy con una carpeta vacia si.
        $vacia = Join-Path ([IO.Path]::GetTempPath()) ("kiramopay-vacia-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $vacia | Out-Null
        & robocopy.exe $vacia $ruta /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        Remove-Item -Recurse -Force $vacia, $ruta -ErrorAction SilentlyContinue
    }
    & git -C $repo worktree prune 2>$null
    $ErrorActionPreference = $anterior
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$temporal = $null
$codigoSalida = 0
$variables = @('KIRAMOPAY_KEYSTORE_FILE', 'KIRAMOPAY_KEYSTORE_PASSWORD', 'KIRAMOPAY_KEY_ALIAS', 'KIRAMOPAY_KEY_PASSWORD',
    'LIVE_UPDATE_PRIVATE_KEY', 'VITE_API_URL', 'VITE_ANDROID_APK_URL', 'VITE_BREEZ_API_KEY', 'VITE_BREEZ_LNURL_DOMAIN', 'VITE_PUSH_NATIVO')

try {
    Test-ArquitecturaSoportada
    if ($SinFirma -and -not $Ensayo) { Stop-ConMensaje '-SinFirma solo sirve con -Ensayo: una version sin firma no se publica.' }
    if ($Rama -notmatch '^[A-Za-z0-9._/-]+$' -or $Rama -match '\.\.') { Stop-ConMensaje "Nombre de rama no valido: '$Rama'." }
    if ($Rama -ne 'main' -and -not $Ensayo) { Stop-ConMensaje "Solo se publica desde main. Para probar la rama $Rama, agrega -Ensayo." }
    $conPaquete = -not ($SinFirma -or $SinActualizacionInterna)

    Write-Paso 'Herramientas de esta PC'
    $apksigner = Join-Path $script:RutaSdk "build-tools\$($script:VersionBuildTools)\apksigner.bat"
    foreach ($necesario in @((Join-Path $script:RutaJava 'bin\java.exe'), $apksigner, (Join-Path $script:RutaSdk 'platforms\android-36'))) {
        if (-not (Test-Path $necesario)) { Stop-ConMensaje "Falta $necesario. Corre primero scripts\android\preparar-pc.ps1." }
    }
    foreach ($programa in 'git', 'node', 'npm', 'gh') {
        if (-not (Get-Command $programa -ErrorAction SilentlyContinue)) { Stop-ConMensaje "Falta $programa. Corre primero scripts\android\preparar-pc.ps1." }
    }
    Set-EntornoHerramientas
    Write-Host "Java, el SDK de Android, git, Node, npm y gh estan instalados ($($script:Herramientas))."

    Write-Paso "Ultima version de $Rama en GitHub"
    $origen = (& git -C $repo remote get-url origin).Trim()
    if ($origen -notmatch "github\.com[:/]$([regex]::Escape($script:Repositorio))(\.git)?$") {
        Stop-ConMensaje "Este script se corre desde una copia de $($script:Repositorio); esta copia apunta a $origen."
    }
    Invoke-Programa git @('-C', $repo, 'fetch', '--quiet', 'origin', "+refs/heads/$($Rama):refs/remotes/origin/$Rama") "No se pudo traer $Rama desde GitHub (git fetch)"
    # Ruta corta y fija: las compilaciones de Android en Windows fallan con rutas de mas de 260 caracteres.
    $temporal = Join-Path $script:Raiz 'compilacion'
    Remove-CopiaTemporal $repo $temporal
    New-Item -ItemType Directory -Path $script:Raiz -Force | Out-Null
    Invoke-Programa git @('-C', $repo, 'worktree', 'add', '--quiet', '--detach', $temporal, "origin/$Rama") "No se pudo preparar la copia temporal de $Rama (git worktree)"
    $commit = (& git -C $temporal rev-parse HEAD).Trim()
    $titulo = (& git -C $temporal log -1 --format=%s).Trim()
    Write-Host "Repositorio: $origen"
    Write-Host "Commit de $($Rama): $($commit.Substring(0, 8))  $titulo"

    Push-Location $temporal
    try {
        Write-Paso 'Version'
        Invoke-Programa node @('scripts/check-version-sync.mjs') 'La version no dice lo mismo en todos los archivos'
        $version = (Get-Content -Raw -Path 'package.json' | ConvertFrom-Json).version
        $etiqueta = "v$version"
        $versionCode = [int]([regex]::Match((Get-Content -Raw -Path 'android\app\build.gradle'), 'versionCode\s+(\d+)').Groups[1].Value)
        Write-Host "Version $version (versionCode $versionCode), etiqueta $etiqueta"

        # Empujar la etiqueta no puede compilar nada en GitHub.
        foreach ($flujo in Get-ChildItem -Path '.github\workflows' -Include '*.yml', '*.yaml' -Recurse) {
            if (Test-DisparoPorEtiqueta (Get-Content -Raw -Path $flujo.FullName)) {
                Stop-ConMensaje "El flujo $($flujo.Name) se dispara con una etiqueta o un release: publicar lo haria correr en GitHub. Quitale ese disparo antes de publicar."
            }
        }
        Write-Host 'Ningun flujo de GitHub se dispara con la etiqueta ni con el release.'

        if (-not $Ensayo) {
            $sesion = Get-SalidaDe gh @('auth', 'status')
            if ($sesion.Codigo -ne 0) { Stop-ConMensaje 'gh no tiene sesion en GitHub. Corre gh auth login y vuelve a intentar.' }
            $remota = (& git ls-remote --tags origin "refs/tags/$etiqueta" | Out-String).Trim()
            if ($remota) { Stop-ConMensaje "La etiqueta $etiqueta ya existe en GitHub: esa version ya se publico o quedo a medias. Para otra version, sube el numero en un PR." }
            $ultima = Get-SalidaDe gh @('release', 'view', '-R', $script:Repositorio, '--json', 'tagName', '--jq', '.tagName')
            if ($ultima.Codigo -eq 0) {
                $vUltima = Get-VersionDe $ultima.Texto.Trim()
                if ($vUltima -and $vUltima -ge (Get-VersionDe $etiqueta)) {
                    Stop-ConMensaje "La ultima version publicada es $($ultima.Texto.Trim()) y main tiene la ${etiqueta}: no hay nada nuevo que publicar."
                }
                Write-Host "Ultima publicada: $($ultima.Texto.Trim())."
            }
        }

        $guardadas = Get-ClavesGuardadas
        $claves = @{}
        foreach ($k in $guardadas.Keys) { $claves[$k] = $guardadas[$k] }
        $hayNuevas = $false
        if ($guardadas.Count -gt 0) { Write-Host "Se usan las claves guardadas en esta PC ($ArchivoClaves, cifradas con tu usuario de Windows)." }

        if (-not $SinFirma) {
            Write-Paso 'Claves'
            if (-not $claves.ContainsKey('llave')) { $claves['llave'] = Read-Ruta 'Ruta de kiramopay-release.jks (la llave de firma)'; $hayNuevas = $true }
            if (-not (Test-Path -PathType Leaf $claves['llave'])) { Stop-ConMensaje "No existe la llave de firma guardada: $($claves['llave'])" }
            if (-not $claves.ContainsKey('almacen')) { $claves['almacen'] = Read-SecretoSeguro 'Contrasena de la llave de firma'; $hayNuevas = $true }
            if (-not $claves.ContainsKey('alias')) {
                $alias = (Read-Host -Prompt 'Alias de la llave (Enter: kiramopay)').Trim()
                $claves['alias'] = if ($alias) { $alias } else { 'kiramopay' }
                $hayNuevas = $true
            }
            if (-not $claves.ContainsKey('clave')) {
                # En un .jks PKCS12 la contrasena de la llave es la misma del almacen.
                $otra = Read-Host -Prompt 'Contrasena de la llave dentro del almacen (Enter: la misma)' -AsSecureString
                $claves['clave'] = if ($otra.Length -gt 0) { $otra } else { $claves['almacen'] }
                $hayNuevas = $true
            }
            if (-not $claves.ContainsKey('googleServices')) {
                $claves['googleServices'] = Read-Ruta 'Ruta del google-services.json de Firebase (proyecto kiramopay)'
                $hayNuevas = $true
            }
            if (-not (Test-Path -PathType Leaf $claves['googleServices'])) { Stop-ConMensaje "No existe el google-services.json guardado: $($claves['googleServices'])" }
            if (-not $claves.ContainsKey('breez')) { $claves['breez'] = Read-SecretoSeguro 'Llave de la API de Breez'; $hayNuevas = $true }
            if ($conPaquete -and -not $claves.ContainsKey('actualizacion')) {
                $pem = Read-Ruta 'Ruta del .pem con la llave privada de la actualizacion interna (o corre con -SinActualizacionInterna)'
                $claves['actualizacion'] = ConvertTo-SecureString -String (Get-Content -Raw -Path $pem) -AsPlainText -Force
                $hayNuevas = $true
            }

            Copy-Item -Path $claves['googleServices'] -Destination 'android\app\google-services.json' -Force
            $env:VITE_PUSH_NATIVO = '1'
            $env:VITE_BREEZ_API_KEY = ConvertTo-TextoPlano $claves['breez']
        }
        else {
            Write-Host ''
            Write-Host 'Ensayo sin firma: sin llave, sin Breez, sin avisos y sin paquete interno. Lo que sale solo prueba que la PC compila.' -ForegroundColor Yellow
        }
        $env:VITE_API_URL = $ApiUrl
        $env:VITE_ANDROID_APK_URL = $ApkUrl
        $env:VITE_BREEZ_LNURL_DOMAIN = $DominioLightning

        Write-Paso 'Dependencias (npm ci)'
        Invoke-Programa npm @('ci', '--no-audit', '--no-fund') 'npm ci fallo'

        Write-Paso 'Notas de la version'
        Invoke-Programa node @('scripts/notas-de-version.mjs', $etiqueta) 'No se pudieron armar las notas'

        Write-Paso 'Capa web (npm run build)'
        Invoke-Programa npm @('run', 'build') 'La capa web no compilo'

        # Antes de cap sync, que reescribe archivos de android/ que entran en la huella de lo nativo.
        if ($conPaquete) {
            Write-Paso 'Paquete de la actualizacion interna'
            $env:LIVE_UPDATE_PRIVATE_KEY = ConvertTo-TextoPlano $claves['actualizacion']
            try {
                Invoke-Programa node @('scripts/paquete-web.mjs', 'android', $etiqueta) ('No se armo el paquete de la actualizacion interna. Si la llave no ' +
                    'corresponde a la de capacitor.config.ts, ningun telefono lo aceptaria. Para publicar solo el APK, corre con -SinActualizacionInterna')
            }
            finally { Remove-Item -Path 'Env:LIVE_UPDATE_PRIVATE_KEY' -ErrorAction SilentlyContinue }
        }

        Write-Paso 'Capacitor sync (android)'
        Invoke-Programa npx @('cap', 'sync', 'android') 'cap sync android fallo'

        if (-not $SinFirma) {
            $env:KIRAMOPAY_KEYSTORE_FILE = $claves['llave']
            $env:KIRAMOPAY_KEYSTORE_PASSWORD = ConvertTo-TextoPlano $claves['almacen']
            $env:KIRAMOPAY_KEY_ALIAS = $claves['alias']
            $env:KIRAMOPAY_KEY_PASSWORD = ConvertTo-TextoPlano $claves['clave']
        }

        $pista = ''
        if ($guardadas.Count -gt 0) { $pista = ' Si el error habla de la llave o de una contrasena, puede que las claves guardadas ya no sirvan: corre publicar.ps1 -OlvidarClaves y vuelve a escribirlas.' }

        # Primero el APK, tal cual sale del sync; despues la marca de Google Play; despues el AAB
        # (src/utils/canalDeDistribucion.ts).
        Write-Paso 'APK (la primera vez Gradle baja sus dependencias y tarda mas)'
        Push-Location 'android'
        try { Invoke-Programa '.\gradlew.bat' @('assembleRelease', '--no-daemon', '--console=plain') "El APK no compilo.$pista" }
        finally { Pop-Location }
        $nombreApk = if ($SinFirma) { 'app-release-unsigned.apk' } else { 'app-release.apk' }
        $apkCompilado = Join-Path $temporal "android\app\build\outputs\apk\release\$nombreApk"
        if (-not (Test-Path $apkCompilado)) { Stop-ConMensaje "No aparecio el APK en $apkCompilado." }
        $apk = Join-Path $temporal 'kiramopay.apk'
        Copy-Item -Path $apkCompilado -Destination $apk -Force

        Write-Paso 'AAB para Google Play'
        Invoke-Programa node @('scripts/marcar-canal.mjs', 'play') 'No se pudo marcar el canal de Google Play'
        Push-Location 'android'
        try { Invoke-Programa '.\gradlew.bat' @('bundleRelease', '--no-daemon', '--console=plain') "El AAB no compilo.$pista" }
        finally { Pop-Location }
        $aab = Join-Path $temporal 'kiramopay.aab'
        Copy-Item -Path (Join-Path $temporal 'android\app\build\outputs\bundle\release\app-release.aab') -Destination $aab -Force

        Write-Paso 'Canal de cada binario'
        $marca = 'KiramoPayCanal/play'
        $configAab = Get-TextoEnZip $aab 'base/assets/capacitor.config.json'
        $configApk = Get-TextoEnZip $apk 'assets/capacitor.config.json'
        if ($null -eq $configAab -or -not $configAab.Contains($marca)) { Stop-ConMensaje 'El AAB no lleva la marca del canal de Google Play.' }
        if ($null -eq $configApk -or $configApk.Contains($marca)) { Stop-ConMensaje 'El APK lleva la marca del canal de Google Play (o no trae su configuracion): no debe.' }
        Write-Host 'AAB con la marca de Play; APK sin marca.'

        if (-not $SinFirma) {
            Write-Paso 'Firma del APK'
            $firma = Get-SalidaDe $apksigner @('verify', '--print-certs', $apk)
            if ($firma.Codigo -ne 0) { Stop-ConMensaje "apksigner no pudo verificar el APK: $($firma.Texto)" }
            $mHuella = [regex]::Match($firma.Texto, 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
            if (-not $mHuella.Success) { Stop-ConMensaje "apksigner no informo la huella de la firma: $($firma.Texto)" }
            $huella = $mHuella.Groups[1].Value.ToLowerInvariant()
            if ($huella -ne $script:HuellaFirma) {
                Stop-ConMensaje "El APK salio firmado con otra llave ($huella). La de KiramoPay es $($script:HuellaFirma). No se publica nada."
            }
            Write-Host 'La firma es la de KiramoPay.'

            # Recien aqui se sabe que las claves sirven: la firma salio con la llave de KiramoPay y, si se
            # pidio, la llave del paquete interno corresponde a la de capacitor.config.ts.
            if ($hayNuevas) {
                Write-Host ''
                Write-Host "Las claves funcionaron. Se pueden guardar en $ArchivoClaves, cifradas con tu usuario de Windows,"
                Write-Host 'para no volver a escribirlas en esta PC. Copiado a otra PC o a otro usuario, ese archivo no sirve.'
                if ((Read-Host -Prompt 'Escribe GUARDAR para guardarlas (cualquier otra cosa: no guardar)') -ceq 'GUARDAR') {
                    Save-Claves $claves
                    Write-Host 'Claves guardadas. Para borrarlas: publicar.ps1 -OlvidarClaves'
                }
                else { Write-Host 'No se guardaron: la proxima vez se vuelven a pedir.' }
            }
        }

        Write-Paso 'Copia en Documentos'
        $sufijo = if ($SinFirma) { '-ensayo-sin-firma' } elseif ($Ensayo) { '-ensayo' } else { '' }
        $salida = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "KiramoPay\$version$sufijo"
        if (Test-Path $salida) { Remove-Item -Recurse -Force $salida }
        New-Item -ItemType Directory -Path $salida -Force | Out-Null
        $adjuntos = @('notas.json', 'notas-de-version.md', 'kiramopay.apk', 'kiramopay.aab')
        if ($conPaquete) { $adjuntos += @('kiramopay-web-android.zip', 'actualizacion-android.json') }
        $sumas = @()
        foreach ($a in $adjuntos) {
            $origenArchivo = Join-Path $temporal $a
            if (-not (Test-Path $origenArchivo)) { Stop-ConMensaje "Falta $a despues de compilar." }
            Copy-Item -Path $origenArchivo -Destination $salida -Force
            $sumas += '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -Path (Join-Path $salida $a)).Hash.ToLowerInvariant(), $a
        }
        Set-Content -Path (Join-Path $salida 'sha256.txt') -Value $sumas -Encoding ASCII
        Write-Host "Todo quedo en $salida"
        $sumas | ForEach-Object { Write-Host "  $_" }

        if ($Ensayo) {
            Write-Host ''
            $que = if ($SinFirma) { 'compila (sin firma)' } else { 'compila y sale con la firma de KiramoPay' }
            Write-Host "Ensayo terminado sin errores: la version $version $que. No se publico nada." -ForegroundColor Green
        }
        else {
            Write-Paso 'Confirmacion'
            Write-Host "Se va a publicar en GitHub ($($script:Repositorio)):"
            Write-Host "  Version $version (versionCode $versionCode), commit $($commit.Substring(0, 8)) de main"
            $alRelease = @($adjuntos | Where-Object { $_ -ne 'kiramopay.aab' -and $_ -ne 'notas-de-version.md' })
            Write-Host "  Etiqueta anotada $etiqueta y release con: $($alRelease -join ', ')"
            if (-not $conPaquete) { Write-Host '  Sin paquete interno: cada telefono instala esta version por APK.' -ForegroundColor Yellow }
            Write-Host '  El AAB no se publica: queda en la carpeta de arriba para subirlo a Google Play.'
            $respuesta = Read-Host -Prompt 'Escribe PUBLICAR para publicarla (cualquier otra cosa cancela)'
            if ($respuesta -cne 'PUBLICAR') { Stop-ConMensaje 'Cancelado: no se publico nada.' }

            Write-Paso 'Publicacion'
            Invoke-Programa git @('-C', $repo, 'tag', '-a', $etiqueta, '-m', "KiramoPay $version", $commit) "No se pudo crear la etiqueta $etiqueta"
            Invoke-Programa git @('-C', $repo, 'push', 'origin', "refs/tags/$etiqueta") "No se pudo empujar la etiqueta $etiqueta"
            $faltan = "Quedo a medias: la etiqueta $etiqueta ya esta en GitHub. Revisa el release en https://github.com/$($script:Repositorio)/releases/tag/$etiqueta y sube lo que falte con gh release upload, el APK al final"
            Invoke-Programa gh @('release', 'create', $etiqueta, '-R', $script:Repositorio, '--verify-tag', '--title', $etiqueta,
                '--notes-file', (Join-Path $salida 'notas-de-version.md'), (Join-Path $salida 'notas.json')) $faltan
            if ($conPaquete) {
                Invoke-Programa gh @('release', 'upload', $etiqueta, '-R', $script:Repositorio,
                    (Join-Path $salida 'kiramopay-web-android.zip'), (Join-Path $salida 'actualizacion-android.json')) $faltan
            }
            Invoke-Programa gh @('release', 'upload', $etiqueta, '-R', $script:Repositorio, (Join-Path $salida 'kiramopay.apk')) $faltan

            $publicados = (Get-SalidaDe gh @('release', 'view', $etiqueta, '-R', $script:Repositorio, '--json', 'assets', '--jq', '.assets[].name')).Texto
            foreach ($a in $adjuntos | Where-Object { $_ -ne 'kiramopay.aab' -and $_ -ne 'notas-de-version.md' }) {
                if ($publicados -notmatch [regex]::Escape($a)) { Stop-ConMensaje "El release no muestra $a. $faltan." }
            }

            New-Item -ItemType Directory -Path $script:Raiz -Force | Out-Null
            $linea = '{0}  version {1} (versionCode {2})  commit {3}  apk {4}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $version, $versionCode, $commit,
                (Get-FileHash -Algorithm SHA256 -Path (Join-Path $salida 'kiramopay.apk')).Hash.ToLowerInvariant()
            Add-Content -Path $script:Bitacora -Value $linea -Encoding UTF8
            Write-Host ''
            Write-Host "Publicada la version $version en https://github.com/$($script:Repositorio)/releases/tag/$etiqueta" -ForegroundColor Green
            Write-Host 'El servidor guarda la respuesta unos minutos: los telefonos la ven en un rato, no al instante.'
        }
    }
    finally { Pop-Location }
}
catch {
    Write-Alto $_
    Write-Host 'No se publico nada mas alla de lo que diga el mensaje de arriba.' -ForegroundColor Yellow
    $codigoSalida = 1
}
finally {
    foreach ($v in $variables) { Remove-Item -Path "Env:$v" -ErrorAction SilentlyContinue }
    if ($temporal) { Remove-CopiaTemporal $repo $temporal }
}
exit $codigoSalida
