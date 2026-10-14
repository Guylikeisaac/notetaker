#!/bin/bash
# Keeps asking Oracle for a free Ampere A1 VM until one is available ("Out of capacity" is
# common), then prints its public IP. Needs the OCI CLI configured (~/.oci/config).
#   bash deploy/oracle/grab-vm.sh [ocpus] [memory_gb]      default: 2 12
# Each round also tries 1 OCPU / 6 GB, which frees up more often; resize it later from the console.
# Creates the network (VCN, internet gateway, public subnet) first if there isn't one.
set -euo pipefail
# Homebrew's oci-cli runs on Python 3.15, newer than oci-cli supports; prefer one under the system Python:
#   /usr/bin/python3 -m venv ~/.oci/venv && ~/.oci/venv/bin/pip install oci-cli
[ -x "$HOME/.oci/venv/bin/oci" ] && export PATH="$HOME/.oci/venv/bin:$PATH"
export SUPPRESS_LABEL_WARNING=True

OCPUS="${1:-2}"
MEM="${2:-12}"
NAME="notetaker-bot"
SSH_PUB="${SSH_PUB:-$HOME/.ssh/oracle_notetaker.pub}"
RETRY_SECONDS="${RETRY_SECONDS:-60}"

# Retries a command through brief auth hiccups (a newly added API key takes minutes to propagate).
retry() {
  local i out
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if out=$("$@" 2>&1); then echo "$out" | grep -v -E 'SyntaxWarning|INSTANCE_CONSOLE'; return 0; fi
    echo "$out" | grep -q NotAuthenticated || { echo "$out" >&2; return 1; }
    sleep 30
  done
  echo "$out" >&2; return 1
}

TENANCY=$(awk -F= '/^tenancy/ {print $2; exit}' ~/.oci/config | tr -d ' ')
C="$TENANCY" # root compartment

existing=$(oci compute instance list -c "$C" --display-name "$NAME" \
  --query 'data[?"lifecycle-state"!=`TERMINATED`].id | [0]' --raw-output 2>/dev/null || true)
if [ -n "$existing" ] && [ "$existing" != "null" ]; then
  echo "An instance named $NAME already exists: $existing"
  exit 0
fi

AD=$(retry oci iam availability-domain list -c "$C" --query 'data[0].name' --raw-output)
IMAGE=$(retry oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC \
  --query 'data[?!contains("display-name", `Minimal`)].id | [0]' --raw-output)

SUBNET=$(retry oci network subnet list -c "$C" \
  --query 'data[?"prohibit-public-ip-on-vnic"==`false`].id | [0]' --raw-output 2>/dev/null || true)
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  echo "→ creating network"
  VCN=$(retry oci network vcn create -c "$C" --display-name notetaker-vcn --cidr-blocks '["10.0.0.0/16"]' \
    --dns-label notetaker --wait-for-state AVAILABLE --query 'data.id' --raw-output)
  IGW=$(retry oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true \
    --display-name notetaker-igw --wait-for-state AVAILABLE --query 'data.id' --raw-output)
  RT=$(retry oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
  retry oci network route-table update --rt-id "$RT" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
  # The VCN's default security list already allows inbound SSH and all outbound traffic.
  SUBNET=$(retry oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 \
    --display-name notetaker-public --dns-label pub --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi

echo "AD:     $AD"
echo "Image:  $IMAGE"
echo "Subnet: $SUBNET"
echo "Shape:  VM.Standard.A1.Flex, $OCPUS OCPU, $MEM GB. Retrying every ${RETRY_SECONDS}s until Oracle has capacity."

launch() { # ocpus memory
  oci compute instance launch -c "$C" --availability-domain "$AD" --display-name "$NAME" \
    --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$1,\"memoryInGBs\":$2}" \
    --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true \
    --boot-volume-size-in-gbs 100 --ssh-authorized-keys-file "$SSH_PUB" \
    --wait-for-state RUNNING --query 'data.id' --raw-output 2>&1
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  for size in "$OCPUS $MEM" "1 6"; do
    set -- $size
    if out=$(launch "$1" "$2"); then
      ID=$(echo "$out" | grep '^ocid1.instance' | tail -1)
      IP=$(retry oci compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output)
      echo "$(date '+%H:%M') created ($1 OCPU, $2 GB) after $attempt rounds: $ID"
      echo "PUBLIC_IP=$IP"
      exit 0
    fi
    if ! echo "$out" | grep -qiE "out of (host )?capacity|InternalError|TooManyRequests|NotAuthenticated|timed out|RequestException|Connection"; then
      echo "$(date '+%H:%M') round $attempt failed with an unexpected error:" >&2
      echo "$out" >&2
      exit 1
    fi
  done
  echo "$(date '+%H:%M') round $attempt: no capacity yet"
  sleep "$RETRY_SECONDS"
done
