# Web to App Builder — WordPress Integration Guide

> **This whole file is optional.** If you just want to build apps from the
> built-in dashboard at `http://localhost:4000`, see the main
> [README.md](./README.md) — it needs none of this. This guide is only for
> wiring the separate WordPress plugin up to this build server as an
> alternative way to queue builds.

This covers both pieces end to end: the WordPress plugin and the Next.js
build server on your PC, and — since this is where almost everything breaks
— exactly how to get the API key right the first time.

There are only **two values that must match exactly** between the two
systems. Everything else follows from getting those two right:

| Value | Set in WordPress | Set in Build Server |
|---|---|---|
| **API Key** | Admin → Web to App Builder → Build Server API Key | `.env.local` → `WTA_API_KEY` |
| **Server URL** | Admin → Web to App Builder → Build Server URL | (this is the server itself — no matching value needed on its side) |

---

## Part 1 — Install the WordPress plugin

1. WP Admin → Plugins → Add New → Upload Plugin → select `web-to-app-builder.zip` → Install → Activate.
2. Create a page containing the shortcode `[web_to_app_builder]`.
3. Create a second page containing `[web_to_app_dashboard]`.
4. Visit both pages while logged in to confirm they render (builder form on
   one, "My Apps" + "Go Live" tabs on the other).

At this point app creation and test-build *requests* already work — WordPress
just can't build anything itself yet. That's what Part 2 is for.

---

## Part 2 — Generate the API key

Do this **before** touching the build server, so you only type the key once.

1. On your own computer, generate a long random string. Any of these work:
   - Terminal (Mac/Linux): `openssl rand -hex 32`
   - PowerShell (Windows): `[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()`
   - Or just mash the keyboard for 40+ characters — length matters more than method.
