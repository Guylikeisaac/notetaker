#!/bin/sh
# One-time prep for an Oracle Cloud Ubuntu 24.04 VM (arm64 or x86):
# installs Docker and opens ports 80/443 in the VM's own firewall.
#   sh ~/notetaker/deploy/oracle/setup.sh
set -e

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git openssl iptables-persistent
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
# Allow HTTP (Let's Encrypt) and HTTPS, ahead of the REJECT rule, and persist them.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $port -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p tcp --dport $port -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save

echo
echo "Done. Log out and back in (so 'docker' works without sudo), then:"
echo "  cd ~/notetaker/deploy/oracle && ./init-env.sh"
