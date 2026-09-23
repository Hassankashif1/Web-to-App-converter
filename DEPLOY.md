# Deploying to a free, always-on server (Oracle Cloud)

This runs the **real** build server — worker included — on a server you don't
have to keep your own PC on for. Oracle Cloud's "Always Free" tier gives a
genuinely free-forever ARM VM (4 CPUs, 24GB RAM), which is enough for
Gradle + Electron builds.

> Vercel/Render/Railway **cannot** run this app — they're serverless, and this
> needs a long-running background worker, a real filesystem, and native build
> tools (JDK, Android SDK). See the note in README.md. Oracle Cloud gives you
> an actual persistent VM instead, which is what this needs.

## 1. Create an Oracle Cloud account

1. Go to <https://signup.oracle.com/>, choose your country, sign up with an
   email + a card for identity verification (Oracle does **not** charge it
   for anything in the Always Free tier — it's only used to block bot
   signups).
2. Wait for the confirmation email, log in to the **OCI Console**.

## 2. Create the VM

1. In the Console, hamburger menu → **Compute → Instances → Create Instance**.
2. **Name**: anything, e.g. `wta-build-server`.
3. **Image and shape**:
   - Click **Edit** next to the shape.
   - Choose **Ampere** → **VM.Standard.A1.Flex**.
   - Set **4 OCPUs** and **24 GB memory** (the full Always Free allowance).
   - Image: **Canonical Ubuntu 22.04**.
4. **Networking**: leave the defaults (creates a new VCN with a public IP).
5. **Add SSH keys**: choose **Generate a key pair for me**, then click
   **Save Private Key** — you need this file to log in. Keep it safe.
6. Click **Create**. Wait a couple of minutes for it to go **Running**, then
   note its **Public IP** on the instance's detail page.

## 3. Open port 4000

Oracle blocks all inbound ports by default except SSH (22).

1. On the instance's detail page, click the **subnet** link under
   "Primary VNIC".
2. Click the **Default Security List**.
3. **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: TCP
   - Destination Port Range: `4000`
   - Click **Add Ingress Rules**.

## 4. SSH in and run the setup script

From your own machine:

```bash
chmod 600 /path/to/the-key-you-saved.key
ssh -i /path/to/the-key-you-saved.key ubuntu@<VM_PUBLIC_IP>
```

Once connected, run the one-line setup script (installs Node, JDK 21, the
Android SDK, clones this repo, and starts it as two systemd services):

```bash
curl -fsSL https://raw.githubusercontent.com/Hassankashif1/Web-to-App-converter/main/scripts/setup-oracle-vm.sh | bash
```

This takes several minutes (Android SDK download + `npm install`). When it
finishes it prints the dashboard URL — open `http://<VM_PUBLIC_IP>:4000`.

## 5. Point downloads at the public IP

By default `.env.local`'s `SELF_BASE_URL` is `http://localhost:4000`, which
means download links on the dashboard won't work from your browser. Fix it:

```bash
cd ~/wta-build-server
nano .env.local
# change: SELF_BASE_URL=http://<VM_PUBLIC_IP>:4000
sudo systemctl restart wta-dashboard wta-worker
```

## Managing it afterwards

```bash
sudo systemctl status wta-dashboard wta-worker   # is it running?
journalctl -u wta-worker -f                       # live build logs
sudo systemctl restart wta-dashboard wta-worker   # after any .env.local or code change
cd ~/wta-build-server && git pull && npm install && sudo systemctl restart wta-dashboard wta-worker   # deploy latest code
```

## Notes / limitations on this setup

- **This VM is ARM (aarch64), not x86.** Android/Gradle/Electron all support
  ARM Linux fine, and it'll produce a real `.AppImage`/`.deb` for Desktop
  Linux and a real `.apk` for Android. It will **not** produce a Windows
  `.exe` or macOS `.dmg` natively — those still only get the source-project
  zip from this VM (same limitation as running the worker on any single OS —
  see the platform table in README.md).
- **No HTTPS by default.** If you want a domain + free SSL, put Nginx +
  Certbot in front of port 4000 and point a domain's A record at the VM's
  public IP — ask if you want that added to the setup script.
- **Multiple people can now use it at once** since it's not tied to your PC —
  each browser still only sees its own Build Queue (no login, see README.md).
