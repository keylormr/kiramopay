# Android APK — build, sign and publish

GitHub Actions builds and signs two things from the same compilation, and
nothing needs a local Android toolchain:

- **`kiramopay.apk`** — attached to the GitHub Release. The website's login
  screen shows a **Download Android app** button pointing at the latest one, and
  the app updates itself from it.
- **`kiramopay.aab`** — the Android App Bundle, the only format Google Play
  accepts. It is kept as a workflow **artifact**, not attached to the release: a
  bundle cannot be installed, so on a download page it would only confuse
  someone who came for the APK.

## One-time setup

### 1. Generate a release keystore (do this once, keep it safe forever)

```bash
keytool -genkeypair -v \
  -keystore kiramopay-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias kiramopay
```

It asks for a keystore password, a key password and your name/org. **Back this
file up** — if you lose it you can never ship an update to the same app listing.

### 2. Base64-encode the keystore (to store it as a secret)

- Linux/macOS: `base64 -w0 kiramopay-release.jks > keystore.b64`
- Windows PowerShell:
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("kiramopay-release.jks")) | Out-File keystore.b64 -Encoding ascii`

### 3. Add repo secrets

GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the contents of `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `kiramopay` (the alias above) |
| `ANDROID_KEY_PASSWORD` | the key password |
| `LIVE_UPDATE_PRIVATE_KEY` | the private key that signs the in-app update package (see below) |

Then delete `kiramopay-release.jks` and `keystore.b64` from your machine's
working folders (keep the keystore only in your secure backup).

### 4. (Optional) API URL baked into the APK

The APK loads its assets locally, so it needs an **absolute** backend URL (the
`vercel.json` `/api` proxy does not apply inside the app). Default is
`https://kiramopay.com`. To change it, add a repo **variable** (not secret)
`APK_API_URL`.

### 5. Backend CORS (required for the app to reach the API)

The app runs under the Capacitor origin `https://app.kiramopay.com`
(`capacitor.config.ts`). Add that origin to `CORS_ORIGINS` on the Render
`kiramopay` service, e.g.:

```
CORS_ORIGINS=https://kiramopay.com,https://www.kiramopay.com,https://app.kiramopay.com
```

Native sign-in uses the OS secure token store (Authorization header), so the
cross-origin cookie limits of a WebView are not the blocker — but the API calls
still need this CORS allow-list entry.

## Cutting a release

1. Bump `versionCode` (must increase) and `versionName` in
   `android/app/build.gradle`.
2. Tag and push:
   ```bash
   git tag v2.0.1
   git push origin v2.0.1
   ```
3. The workflow builds and signs both outputs. It attaches `kiramopay.apk` to
   the `v2.0.1` release — the download button, which points at
   `releases/latest/download/kiramopay.apk`, then serves it automatically — and
   leaves `kiramopay.aab` as an artifact of that run.

Keep `versionCode` and the app's own version in step: `npm run check:version`
(the **Version Sync** job) fails the build if `package.json`, `versionName` and
the changelog entry in `src/config/version.ts` disagree.

To test a build without releasing, run the workflow manually from the Actions
tab — it produces both artifacts and publishes nothing.

## In-app updates (no new APK)

Every new version is mandatory: the app shows a full-screen barrier, above the
login, until it runs the published version. There are two ways through it, and
the release decides which one each phone takes:

- **Inside the app.** When the new version only changes the web layer (screens,
  texts, logic in `dist/`), the barrier downloads it by itself with a progress
  bar, verifies it and restarts the app already updated. No file in Downloads,
  no system installer. Plugin: `@capawesome/capacitor-live-update` 6.9.2
  (pinned, MIT), self-hosted; it never talks to Capawesome's servers.
- **APK.** When the native part changed (a plugin, the Capacitor version, a
  permission, Firebase), the web package cannot run on the old binary and the
  barrier offers the APK, as before. It is also the way out if the in-app update
  fails twice with the same version.

