#!/bin/sh
#
# Entry point for the local development container.
#
# WHY THIS EXISTS, AND IT IS NOT AN OPTIMISATION.
#
# `docker-compose-local.yaml` mounts a NAMED VOLUME over `/app/node_modules`, so
# that the Linux container's install never meets the Windows host's — right, and
# it has to stay. Docker seeds a named volume from the image exactly ONCE: the
# first time the volume is created, while it is still empty. Every rebuild after
# that leaves the volume alone. So a dependency change reaches the image, reaches
# the host, and never reaches the running container, which goes on serving
# whatever was installed the day the volume was made.
#
# That is not a hypothetical. `d3944d8` moved three from 0.171.0 to 0.185.1. The
# container kept 0.171.0 and the app stopped building on
# `three/addons/tsl/display/ChromaticAberrationNode.js`, an addon that only
# exists in the newer release. The message Next prints is "Can't resolve", which
# reads as a MISSING dependency and was a STALE one — the two failures look
# identical from inside the container and have opposite fixes.
#
# So the container reconciles itself on every start: it remembers the checksum of
# the lockfile it installed from, and reinstalls when the repository's lockfile
# no longer matches. `npm ci` is safe over the mount point (it clears the
# directory's contents rather than the directory), which is the reason this works
# at all and is worth stating, because the obvious alternative — deleting
# node_modules first — would try to unlink the mount and fail.

set -e

# Kept inside node_modules deliberately: it describes what THAT tree was built
# from, so a wiped or recreated volume loses the claim along with the evidence
# for it, and a fresh volume is correctly treated as unknown.
INSTALLED_LOCKFILE_CHECKSUM_PATH="/app/node_modules/.installed-lockfile-checksum"
LOCKFILE_PATH="/app/package-lock.json"
DEVELOPMENT_SERVER_HOSTNAME="0.0.0.0"
RECORD_ONLY_ARGUMENT="--record-installed-lockfile-only"

readLockfileChecksum() {
  md5sum "$LOCKFILE_PATH" | cut -d " " -f 1
}

recordInstalledLockfileChecksum() {
  readLockfileChecksum > "$INSTALLED_LOCKFILE_CHECKSUM_PATH"
}

# `Dockerfile.local` calls this after its own `npm ci`, so that a freshly created
# volume arrives already marked and the first boot does not reinstall the tree it
# was just handed. The path above is then defined in one place rather than two.
if [ "$1" = "$RECORD_ONLY_ARGUMENT" ]; then
  recordInstalledLockfileChecksum
  exit 0
fi

currentLockfileChecksum="$(readLockfileChecksum)"
installedLockfileChecksum="$(cat "$INSTALLED_LOCKFILE_CHECKSUM_PATH" 2>/dev/null || true)"

if [ "$currentLockfileChecksum" != "$installedLockfileChecksum" ]; then
  echo "node_modules was installed from a different package-lock.json — reinstalling."
  echo "  installed from: ${installedLockfileChecksum:-nothing recorded}"
  echo "  lockfile now:   $currentLockfileChecksum"
  npm ci
  recordInstalledLockfileChecksum
  echo "Dependencies now match package-lock.json."
fi

exec npm run dev -- --hostname "$DEVELOPMENT_SERVER_HOSTNAME"
