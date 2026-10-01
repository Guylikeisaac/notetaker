#!/bin/sh
# One-time server prep for Ubuntu 24.04 on EC2: installs Docker and the compose plugin.
#   curl -fsSL https://raw.githubusercontent.com/Guylikeisaac/notetaker/main/deploy/aws/setup.sh | sh
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
echo "Docker installed. Log out and back in (so 'docker' works without sudo), then:"
echo "  git clone https://github.com/Guylikeisaac/notetaker.git && cd notetaker"
