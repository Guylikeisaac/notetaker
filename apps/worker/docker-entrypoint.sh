#!/bin/sh
# Starts a virtual screen and sound card, then runs the given command (default: the worker).
set -e

export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &

pulseaudio --daemonize=yes --exit-idle-time=-1 --system=false >/dev/null 2>&1 || true
pactl load-module module-null-sink sink_name=virtual >/dev/null 2>&1 || true
pactl set-default-sink virtual >/dev/null 2>&1 || true

# VNC=1: serve the virtual screen on port 5900. docker-compose publishes it on the
# host's 127.0.0.1 only, so it is reachable solely through an SSH tunnel.
if [ "$VNC" = "1" ]; then
  x11vnc -display :99 -forever -nopw -quiet >/dev/null 2>&1 &
fi

sleep 1
exec "$@"
