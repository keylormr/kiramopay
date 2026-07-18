# Android APK — build, sign and publish

The signed APK is built by GitHub Actions and published to GitHub Releases. The
website's login screen shows a **Download Android app** button that links to the
latest release asset. Nothing needs a local Android toolchain.

## Activate the workflow first (one-time)

The workflow ships as **`docs/android-apk.workflow.yml`** because the machine
that authored it has a git token without the `workflow` scope (GitHub blocks
pushing `.github/workflows/*` without it). To activate it, put that file at
`.github/workflows/android-apk.yml`, using either:

- **GitHub web UI:** Add file → Create new file → path
  `.github/workflows/android-apk.yml` → paste the contents of
  `docs/android-apk.workflow.yml` → commit. (The web UI is allowed to create
  workflows.)
- **or a local push from a machine whose token has the `workflow` scope:**
  `git mv docs/android-apk.workflow.yml .github/workflows/android-apk.yml`,
  commit and push.

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
3. The workflow builds + signs the APK and attaches `kiramopay.apk` to the
   `v2.0.1` release. The download button (which points at
   `releases/latest/download/kiramopay.apk`) then serves it automatically.

To test a build without releasing, run the workflow manually from the Actions
tab — it produces a downloadable `kiramopay-apk` artifact.
