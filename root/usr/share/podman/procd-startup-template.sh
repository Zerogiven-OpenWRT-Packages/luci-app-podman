#!/bin/sh /etc/rc.common

# Podman's restart policy handles runtime restarts to avoid conflicts

START={start_priority}
STOP=20
USE_PROCD=1

NAME={script_name}
PROG=/usr/bin/podman

start_service() {
	# Register procd instance - socket wait happens inside command (non-blocking)
	procd_open_instance "${NAME}"
	procd_set_param command /bin/sh -c "
		# Wait for Podman socket with timeout (120s)
		max_wait=120
		count=0
		logger -t ${NAME} 'Waiting for Podman socket...'
		while [ \"\$count\" -lt \"\$max_wait\" ]; do
			[ -S /run/podman/podman.sock ] && break
			sleep 1
			count=\$((count + 1))
		done
		if [ ! -S /run/podman/podman.sock ]; then
			logger -t ${NAME} 'Timeout: Podman socket not available'
			exit 1
		fi
		logger -t ${NAME} \"Podman socket available after \${count}s\"

		# Check container exists
		if ! $PROG container exists '{name}' 2>/dev/null; then
			logger -t ${NAME} 'Container {name} does not exist'
			exit 1
		fi

		# Start container if not running
		if ! $PROG container inspect '{name}' --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
			logger -t ${NAME} 'Starting container {name}'
			$PROG start '{name}' || exit 1
		else
			logger -t ${NAME} 'Container {name} already running'
		fi
	"
	procd_close_instance
}

stop_service() {
	logger -t ${NAME} "Stopping container {name}"
	$PROG stop "{name}" 2>/dev/null || true
}
