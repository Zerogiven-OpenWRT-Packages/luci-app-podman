'use strict';

'require baseclass'

/**
 * Shared utility functions for Podman LuCI application.
 * Provides DOM helpers, error rendering, and checkbox selection utilities.
 */
return baseclass.extend({

	/**
	 * Render error message for RPC failures.
	 * @param {string} message - Error message
	 * @returns {Element} Error div element
	 */
	renderError: function (message) {
		return E('div', {
			'class': 'alert-message error'
		}, [_('RPC call failure: '), message]);
	},

	/**
	 * Truncate string with ellipsis.
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
	 * Setup select-all checkbox with shift-select support.
	 * @param {HTMLElement} rendered - Table container
	 * @param {string} prefix - Checkbox name prefix
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
	 * Get selected items using extractor function.
	 * @param {string} prefix - Checkbox name prefix
	 * @param {Array} dataArray - Data array
	 * @param {Function} extractFn - Extracts value: (item, index) => value
	 * @returns {Array} Selected values
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
	 * Extract port information from NetworkSettings.Ports.
	 * Handles both mapped ports (with host binding) and exposed ports (null binding).
	 * @param {Object} ports - NetworkSettings.Ports object
	 * @returns {Array} Array of {containerPort, protocol, hostPort, hostIp, isMapped}
	 */
	extractPorts: function (ports) {
		if (!ports) return [];

		const result = [];
		Object.keys(ports).forEach((containerPort) => {
			const parts = containerPort.split('/');
			const portNum = parts[0];
			const protocol = parts[1] || 'tcp';
			const bindings = ports[containerPort];

			if (bindings && bindings.length > 0) {
				// Mapped port with host binding
				bindings.forEach((binding) => {
					result.push({
						containerPort: portNum,
						protocol: protocol,
						hostPort: binding.HostPort,
						hostIp: binding.HostIp || '0.0.0.0',
						isMapped: true
					});
				});
			} else {
				// Exposed port without host mapping
				result.push({
					containerPort: portNum,
					protocol: protocol,
					hostPort: null,
					hostIp: null,
					isMapped: false
				});
			}
		});

		// Sort by container port number
		result.sort((a, b) => parseInt(a.containerPort) - parseInt(b.containerPort));

		return result;
	},

	_p: function(stringPlurarl) {
		return this._n(2, '', stringPlurarl);
	},

	_n: function (length, stringSingular, stringPlural) {
		return Number.parseInt(length) === 1 ?
			stringSingular : stringPlural;
	}
});
