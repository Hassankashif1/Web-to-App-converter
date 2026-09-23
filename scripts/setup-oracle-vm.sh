#!/usr/bin/env bash
# Sets up a fresh Ubuntu 22.04 VM (e.g. an Oracle Cloud "Always Free" Ampere
# A1 instance) to run the Web to App Builder build server: Node.js, JDK 21,
# the Android SDK, the repo itself, and two systemd services so the
# dashboard + worker keep running after you disconnect / the VM reboots.
#
# Usage (on the VM, as a user with sudo):
#   curl -fsSL https://raw.githubusercontent.com/Hassankashif1/Web-to-App-converter/main/scripts/setup-oracle-vm.sh | bash
#
# Safe to re-run — every step is idempotent.

set -euo pipefail

REPO_URL="https://github.com/Hassankashif1/Web-to-App-converter.git"
APP_DIR="$HOME/wta-build-server"
ANDROID_HOME="$HOME/android-sdk"
NODE_MAJOR=20

echo "==> Updating apt and installing base packages"
sudo apt-get update -y
sudo apt-get install -y curl unzip zip git openjdk-21-jdk-headless build-essential

echo "==> Installing Node.js ${NODE_MAJOR}.x"
if ! command -v node >/dev/null || [ "$(node -v | grep -oE '^v[0-9]+' | tr -d v)" -lt "$NODE_MAJOR" ]; then
	curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
	sudo apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Installing the Android SDK command-line tools"
mkdir -p "$ANDROID_HOME/cmdline-tools"
if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
	ARCH="$(uname -m)"
	# The Android SDK command-line tools zip is the same for x86_64 and arm64 hosts —
	# it's just JVM bytecode + platform-tools binaries that are fetched separately below.
	TMP_ZIP="$(mktemp)"
	curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -o "$TMP_ZIP"
	unzip -q "$TMP_ZIP" -d "$ANDROID_HOME/cmdline-tools"
	mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
	rm -f "$TMP_ZIP"
fi

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-34" "build-tools;34.0.0"

echo "==> Persisting ANDROID_HOME / PATH in ~/.bashrc"
if ! grep -q "ANDROID_HOME=$ANDROID_HOME" "$HOME/.bashrc" 2>/dev/null; then
	{
		echo ""
		echo "export ANDROID_HOME=\"$ANDROID_HOME\""
		echo "export PATH=\"\$PATH:\$ANDROID_HOME/platform-tools\""
	} >> "$HOME/.bashrc"
fi
export ANDROID_HOME
export PATH="$PATH:$ANDROID_HOME/platform-tools"

echo "==> Cloning/updating the repo"
if [ -d "$APP_DIR/.git" ]; then
	git -C "$APP_DIR" pull
else
	git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
echo "==> npm install"
npm install

if [ ! -f .env.local ]; then
	echo "==> Writing .env.local"
	cp .env.example .env.local
	sed -i "s#^ANDROID_HOME=.*#ANDROID_HOME=$ANDROID_HOME#" .env.local
	# JAVA_HOME isn't needed here — apt's openjdk-21-jdk-headless is already default `java`.
fi

echo "==> Opening port 4000 (ufw)"
if command -v ufw >/dev/null; then
	sudo ufw allow 4000/tcp || true
fi

echo "==> Installing systemd services"
sudo tee /etc/systemd/system/wta-dashboard.service >/dev/null <<EOF
[Unit]
Description=Web to App Builder — dashboard
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v npm) run dev
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/wta-worker.service >/dev/null <<EOF
[Unit]
Description=Web to App Builder — worker
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v npm) run worker
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wta-dashboard wta-worker

echo ""
echo "==> Done."
echo "Dashboard:  http://$(curl -fsSL ifconfig.me 2>/dev/null || echo YOUR_VM_IP):4000"
echo "(Also open port 4000 in the Oracle Cloud console's Security List/NSG — ufw alone isn't enough there.)"
echo ""
echo "Check status any time with:"
echo "  sudo systemctl status wta-dashboard wta-worker"
echo "  journalctl -u wta-worker -f     # live worker logs"
