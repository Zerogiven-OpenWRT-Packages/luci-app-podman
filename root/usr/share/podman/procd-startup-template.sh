#!/bin/sh /etc/rc.common

# Podman's restart policy handles runtime restarts to avoid conflicts

START={start_priority}
STOP=20
USE_PROCD=1

NAME={script_name}
PROG=/usr/bin/podman

. /lib/functions.sh

# Set to 1 to ignore missing container (useful for debugging)
IGNORE_MISSING=${IGNORE_MISSING:-0}

start_service() {
	# Wait for Podman socket with timeout
	# Timeout set to 60s
	local max_wait=60
	local count=0

	logger -t ${NAME} "Waiting for Podman socket..."

	while [ $count -lt $max_wait ]; do
		if [ -S /run/podman/podman.sock ]; then
			logger -t ${NAME} "Podman socket available after ${count}s"
			break
		fi
		sleep 1
		count=$((count + 1))
	done

	if [ ! -S /run/podman/podman.sock ]; then
		logger -t ${NAME} "Timeout: Podman socket not available after ${max_wait}s"
		return 1
	fi

	# Check if container exists (unless IGNORE_MISSING=1)
	if [ "$IGNORE_MISSING" != "1" ]; then
		if ! $PROG container exists {name} 2>/dev/null; then
			logger -t ${NAME} "Container does not exist"
			return 1
		fi
	fi

	# Start container using procd with podman wait for monitoring
	# If container is not running, start it first, then wait
	procd_open_instance "${NAME}"
	procd_set_param command sh -c "
		if ! $PROG container inspect {name} --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
			logger -t ${NAME} 'Starting container "{name}"'
			$PROG start {name} || exit 1
		else
			logger -t ${NAME} 'Container "{name}" already running'
		fi
		exec $PROG wait {name}
	"

	# NOTE: No respawn - Podman restart policy handles runtime restarts
	# This ensures manual stops are respected
	procd_close_instance
}

stop_service() {
	logger -t ${NAME} "Stopping container {name}"
	$PROG stop {name} 2>/dev/null || true
}
