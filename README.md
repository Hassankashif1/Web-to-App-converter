# Web to App Builder — Build Server

Turn any website URL into a real installable app — Android `.apk`, an iOS
Xcode project, and a Windows desktop `.exe` — from a single local dashboard.
No WordPress, no login, no cloud account. You configure the app, click
**Generate Build**, and a background worker on your own machine does the
actual native build (Capacitor + Gradle for mobile, Electron + electron-builder
for desktop).

```
Dashboard (Next.js, localhost:4000)  →  data/jobs.json  →  worker.js (polls, builds)  →  public/downloads/*
```

## Features

- **One form, three platforms** — Website URL, app name, icon, and a fully
  configurable preloader (logo, background, spinner/dots/pulse *or* logo-itself
  animations, colors, sizes, minimum on-screen duration) generate an Android
  APK, an iOS Xcode project, and a Windows installer in one go.
- **Live Preview** — a phone mockup shows exactly what the preloader will look
  like, plus a mobile-home-screen and desktop-taskbar icon preview, before you
  build anything.
- **Build Queue** — every build gets its own card with independent
  Android / iOS / Desktop status tabs. Any single platform can be
  **regenerated** on its own (e.g. redo just the Desktop build) without
  rebuilding the others.
- **No login, no shared history** — each browser gets a random local id
  (`localStorage`, no account), so the Build Queue only ever shows builds made
  from that browser. Nothing is sent anywhere for this — it's a display filter
  over the same local `data/jobs.json`.
- **Light/dark theme**, remembered per browser.

## What you actually get per platform

| Platform | Output | Notes |
|---|---|---|
| Android | Real, installable `.apk` | Built with an actual Gradle invocation — not a mock. |
| iOS | Xcode project (`.zip`) | **Not a signed `.ipa`.** Apple requires a real Mac + Xcode + a developer signing identity — that can't be automated on Windows/Linux by any tool. Unzip on a Mac, open in Xcode, set your team, then Product → Archive. |
| Desktop (Windows) | Real `.exe` installer | Built with electron-builder, right here, if the worker runs on Windows. |
| Desktop (macOS/Linux) | Source project (`.zip`) | Unzip on that OS and run `npm install && npm run dist` — Apple/Linux packaging tools aren't available on a Windows build server either. |

## Prerequisites

Install these on the machine that will run the worker:

1. **Node.js 18+**
2. **JDK 21** — the Capacitor Android module specifically requires 21 (not
   17). Check with `java -version`; if it's not 21+, install one (e.g.
   [Eclipse Temurin 21](https://adoptium.net/)) and point `JAVA_HOME` at it in
   `.env.local` (see below) rather than changing your system default.
3. **Android SDK** — either install Android Studio once and note the SDK path
   (Settings → Languages & Frameworks → Android SDK), or install just the
   [command-line tools](https://developer.android.com/studio#command-line-tools-only)
   and run:
   ```
   sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
   sdkmanager --licenses
   ```
4. **(Windows only, for Desktop builds)** electron-builder needs to create
   symbolic links while packaging, which Windows blocks by default outside
   Developer Mode. One-time fix — open **Settings → Privacy & Security → For
   Developers** and turn on **Developer Mode**. Without this, Android/iOS
   builds work fine but the Desktop build step fails with a
   `Cannot create symbolic link` error.

iOS `.ipa` and macOS/Linux desktop installers need a Mac — see the table
above, there's no way around that on any build server.

## Quick start

```bash
git clone <this-repo-url>
cd wta-build-server
npm install
cp .env.example .env.local
```

Edit `.env.local` — for local-only use you only need:

```env
ANDROID_HOME=/path/to/your/Android/Sdk
JAVA_HOME=/path/to/a/jdk-21          # only if `java -version` isn't already 21+
```

(`WP_SITE_URL` / `WTA_API_KEY` are optional — only needed for the WordPress
plugin integration, see [SETUP.md](./SETUP.md).)

Run it — **two terminals**, both from this folder:

```bash
# Terminal 1 — dashboard + API
npm run dev

# Terminal 2 — the actual builder (Capacitor, Gradle, electron-builder)
npm run worker
```

Open **http://localhost:4000**, fill in a website URL, click **Generate
Build**, and switch to the **Build Queue** tab to watch it go from `pending` →
`building` → `complete`. The first build is slow (installing Capacitor +
downloading Gradle/Electron, several minutes); later builds are much faster.

## How it works

- `app/page.js` — the dashboard UI (builder form + build queue), a Next.js
  client component. Talks only to this app's own API routes, never anything
  external.
- `app/api/*` — submit a build, list/retry/regenerate/delete jobs, upload an
  image, and (optionally) receive a WordPress webhook.
- `data/jobs.json` — the entire job queue/history, a flat JSON file (no
  database). Both `npm run dev` and `npm run worker` read/write it directly,
  which is why they must run from the same folder.
- `worker.js` — polls `data/jobs.json` for pending work and runs the real
  builds via `lib/capacitorBuilder.js` (Android/iOS) and
  `lib/electronBuilder.js` (Desktop). One build at a time.
- `builds/<jobId>/` — scratch workspace per job (deleted/recreated on each
  build). `public/downloads/` — the finished files the dashboard links to.

## Troubleshooting

- **Job stuck on `pending` forever** — `npm run worker` isn't running, or
  it's running from a different folder than `npm run dev` (they must share
  the same `data/jobs.json`).
- **Android build fails with `invalid source release: 21`** — your `java`
  on PATH is older than 21. Set `JAVA_HOME` in `.env.local` to a JDK 21
  install and restart the worker.
- **Desktop build fails with `Cannot create symbolic link`** — enable
  Windows Developer Mode (see Prerequisites above), then retry.
- **Gradle step fails for another reason** — almost always `ANDROID_HOME` is
  wrong or the SDK licenses weren't accepted; the worker's terminal prints
  the last lines of Gradle's own error.
- **App loads a blank/broken page in the WebView** — the Website URL needs a
  scheme; the dashboard auto-adds `https://` if you forget it, but double
  check the site itself loads over HTTPS without a redirect loop.

## Running it somewhere other than your own PC

Vercel/Render/Railway-style serverless hosts **can't** run this — see "How it
works" above for why (persistent worker, real filesystem, native build
tools). For a genuinely free, always-on option, see
[DEPLOY.md](./DEPLOY.md) — it sets up an Oracle Cloud "Always Free" VM
(4 CPU / 24GB RAM, free forever) with one setup script.

## Optional: WordPress plugin integration

This server also exposes `POST /api/webhook` so the companion WordPress
plugin can queue builds instead of (or alongside) the dashboard form. That
path needs `WP_SITE_URL` / `WTA_API_KEY` set and matching the plugin's
settings — see [SETUP.md](./SETUP.md) for the full walkthrough and its
troubleshooting checklist. Skip it entirely if you only want the standalone
dashboard.
