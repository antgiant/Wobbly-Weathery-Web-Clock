#!/bin/sh
# Gathers what is needed to find out why the clock's Pi crashed (kernel oops, GPU memory errors) into one text file you can send.
# Run it on the Pi after it has rebooted:   sh collect-crash-info.sh     (it asks for sudo for the kernel log)
# It writes ./clock-crash-report.txt and prints where. Nothing leaves the Pi; no passwords or keys are read.
out="${1:-$PWD/clock-crash-report.txt}"
run() { printf '\n===== %s =====\n' "$*"; "$@" 2>&1; }
sh_run() { printf '\n===== %s =====\n' "$1"; sh -c "$1" 2>&1; }
{
  echo "clock crash report, made $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  run uname -a
  sh_run 'cat /etc/os-release | head -4'
  sh_run 'cat /proc/device-tree/model; echo'
  sh_run 'vcgencmd get_throttled; vcgencmd measure_temp; vcgencmd measure_volts core; vcgencmd get_mem arm; vcgencmd get_mem gpu; vcgencmd version'
  sh_run 'grep -i "^Cma\|^MemTotal\|^MemFree\|^MemAvailable\|^Swap" /proc/meminfo'
  sh_run 'cat /proc/cmdline'
  for f in /boot/firmware/config.txt /boot/config.txt; do [ -f "$f" ] && sh_run "grep -v '^#' $f | grep -v '^$'"; done
  sh_run 'ls /sys/class/drm/'
  sh_run 'sudo -n true 2>/dev/null && echo "sudo ok" || echo "sudo needs a password (run this script as: sudo sh collect-crash-info.sh)"'
  sh_run 'sudo journalctl -k -b -1 --no-pager | grep -n -i -B5 -A60 "oops\|Internal error\|Unable to handle\|BUG:" | head -400'
  sh_run 'sudo journalctl -k -b -1 --no-pager | tail -150'
  sh_run 'sudo journalctl -k -b 0 --no-pager | grep -i "oops\|Internal error\|vc4\|GEM\|cma\|mmc\|under-voltage\|Voltage" | tail -80'
  sh_run 'sudo journalctl -u wobbly-clock -b -1 --no-pager | grep -i "health\|ladder\|error\|drawing with" | tail -80'
  sh_run 'sudo journalctl -u wobbly-clock -b 0 --no-pager | grep -i "health\|ladder\|error\|drawing with" | tail -40'
  sh_run 'dmesg 2>/dev/null | grep -i "mmc\|under-voltage\|vc4" | tail -40'
  sh_run 'sudo cat /sys/kernel/debug/dri/0/bo_stats 2>&1 | head -30'
  sh_run 'wobbly-clock-run --version 2>&1 | head -2; dpkg -l | grep -i "wobbly\|mesa\|libegl\|libgles\|raspberrypi-kernel\|linux-image" | cut -c1-110'
  sh_run 'ls /var/lib/systemd/pstore /sys/fs/pstore 2>/dev/null'
} > "$out" 2>&1
echo "Wrote $out ($(wc -c < "$out") bytes). Send me that file."