`scripts/paquete-web.mjs` runs after `npm run build` in both tag workflows and
attaches two files per platform to the release:

| File | Content |
|---|---|
| `kiramopay-web-<platform>.zip` | `dist/`, signed |
| `actualizacion-<platform>.json` | the signed manifest: version, minimum native build, signature of the zip |

The minimum native build is automatic: the script hashes the native layer
(tracked files under `android/` or `ios/` without the version lines,
`capacitor.config.ts`, exact versions of the native plugins, Firebase or not).
Same hash as the previous published release: the minimum is inherited. Changed,
or nothing to compare with: the minimum is this build, so the version goes by
APK. When in doubt, it always falls on the APK side.

Signatures are RSA-2048, PKCS#1 v1.5, SHA-256, with `LIVE_UPDATE_PRIVATE_KEY`.
The phone checks twice: the app verifies the manifest with WebCrypto before
downloading anything (`src/utils/paqueteFirmado.ts`), and the plugin verifies
the zip natively, before unzipping, with `plugins.LiveUpdate.publicKey` from
`capacitor.config.ts`. That key ships inside the binary and JavaScript cannot
change it: a zip without a valid signature is rejected even if foreign code
asks the plugin for it.

If the secret is missing or does not match that public key (or the step fails
for any other reason), the release still goes out with the APK and the AAB, but
without a package: that version installs by APK. The APK is the emergency exit
and does not depend on this step. The run ends red so it gets noticed.

The app only downloads a package from
`https://github.com/keylormr/kiramopay/releases/download/v<version>/kiramopay-web-<platform>.zip`.
Any other URL the server sends goes the APK way: the plugin never contacts
another host (it sends a device id with the download).

**Rotating the key** (only if the private key leaked): generate a new pair,
replace the secret and both copies of the public key (`capacitor.config.ts` and
`LLAVE_PUBLICA_PAQUETES`; a test keeps them equal). The native fingerprint
changes with `capacitor.config.ts`, so that version goes by APK; from then on,
in-app again.

If a new web package does not start (the app does not reach its first render
within the 20 s `readyTimeout`), the plugin goes back to the package inside the
APK and the app counts the failure; the second failure of the same version
offers the APK.

While the APK barrier is up the app asks again every minute: if the backend
answered without a package because of a transient failure (GitHub slow, a
5xx), the next answer brings it and the barrier switches to the in-app path.
The backend refresh that fills its cache no longer depends on the phone that
triggered it staying connected.

The first version that carries the plugin has to be installed by APK: binaries
up to 2.8.0 do not have it.

### Known limits (accepted, open to the owner)

- **Freshness.** The backend decides which version is the latest. Signatures
  stop foreign code, not an older signed version: a compromised backend could
  hold phones on a previous release that is still newer than the installed one.
- **`ready()` comes early.** The app confirms the package as soon as it first
  renders. A package that breaks later (after the login, on a lazy screen) is
  not rolled back by the plugin; the fix is a new release.
- **Restart mid-use.** A new version found when the app comes back to the
  foreground raises the barrier and restarts the app when the download ends,
  even with a form open. Idempotency keys prevent duplicated money operations.
- **The private key is a repository secret**, like the keystore. A GitHub
  environment limited to `v*` tags, with approval, would narrow who can use it.

## Uploading to Google Play

Play only accepts the **`.aab`**, and it comes from the artifacts of the run for
that tag, not from the release page:

1. Open the Actions run for the tag → **Artifacts** → download `kiramopay-aab`.
2. Play Console → your app → **Production** (or a testing track) → **Create new
   release** → upload `kiramopay.aab`.

Two things to know before the first upload:

- **`versionCode` must be higher than anything already uploaded**, forever. Play
  orders releases by that number, not by `versionName`.
- **Play App Signing re-signs the app** with a key Google holds. The keystore in
  this repo's secrets becomes the *upload* key: the one that proves the bundle
  comes from you. Losing it is recoverable through Play support; losing it
  before enrolling in Play App Signing is not.
