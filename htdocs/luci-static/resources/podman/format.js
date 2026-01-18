'use strict';

'require baseclass';

/**
 * Formatting utilities for Podman stats and resource display
 */
return baseclass.extend({
	/**
	 * Format bytes to human-readable size
	 * @param {number} bytes - Size in bytes
	 * @param {number} [decimals=2] - Number of decimal places
	 * @returns {string} Formatted size string (e.g., "1.5 GB", "512 MB")
	 */
	bytes: function (bytes, decimals) {
		if (!bytes || bytes === 0) return '0 B';

		decimals = decimals !== undefined ? decimals : 2;
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));

		return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
	},

	/**
	 * Format timestamp to locale string with leading zeros
	 * @param {number|string} timestamp - Unix timestamp (seconds) or ISO 8601 string
	 * @returns {string} Formatted date string (DD.MM.YYYY, HH:MM:SS)
	 */
	date: function (timestamp) {
		if (!timestamp) {
			return _('Never');
		}

		let date;

		// Check if timestamp is a string (ISO 8601 format)
		if (typeof timestamp === 'string') {
			// Check for zero/epoch date strings
			if (timestamp === '0001-01-01T00:00:00Z' || timestamp.startsWith('0001-')) {
				return _('Never');
			}
			date = new Date(timestamp);
		} else {
			// Assume Unix timestamp in seconds
			date = new Date(timestamp * 1000);
		}

		// Validate that the date is valid
		if (isNaN(date.getTime())) {
			return _('Unknown');
		}

		// Check if date is epoch/zero (before year 1970)
		if (date.getFullYear() < 1970) {
			return _('Never');
		}

		const day = ('0' + date.getDate()).slice(-2);
		const month = ('0' + (date.getMonth() + 1)).slice(-2);
		const year = date.getFullYear();
		const hours = ('0' + date.getHours()).slice(-2);
		const minutes = ('0' + date.getMinutes()).slice(-2);
		const seconds = ('0' + date.getSeconds()).slice(-2);

		return day + '.' + month + '.' + year + ', ' + hours + ':' + minutes + ':' + seconds;
	},

	/**
	 * Parse memory string to bytes
	 * Supports formats: 512m, 1g, 2gb, 1024, etc.
	 * @param {string} memStr - Memory string (e.g., "512m", "1g", "2gb")
	 * @param {boolean} [returnNullOnError=false] - If true, returns null on parse error; otherwise returns 0
	 * @returns {number|null} Size in bytes, or 0/null if invalid
	 */
	parseMemory: function (memStr, returnNullOnError) {
		if (!memStr) return returnNullOnError ? null : 0;

		// Match number with optional unit (k, kb, m, mb, g, gb, t, tb, or b)
		const match = memStr.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b?)?$/i);
		if (!match) return returnNullOnError ? null : 0;

		const value = parseFloat(match[1]);
		const unit = (match[2] || 'b').toLowerCase();

		// Multipliers for common units
		const multipliers = {
			'b': 1,
			'k': 1024,
			'kb': 1024,
			'm': 1024 * 1024,
			'mb': 1024 * 1024,
			'g': 1024 * 1024 * 1024,
			'gb': 1024 * 1024 * 1024,
			't': 1024 * 1024 * 1024 * 1024,
			'tb': 1024 * 1024 * 1024 * 1024
		};

		return Math.floor(value * (multipliers[unit] || 1));
	},

	/**
	 * Parse duration string to nanoseconds (Podman format)
	 * Supports formats: 30s, 1m, 1h, 500ms, etc.
	 * @param {string} duration - Duration string (e.g., "30s", "1m", "1h")
	 * @returns {number} Duration in nanoseconds, or 0 if invalid
	 */
	parseDuration: function (duration) {
		if (!duration) return 0;

		// Match number with unit (ns, us, ms, s, m, h)
		const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ns|us|ms|s|m|h)$/);
		if (!match) return 0;

		const value = parseFloat(match[1]);
		const unit = match[2];

		// Multipliers to convert to nanoseconds
		const multipliers = {
			'ns': 1,
			'us': 1000,
			'ms': 1000000,
			's': 1000000000,
			'm': 60000000000,
			'h': 3600000000000
		};

		return Math.floor(value * (multipliers[unit] || 0));
	},

	/**
	 * Format nanosecond duration to human-readable string
	 * @param {number} ns - Duration in nanoseconds
	 * @returns {string} Formatted duration string (e.g., "30s", "1m", "1h")
	 */
	duration: function (ns) {
		if (!ns || ns === 0) return '0s';

		const units = [{
				name: 'h',
				value: 3600000000000
			},
			{
				name: 'm',
				value: 60000000000
			},
			{
				name: 's',
				value: 1000000000
			},
			{
				name: 'ms',
				value: 1000000
			},
			{
				name: 'us',
				value: 1000
			},
			{
				name: 'ns',
				value: 1
			}
		];

		for (let i = 0; i < units.length; i++) {
			const unit = units[i];
			if (ns >= unit.value) {
				const value = Math.floor(ns / unit.value);
				const remainder = ns % unit.value;

				// If there's a significant remainder, show decimal
				if (remainder > 0 && i < units.length - 1) {
					const decimalValue = (ns / unit.value).toFixed(1);
					return decimalValue + unit.name;
				}

				return value + unit.name;
			}
		}

		return ns + 'ns';
	},


	/**
	 * Format network I/O stats for display
	 * @param {Object|string} networks - Network stats object or pre-formatted string
	 * @returns {string} Formatted network I/O string
	 */
	networkIO: function (networks) {
		// Already formatted string (NetIO field)
		if (typeof networks === 'string') {
			return networks;
		}

		// Networks object format: { eth0: { rx_bytes: 123, tx_bytes: 456, ... }, ... }
		if (typeof networks === 'object' && networks !== null) {
			const parts = [];
			Object.keys(networks).forEach((iface) => {
				const net = networks[iface];
				if (net && typeof net === 'object') {
					const rx = net.rx_bytes ? this.bytes(net.rx_bytes) : '0B';
					const tx = net.tx_bytes ? this.bytes(net.tx_bytes) : '0B';
					parts.push(`${iface}: ↓ ${rx} / ↑ ${tx}`);
				}
			});
			return parts.length > 0 ? parts.join(', ') : '-';
		}

		return '-';
	},

	/**
	 * Format block I/O stats for display
	 * @param {Object|string} blkio - Block I/O stats object or pre-formatted string
	 * @returns {string} Formatted block I/O string
	 */
	blockIO: function (blkio) {
		// Already formatted string (BlockIO field)
		if (typeof blkio === 'string') {
			return blkio;
		}

		// Block I/O stats object
		if (typeof blkio === 'object' && blkio !== null) {
			// Try io_service_bytes_recursive first (most common)
			if (blkio.io_service_bytes_recursive && Array.isArray(blkio
					.io_service_bytes_recursive) &&
				blkio.io_service_bytes_recursive.length > 0) {
				let read = 0;
				let write = 0;
				blkio.io_service_bytes_recursive.forEach((entry) => {
					if (entry.op === 'read' || entry.op === 'Read') {
						read += entry.value || 0;
					} else if (entry.op === 'write' || entry.op === 'Write') {
						write += entry.value || 0;
					}
				});
				return _('Read: %s / Write: %s').format(this.bytes(read), this.bytes(write));
			}

			// No data available
			return _('No I/O');
		}

		return '-';
	},

	/**
	 * Format PIDs stats for display
	 * @param {number|string|Object} pids - PIDs stats (number, string, or object)
	 * @returns {string} Formatted PIDs string
	 */
	pids: function (pids) {
		// Direct number or string
		if (typeof pids === 'number' || typeof pids === 'string') {
			return String(pids);
		}

		// Object format { current: X, limit: Y }
		if (typeof pids === 'object' && pids !== null) {
			const current = pids.current || pids.Current || 0;
			const limit = pids.limit || pids.Limit;
			if (limit && limit > 0) {
				return `${current} / ${limit}`;
			}
			return String(current);
		}

		return '0';
	},

	/**
	 * Format elapsed time from Podman process list
	 * Converts times like "1m23.456s" to "1m23s" or "23.456s" to "23s"
	 * Handles cases where nanoseconds are mistakenly in seconds position
	 * @param {string} timeStr - Time string in format like "1m23.456s" or "23.456s"
	 * @returns {string} Formatted elapsed time
	 */
	elapsedTime: function (timeStr) {
		if (!timeStr) return '-';

		// Parse all time units: y, d, h, m, s with optional decimal
		const result = [];
		const pattern = /(\d+(?:\.\d+)?)([ydhms])/g;
		let match;

		while ((match = pattern.exec(timeStr)) !== null) {
			let value = parseFloat(match[1]);
			const unit = match[2];

			// Special case: if seconds value is huge (> 1000), it's likely nanoseconds
			// Convert nanoseconds to seconds
			if (unit === 's' && value > 1000) {
				// This is likely nanoseconds, convert to seconds
				value = Math.floor(value / 1000000000);
				// If still > 60, convert to minutes
				if (value >= 60) {
					const mins = Math.floor(value / 60);
					const secs = value % 60;
					if (mins > 0) result.push(`${mins}m`);
					if (secs > 0) result.push(`${secs}s`);
					continue;
				}
			} else {
				// Normal value, just floor it
				value = Math.floor(value);
			}

			if (unit === 's') {
				result.push(`${value}s`);
			} else if (unit === 'm') {
				result.push(`${value}m`);
			} else if (unit === 'h') {
				result.push(`${value}h`);
			} else if (unit === 'd') {
				result.push(`${value}d`);
			} else if (unit === 'y') {
				result.push(`${value}y`);
			}
		}

		return result.length > 0 ? result.join('') : timeStr;
	}
});
