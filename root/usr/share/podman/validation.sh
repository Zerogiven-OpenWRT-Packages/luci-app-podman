#!/bin/sh
#
# Shared validation functions for Podman scripts
#
# Usage: Define fail_validation() before sourcing this file.
#
#   fail_validation() { echo "$1"; exit 1; }
#   . /usr/share/podman/validation.sh
#

# --- Utilities ---

urlencode() {
	local string="$1" encoded="" char rest
	rest="$string"
	while [ -n "$rest" ]; do
		char="${rest%"${rest#?}"}"
		rest="${rest#?}"
		case "$char" in
			[-_.~a-zA-Z0-9:/@]) encoded="${encoded}${char}" ;;
			*) char=$(printf '%%%02x' "'$char")
			   encoded="${encoded}${char}" ;;
		esac
	done
	echo "$encoded"
}

# --- Parameter helpers ---

require_param() {
	local var_name="$1"
	local var_value="$2"
	if [ -z "$var_value" ]; then
		fail_validation "Missing required parameter: $var_name"
	fi
}

# --- Validators ---

validate_path_safe_id() {
	case "$1" in
		*[!a-zA-Z0-9_.:-]*) fail_validation "Invalid id format" ;;
	esac
}

validate_container_name() {
	case "$1" in
		*[!a-zA-Z0-9_-]*) fail_validation "Invalid container name format" ;;
	esac
}

validate_resource_name() {
	case "$1" in
		*[!a-zA-Z0-9_.-]*) fail_validation "Invalid resource name format" ;;
	esac
}

validate_volume_name() {
	case "$1" in
		*[!a-zA-Z0-9_.-]*) fail_validation "Invalid volume name format" ;;
	esac
}

validate_image_ref() {
	case "$1" in
		*[!a-zA-Z0-9_./:@-]*) fail_validation "Invalid image reference" ;;
	esac
}

validate_int() {
	case "$1" in
		*[!0-9]*) fail_validation "Invalid number" ;;
	esac
}

validate_base64_content() {
	local data="$1"

	if ! printf '%s\n' "$data" | grep -Eq '^[A-Za-z0-9+/]*={0,2}$'; then
		fail_validation "Invalid Base64 characters detected"
	fi

	local len=${#data}
	if [ $((len % 4)) -ne 0 ]; then
		fail_validation "Invalid Base64 length ($len). Must be a multiple of 4"
	fi
}

validate_query_params() {
	case "$1" in
		*[!a-zA-Z0-9=\&_.,-]*) fail_validation "Invalid query parameters" ;;
	esac
}

validate_restart_policy() {
	case "$1" in
		no|always|on-failure|unless-stopped|"") ;;
		*) fail_validation "Invalid restart policy" ;;
	esac
}
