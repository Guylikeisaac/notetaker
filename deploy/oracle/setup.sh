#!/bin/sh
# One-time prep for an Oracle Cloud Ubuntu 24.04 VM (arm64 or x86):
# installs Docker. The bot only makes outbound connections, so no ports are opened.
#   sh ~/notetaker/deploy/oracle/setup.sh
set -e

sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

echo
echo "Done. Log out and back in (so 'docker' works without sudo), then:"
echo "  copy your .env to ~/notetaker/.env, then: cd ~/notetaker/deploy/oracle && docker compose up -d --build"