2. Copy that string somewhere you can paste from twice (a scratch note, not
   your memory — one typo here is the #1 cause of "it's not connecting").

**Do not** put quotes around it, and don't include leading/trailing spaces —
copy exactly the characters, nothing else.

---

## Part 3 — WordPress: Build Server Settings

WP Admin → Web to App Builder (left sidebar) → **Build Server Settings**:

- **Build Server URL** — where the Next.js server will be reachable *from
  WordPress's server*, not from your browser. This distinction is the second
  most common source of confusion:
  - If WordPress and the build server run on the **same machine** (e.g. a
    local WordPress install on your own PC): `http://localhost:4000`
  - If WordPress is a **real hosted site** (Hostinger, SiteGround, Kinsta,
    etc.) and the build server is on your PC: `localhost` means nothing to
    that host — it will try to reach itself, not your PC. You must expose
    your PC's port 4000 publicly first (see Part 5), then paste that public
    URL here (e.g. `https://abcd1234.ngrok-free.app`).
  - No trailing slash needed either way — the plugin adds `/api/webhook`
    itself.
- **Build Server API Key** — paste the exact string from Part 2.
- **Android Builds** — check this box (this toggle currently doesn't gate
  anything yet, but leave it checked).
- Click **Save Changes**.

⚠️ The password-style API key field always shows empty on reload — that's
intentional (see `class-wta-admin.php`, it never echoes the stored key back).
**Empty does not mean unsaved.** Only overwrite it if you're deliberately
rotating the key. If you're unsure whether it saved, don't retype it "just in
case" — that's how the two sides end up with different keys. Check the
database directly if you need certainty:

```sql
SELECT option_value FROM wp_options WHERE option_name = 'wta_settings';
```

(table prefix may differ from `wp_` on your install — check your `wp-config.php`)

---

## Part 4 — Build server: `.env.local`

Inside the `wta-build-server` folder:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

```env
WP_SITE_URL=https://your-actual-site.com
WTA_API_KEY=the-exact-same-string-from-part-2
SELF_BASE_URL=http://localhost:4000
ANDROID_HOME=C:\Users\you\AppData\Local\Android\Sdk
POLL_INTERVAL_MS=5000
```

Rules that prevent the classic key-mismatch bug:

- **No quotes** around the value: `WTA_API_KEY=abc123`, not `WTA_API_KEY="abc123"`.
- **No trailing space** after the value — a stray space at end-of-line is
  invisible in most editors and will make the strings compare as different.
- `WP_SITE_URL` — no trailing slash, and must include `https://` (or `http://`
  for a local WP install). The code strips one trailing slash automatically,
  but don't rely on that for anything beyond one.
- Save the file as **`.env.local`**, not `.env.local.txt` — some editors on
  Windows add `.txt` silently. Confirm with:
  ```bash
  ls -la    # Mac/Linux
  dir /a    # Windows cmd
  ```

Install dependencies:

```bash
npm install
```

---

## Part 5 — Making the build server reachable (only if WordPress is remote)

Skip this whole part if WordPress and the build server run on the same
machine (`localhost` works directly).

If your WordPress site is hosted elsewhere and the build server is on your
PC, WordPress's server cannot reach your PC's `localhost` — you need a
tunnel:

```bash
# one-time install: https://ngrok.com/download
ngrok http 4000
```

ngrok prints a URL like `https://a1b2c3d4.ngrok-free.app`. Use that exact
URL (with `https://`) as:
- **Build Server URL** in WordPress (Part 3)
- `SELF_BASE_URL` in `.env.local` (Part 4) — this is what gets sent to
  WordPress as the APK download link, so it must be the URL a browser can
  actually reach, not `localhost`.

Free ngrok URLs change every time you restart it — you'll need to update
both values again after a restart, or use a paid ngrok static domain.

---

## Part 6 — Run it

Two terminals, both inside the `wta-build-server` folder:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run worker
```

Leave both running. `npm run dev` only receives jobs and shows the
dashboard — it does not build anything. `npm run worker` is the one that
actually runs Capacitor + Gradle; if it's not running, jobs sit at
`pending` forever.

Open `http://localhost:4000` to watch the job queue live.

---

## Part 7 — Test the connection end to end

1. On your WordPress builder page, fill in a Website URL + App Name, click
   **Save App**, then **Generate Test Build**.
2. Within a few seconds, a new job should appear at `http://localhost:4000`
   with status `pending` → `building`.
3. Watch Terminal 2 (`npm run worker`) — it prints every command it runs.
   The first build is slow (installing Capacitor, downloading Gradle);
   later ones are much faster.
4. When it finishes, the job shows `complete` with a **Download APK** link,
   and the WordPress dashboard's app card should update from "Queued —
   waiting for build server" to "Ready".

If step 2 never happens (job never appears), it's a **connection** problem —
see the checklist below. If the job appears but fails at the Gradle step,
it's an **Android SDK** problem, not an API key problem — check
`ANDROID_HOME` and see the build server's own `README.md`.

---

## API Key / Connection Troubleshooting Checklist

Work through these in order — they're listed by how often they're actually
the cause:

1. **Retyped the key on one side after saving the other.** Whichever side
   you touched last is very likely now different from the other. Fix: pick
   one value, paste it into both places fresh, save both, restart
   `npm run worker` (it only reads `.env.local` at startup).
2. **Trailing space or newline in `.env.local`.** Open the file in a plain
   text editor and check the line ends immediately after the last character
   of the key — no space, no second blank line concatenated onto it.
3. **Quotes accidentally included.** `WTA_API_KEY="abc"` sets the key to
   `"abc"` (quotes included), not `abc`. Remove them.
4. **Wrong `.env` file loaded.** The worker reads `.env.local` first, then
   falls back to `.env` only if `.env.local` doesn't exist — check you
   actually edited `.env.local`, not `.env`.
5. **Worker not restarted after editing `.env.local`.** Environment
   variables are only read once at process start. Stop `npm run worker`
   (Ctrl+C) and start it again after any `.env.local` change.
6. **`Build Server URL` in WordPress has a typo or wrong port.** Default
   Next.js dev port here is `4000` (see `package.json`'s `dev` script) — not
   the usual `3000`.
7. **A security plugin or firewall (Wordfence, Sucuri, host-level WAF) is
   stripping custom headers** like `X-WTA-API-Key` before they reach
   WordPress. Test this directly:
   ```bash
   curl -X POST https://your-site.com/wp-json/wta/v1/internal/build-result \
     -H "Content-Type: application/json" \
     -H "X-WTA-API-Key: your-key-here" \
     -d '{"appId":1,"status":"complete"}'
   ```
   - `401 Invalid or missing X-WTA-API-Key header` → the header made it
     through fine, but the value doesn't match — go back to step 1.
   - Anything else (connection refused, HTML error page, a WAF block page)
     → the request isn't reaching the plugin's endpoint at all — check the
     URL, check hosting firewall settings, check the REST API isn't disabled
     by another plugin.
8. **WordPress site itself is behind HTTP auth / a "coming soon" page /
   maintenance mode.** The webhook request from your build server is an
   anonymous HTTP request just like `curl` above — anything that blocks
   anonymous visitors blocks this too.
9. **Mixed HTTP/HTTPS.** If `WP_SITE_URL` is `http://` but the site actually
   force-redirects to `https://`, some hosts will drop the POST body on
   redirect. Set `WP_SITE_URL` to whichever scheme the site actually serves
   directly (check by visiting it — look at the address bar after it loads).

If you've gone through all nine and it still fails, run the `curl` command
from step 7 and share the exact response — that tells you definitively
whether the problem is on the WordPress side (plugin/hosting) or the build
server side (nothing wrong with the key at all, request never arrived).
