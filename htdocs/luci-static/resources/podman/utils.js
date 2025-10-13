'use strict';
'require ui';

/**
 * @file Shared utility functions for Podman LuCI application
 * @module podman.utils
 */

return L.Class.extend({
	/**
	 * Show a loading modal dialog
	 * @param {string} title - Modal title
	 * @param {string} message - Loading message
	 */
	showLoadingModal: function(title, message) {
		ui.showModal(title, [
			E('p', { 'class': 'spinning' }, message)
		]);
	},

	/**
	 * Show an error modal with close button
	 * @param {string} title - Modal title
	 * @param {string} errorMessage - Error message to display
	 */
	showErrorModal: function(title, errorMessage) {
		ui.showModal(title, [
			E('p', {}, errorMessage),
			this.createCloseButton()
		]);
	},

	/**
	 * Create a close button for modals
	 * @returns {Element} Close button element
	 */
	createCloseButton: function() {
		return E('div', { 'class': 'right' }, [
			E('button', {
				'class': 'cbi-button',
				'click': ui.hideModal
			}, _('Close'))
		]);
	},

	/**
	 * Handle RPC operation with loading modal and notifications
	 * @param {Object} options - Operation options
	 * @param {string} options.loadingTitle - Loading modal title
	 * @param {string} options.loadingMessage - Loading modal message
	 * @param {string} options.successMessage - Success notification message
	 * @param {string} options.errorPrefix - Error message prefix
	 * @param {Promise} options.operation - RPC operation promise
	 * @param {Function} [options.onSuccess] - Success callback
	 * @param {Function} [options.onError] - Error callback
	 */
	handleOperation: function(options) {
		this.showLoadingModal(options.loadingTitle, options.loadingMessage);

		options.operation.then((result) => {
			ui.hideModal();

			if (result && result.error) {
				ui.addNotification(null, E('p', _('%s: %s').format(options.errorPrefix, result.error)), 'error');
				if (options.onError) options.onError(result);
				return;
			}

			ui.addNotification(null, E('p', options.successMessage));
			if (options.onSuccess) options.onSuccess(result);
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('%s: %s').format(options.errorPrefix, err.message)), 'error');
			if (options.onError) options.onError(err);
		});
	},

	/**
	 * Create an empty placeholder row for tables
	 * @param {string} message - Placeholder message
	 * @param {number} colSpan - Number of columns to span
	 * @returns {Element} Table row element
	 */
	createPlaceholderRow: function(message, colSpan) {
		return E('tr', { 'class': 'tr placeholder' }, [
			E('td', { 'class': 'td', 'colspan': colSpan },
				E('em', {}, message))
		]);
	},

	/**
	 * Clear table rows except header
	 * @param {HTMLTableElement} table - Table element
	 */
	clearTableRows: function(table) {
		while (table.rows.length > 1) {
			table.deleteRow(1);
		}
	},

	/**
	 * Format bytes to human-readable size
	 * @param {number} bytes - Size in bytes
	 * @param {number} [decimals=2] - Number of decimal places
	 * @returns {string} Formatted size string
	 */
	formatBytes: function(bytes, decimals) {
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
	formatDate: function(timestamp) {
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
	truncate: function(str, maxLength) {
		if (!str || str.length <= maxLength) {
			return str;
		}

		return str.substring(0, maxLength) + '...';
	},

	/**
	 * Setup "select all" checkbox functionality for table views
	 * @param {HTMLElement} rendered - Rendered table container
	 * @param {string} prefix - Checkbox name prefix (e.g., 'containers', 'images')
	 */
	setupSelectAllCheckbox: function(rendered, prefix) {
		requestAnimationFrame(() => {
			const selectAllCheckbox = rendered.querySelector('input[type="hidden"][name="all"] ~ input[type=checkbox]');
			if (selectAllCheckbox) {
				selectAllCheckbox.addEventListener('change', (ev) => {
					const checked = ev.target.checked;
					const checkboxes = rendered.querySelectorAll('input[type="hidden"][name^="' + prefix + '"] ~ input[type=checkbox]');
					checkboxes.forEach((cb) => {
						cb.checked = checked;
					});
				});
			}
		});
	},

	/**
	 * Get selected items from checkboxes in a table view
	 * @param {string} prefix - Checkbox name prefix (e.g., 'containers', 'images')
	 * @param {Array} dataArray - Array of data objects
	 * @param {Function} extractFn - Function to extract the needed data from item (item, index) => value
	 * @returns {Array} Array of selected items
	 */
	getSelectedFromCheckboxes: function(prefix, dataArray, extractFn) {
		const selected = [];
		const checkboxes = document.querySelectorAll('input[type="hidden"][name^="' + prefix + '"] ~ input[type="checkbox"]:checked');
		checkboxes.forEach((cb) => {
			const sectionId = cb.previousSibling.name.replace(prefix, '');
			if (sectionId && dataArray && dataArray[sectionId]) {
				selected.push(extractFn(dataArray[sectionId], sectionId));
			}
		});
		return selected;
	},

	/**
	 * Show inspect modal with JSON data
	 * @param {string} title - Modal title
	 * @param {Object} data - Data to display as JSON
	 * @param {Array<string>} [hiddenFields] - Fields to hide (will be replaced with '***HIDDEN***')
	 * @param {Function} [closeButton] - Optional custom close button renderer
	 */
	showInspectModal: function(title, data, hiddenFields, closeButton) {
		// Clone data to avoid modifying original
		const displayData = JSON.parse(JSON.stringify(data));

		// Hide sensitive fields
		if (hiddenFields && hiddenFields.length > 0) {
			hiddenFields.forEach((field) => {
				if (displayData[field]) {
					displayData[field] = '***HIDDEN***';
				}
			});
		}

		const content = [
			E('pre', {
				'style': 'max-height: 500px; max-width: 800px; overflow: auto; background: #000; color: #0f0; padding: 15px; font-family: monospace; font-size: 12px; white-space: pre; border-radius: 4px;'
			}, JSON.stringify(displayData, null, 2))
		];

		// Add security notice if fields were hidden
		if (hiddenFields && hiddenFields.length > 0) {
			content.unshift(E('p', { 'style': 'margin-bottom: 10px; color: #e74c3c;' }, [
				E('strong', {}, _('Security Notice:')),
				' ',
				_('Sensitive data is hidden for security reasons.')
			]));
		}

		// Add close button
		if (closeButton && typeof closeButton === 'function') {
			content.push(closeButton());
		} else {
			content.push(E('div', { 'class': 'right', 'style': 'margin-top: 10px;' }, [
				E('button', {
					'class': 'cbi-button',
					'click': () => ui.hideModal()
				}, _('Close'))
			]));
		}

		ui.showModal(title, content);
	},

	/**
	 * Generic bulk delete handler
	 * @param {Object} options - Delete operation options
	 * @param {Array} options.selected - Array of selected items
	 * @param {string} options.itemName - Name of items being deleted (e.g., 'container', 'image')
	 * @param {Function} options.deletePromiseFn - Function that returns delete promise for an item
	 * @param {Function} [options.onSuccess] - Success callback
	 * @param {Function} [options.formatItemName] - Function to format item for display in confirm dialog
	 */
	handleBulkDelete: function(options) {
		const selected = options.selected;

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No %s selected').format(options.itemName + 's')), 3000, 'warning');
			return;
		}

		// Format item names for confirmation
		const formatFn = options.formatItemName || ((item) => typeof item === 'string' ? item : item.name || item.Name || item.id || item.Id);
		const itemNames = selected.map(formatFn).join(', ');

		if (!confirm(_('Are you sure you want to remove %d %s?\n\n%s').format(
			selected.length,
			selected.length === 1 ? options.itemName : options.itemName + 's',
			itemNames
		))) {
			return;
		}

		ui.showModal(_('Deleting %s').format(options.itemName + 's'), [
			E('p', { 'class': 'spinning' }, _('Deleting %d selected %s...').format(
				selected.length,
				selected.length === 1 ? options.itemName : options.itemName + 's'
			))
		]);

		const deletePromises = selected.map(options.deletePromiseFn);

		Promise.all(deletePromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				ui.addNotification(null, E('p', _('Failed to delete %d %s').format(
					errors.length,
					errors.length === 1 ? options.itemName : options.itemName + 's'
				)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Successfully deleted %d %s').format(
					selected.length,
					selected.length === 1 ? options.itemName : options.itemName + 's'
				)), 3000, 'info');
			}

			if (options.onSuccess) {
				options.onSuccess();
			} else {
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to delete some %s: %s').format(
				options.itemName + 's',
				err.message
			)), 'error');
		});
	}
});
