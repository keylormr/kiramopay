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
