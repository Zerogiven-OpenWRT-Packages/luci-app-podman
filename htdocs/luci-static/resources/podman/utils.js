'use strict';

'require baseclass'

/**
 * Shared utility functions for Podman LuCI application
 */
return baseclass.extend({

	/**
	 * Generic failure handler for rendering errors
	 * @param {string} message - Error message to display
	 * @returns {Element} Error element
	 */
	renderError: function (message) {
		return E('div', {
			'class': 'alert-message error'
		}, [_('RPC call failure: '), message]);
	},

	/**
	 * Format bytes to human-readable size
	 * @param {number} bytes - Size in bytes
	 * @param {number} [decimals=2] - Number of decimal places
	 * @returns {string} Formatted size string
	 */
	formatBytes: function (bytes, decimals) {
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
	formatDate: function (timestamp) {
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
	 * Truncate string with ellipsis
	 * @param {string} str - String to truncate
	 * @param {number} maxLength - Maximum length
	 * @returns {string} Truncated string
	 */
	truncate: function (str, maxLength) {
		if (!str || str.length <= maxLength) {
			return str;
		}

		return str.substring(0, maxLength) + '...';
	},

	/**
	 * Setup "select all" checkbox functionality for table views with shift-select support
	 * @param {HTMLElement} rendered - Rendered table container
	 * @param {string} prefix - Checkbox name prefix (e.g., 'containers', 'images')
	 */
	setupSelectAllCheckbox: function (rendered, prefix) {
		requestAnimationFrame(() => {
			const selectAllCheckbox = rendered.querySelector(
				'input[type="hidden"][name="all"] ~ input[type=checkbox]');
			const checkboxes = rendered.querySelectorAll('input[type="hidden"][name^="' +
				prefix + '"] ~ input[type=checkbox]');

			// Track last clicked checkbox for shift-select
			let lastClickedIndex = -1;

			// Setup "select all" functionality
			if (selectAllCheckbox) {
				selectAllCheckbox.addEventListener('change', (ev) => {
					const checked = ev.target.checked;
					checkboxes.forEach((cb) => {
						cb.checked = checked;
					});
				});
			}

			// Setup shift-select functionality for individual checkboxes
			checkboxes.forEach((checkbox, index) => {
				checkbox.addEventListener('click', (ev) => {
					// Handle shift+click for range selection
					if (ev.shiftKey && lastClickedIndex !== -1 &&
						lastClickedIndex !== index) {
						const start = Math.min(lastClickedIndex, index);
						const end = Math.max(lastClickedIndex, index);
						const targetState = checkbox.checked;

						// Select/deselect all checkboxes in range
						for (let i = start; i <= end; i++) {
							checkboxes[i].checked = targetState;
						}
					}

					// Update last clicked index
					lastClickedIndex = index;
				});
			});
		});
	},

	/**
	 * Get selected items from checkboxes in a table view
	 * @param {string} prefix - Checkbox name prefix (e.g., 'containers', 'images')
	 * @param {Array} dataArray - Array of data objects
	 * @param {Function} extractFn - Function to extract the needed data from item (item, index) => value
	 * @returns {Array} Array of selected items
	 */
	getSelectedFromCheckboxes: function (prefix, dataArray, extractFn) {
		const selected = [];
		const checkboxes = document.querySelectorAll('input[type="hidden"][name^="' + prefix +
			'"] ~ input[type="checkbox"]:checked');
		checkboxes.forEach((cb) => {
			const sectionId = cb.previousSibling.name.replace(prefix, '');
			if (sectionId && dataArray && dataArray[sectionId]) {
				selected.push(extractFn(dataArray[sectionId], sectionId));
			}
		});
		return selected;
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
	formatDuration: function (ns) {
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
					const nextUnit = units[i + 1];
					const decimalValue = (ns / unit.value).toFixed(1);
					return decimalValue + unit.name;
				}

				return value + unit.name;
			}
		}

		return ns + 'ns';
	}
});
