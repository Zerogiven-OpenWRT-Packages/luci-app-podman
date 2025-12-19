'use strict';

'require baseclass';
'require ui';
'require podman.utils as utils';
'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

/**
 * List view helper utilities for table-based resource management.
 * Provides common operations: selection, bulk actions, refresh, and inspect modals.
 */
const ListUtil = baseclass.extend({
	__name__: 'ListUtil',

	/**
	 * Initialize list helper.
	 * @param {{itemName: string, rpc: Object, data: Object|Array, view: Object}} options - Config
	 */
	__init__: function (options) {
		this.itemName = options.itemName;
		this.prefix = this.itemName + 's';
		this.rpc = options.rpc;
		this.data = options.data;
		this.view = options.view;

		if (this.data && typeof this.data === 'object' && !Array.isArray(this.data)) {
			if (this.data[this.prefix]) {
				this.dataKey = this.prefix;
			} else {
				const keys = Object.keys(this.data);
				if (keys.length > 0) {
					this.dataKey = keys[0];
				}
			}
		}
	},

	/**
	 * Get data as array.
	 * @returns {Array} Data items
	 */
	getDataArray: function () {
		if (!this.data) return [];
		if (Array.isArray(this.data)) return this.data;
		if (this.dataKey && this.data[this.dataKey]) return this.data[this.dataKey];
		return [];
	},

	/**
	 * Setup "select all" checkbox with shift-select support.
	 * @param {HTMLElement} rendered - Table container
	 */
	setupSelectAll: function (rendered) {
		utils.setupSelectAllCheckbox(rendered, this.prefix);
	},

	/**
	 * Create toolbar with action buttons (create, delete, refresh, custom).
	 * @param {{onCreate: Function, onDelete: Function, onRefresh: Function, customButtons: Array}} options - Button config
	 * @returns {{container: Element, buttons: Array, addButton: Function, prependButton: Function}} Toolbar
	 */
	createToolbar: function (options) {
		const buttons = [];

		if (options.onCreate !== undefined) {
			const capitalizedItemName = this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1);
			buttons.push(new podmanUI.Button(
				_('Create %s').format(_(capitalizedItemName)),
				options.onCreate, 'add'
			).render(), ' ');
		}

		if (options.onDelete !== undefined) {
			buttons.push(new podmanUI.Button(_('Delete Selected'), options.onDelete, 'remove').render(), ' ');
		}

		if (options.customButtons) {
			options.customButtons.forEach((btn) => {
				buttons.push(new podmanUI.Button(btn.text, btn.handler, btn.cssClass, btn.tooltip).render(), ' ');
			});
		}

		if (options.onRefresh !== undefined) {
			buttons.push(new podmanUI.Button(
				_('Refresh'), options.onRefresh || (() => window.location.reload()), 'apply'
			).render());
		}

		const container = E('div', { 'style': 'margin-bottom: 10px;' }, buttons);

		return {
			container: container,
			buttons: buttons,
			addButton: function(button) {
				container.appendChild(document.createTextNode(' '));
				container.appendChild(button);
			},
			prependButton: function(button) {
				if (container.firstChild) {
					container.insertBefore(document.createTextNode(' '), container.firstChild);
					container.insertBefore(button, container.firstChild);
				} else {
					container.appendChild(button);
				}
			}
		};
	},

	/**
	 * Get selected items using extractor function.
	 * @param {Function} extractFn - Extracts value from item: (item, index) => value
	 * @returns {Array} Selected values
	 */
	getSelected: function (extractFn) {
		return utils.getSelectedFromCheckboxes(this.prefix, this.getDataArray(), extractFn);
	},

	/**
	 * Delete selected items with confirmation and progress modal.
	 *
	 * @param {Object} options - Delete configuration
	 * @param {Array} options.selected - Items to delete
	 * @param {Function} options.deletePromiseFn - Function to delete each item
	 * @param {Function} [options.formatItemName] - Format item for display
	 * @param {Function} [options.preDeleteCheck] - Function(items) => Promise<checkResults[]>
	 * @param {Function} [options.confirmMessage] - Function(items, checkResults) => string
	 * @param {Function} [options.afterDeleteEach] - Function(item, checkResult) => Promise
	 * @param {Function} [options.cleanupErrorMessage] - Function(errorCount) => string
	 * @param {Function} [options.onSuccess] - Callback after successful deletion
	 */
	bulkDelete: function (options) {
		const selected = options.selected || this.getSelected();

		if (selected.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format(this.itemName + 's'));
			return;
		}

		// Pre-delete check hook (optional)
		const checkPromise = options.preDeleteCheck
			? options.preDeleteCheck(selected)
			: Promise.resolve(null);

		checkPromise.then((checkResults) => {
			const confirmMsg = this._buildConfirmMessage(selected, checkResults, options);

			if (!confirm(confirmMsg)) {
				return;
			}

			this._executeBulkDelete(selected, checkResults, options);
		});
	},

	/**
	 * Build confirmation message with optional custom message.
	 */
	_buildConfirmMessage: function (selected, checkResults, options) {
		const formatFn = options.formatItemName || ((item) => typeof item === 'string' ? item : item.name || item.Name || item.id || item.Id);
		const itemNames = selected.map(formatFn).join(', ');

		let msg = _('Are you sure you want to delete %d %s?\n\n%s').format(
			selected.length,
			selected.length === 1 ? this.itemName : this.itemName + 's',
			itemNames
		);

		// Custom confirmation message hook (optional)
		if (options.confirmMessage && checkResults) {
			const customMsg = options.confirmMessage(selected, checkResults);
			if (customMsg) {
				msg += '\n\n' + customMsg;
			}
		}

		return msg;
	},

	/**
	 * Execute bulk delete with optional per-item cleanup.
	 */
	_executeBulkDelete: function (selected, checkResults, options) {
		podmanUI.showSpinningModal(
			_('Deleting %s').format(this.itemName + 's'),
			_('Deleting %d selected %s...').format(
				selected.length,
				selected.length === 1 ? this.itemName : this.itemName + 's'
			)
		);

		const deletePromises = selected.map((item, index) => {
			const checkResult = checkResults ? checkResults[index] : null;

			return options.deletePromiseFn(item).then((result) => {
				if (result && result.error) {
					// Main deletion failed
					return {
						item: item,
						error: result.error
					};
				}

				// Main deletion succeeded - run cleanup if provided
				if (options.afterDeleteEach) {
					return options.afterDeleteEach(item, checkResult).then((cleanupResult) => {
						// Cleanup can return error object
						if (cleanupResult && cleanupResult.error) {
							return {
								item: item,
								success: true,
								cleanupError: cleanupResult.error
							};
						}
						return {
							item: item,
							success: true
						};
					}).catch((err) => {
						// Cleanup failed with exception
						return {
							item: item,
							success: true,
							cleanupError: err.message
						};
					});
				}

				return {
					item: item,
					success: true
				};
			}).catch((err) => {
				return {
					item: item,
					error: err.message
				};
			});
		});

		Promise.all(deletePromises).then((results) => {
			this._handleDeleteResults(results, selected, options);
		});
	},

	/**
	 * Handle delete results with 3-tier error handling:
	 * 1. Main errors (critical) -> Error notification
	 * 2. Cleanup errors (non-critical) -> Warning notification
	 * 3. All success -> Success notification
	 */
	_handleDeleteResults: function (results, selected, options) {
		ui.hideModal();

		const mainErrors = results.filter((r) => r.error);
		const cleanupErrors = results.filter((r) => r.cleanupError);
		const successes = results.filter((r) => r.success && !r.cleanupError);

		// Priority: Main errors > Cleanup errors > Success
		if (mainErrors.length > 0) {
			// Critical: Main deletion failed
			podmanUI.errorNotification(_('Failed to delete %d %s').format(
				mainErrors.length,
				mainErrors.length === 1 ? this.itemName : this.itemName + 's'
			));
		} else if (cleanupErrors.length > 0) {
			// Warning: Deletion succeeded but cleanup failed
			if (options.cleanupErrorMessage) {
				podmanUI.warningNotification(options.cleanupErrorMessage(cleanupErrors.length));
			}
			// If no custom message provided, cleanup errors are silently ignored
		} else {
			// Success: Everything worked
			podmanUI.successTimeNotification(_('Successfully deleted %d %s').format(
				selected.length,
				selected.length === 1 ? this.itemName : this.itemName + 's'
			));
		}

		if (options.onSuccess) {
			options.onSuccess();
		} else {
			window.location.reload();
		}
	},

	/**
	 * Reload table data and re-render without full page reload.
	 * @param {boolean} clearSelections - Clear checkboxes after refresh
	 * @returns {Promise} Resolution when refresh completes
	 */
	refreshTable: function (clearSelections) {
		if (!this.view) {
			console.error('ListViewHelper: view reference required for refreshTable()');
			return Promise.reject(new Error('view reference required'));
		}

		const indicatorId = 'podman-refresh-' + this.prefix;
		ui.showIndicator(indicatorId, _('Refreshing %s...').format(this.prefix));

		return this.view.load().then((data) => {
			this.data = data;
			const itemsArray = this.getDataArray();
			const config_name = this.view.map.config;

			const existingSections = this.view.map.data.sections(config_name, this.prefix);
			existingSections.forEach((section) => {
				this.view.map.data.remove(config_name, section['.name']);
			});

			(itemsArray || []).forEach((item, index) => {
				this.view.map.data.add(config_name, this.prefix, this.prefix + index);
				const newData = Object.assign(this.view.map.data.data[this.prefix + index], item);
				this.view.map.data.data[this.prefix + index] = newData;
			});

			return this.view.map.save(null, true);
		}).then(() => {
			const container = document.querySelector('.podman-view-container');
			if (container) {
				this.setupSelectAll(container);
				if (clearSelections) {
					container.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked = false);
				}
			}
			ui.hideIndicator(indicatorId);
		}).catch((err) => {
			ui.hideIndicator(indicatorId);
			podmanUI.errorNotification(_('Failed to refresh: %s').format(err.message));
		});
	},

	/**
	 * Fetch and show inspect modal for resource.
	 * @param {string} identifier - Resource ID or name
	 * @param {Array} [hiddenFields] - Fields to mask (e.g., ['SecretData'])
	 * @param {Function} [closeButtonFn] - Custom close button renderer
	 */
	showInspect: function (identifier, hiddenFields, closeButtonFn) {
		podmanUI.showSpinningModal(_('Fetching information...'), _('Loading %s Details').format(
			this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1)));

		this.rpc.inspect(identifier).then((data) => {
			ui.hideModal();

			if (!data) {
				podmanUI.errorNotification(_('No data received'));
				return;
			}

			const capitalizedItemName = this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1);
			this.showInspectModal(
				_('%s Information').format(_(capitalizedItemName)),
				data,
				hiddenFields,
				closeButtonFn
			);
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to inspect: %s').format(err.message));
		});
	},

	/**
	 * Display JSON data in formatted modal with optional field masking.
	 * @param {string} title - Modal title
	 * @param {Object} data - JSON data to display
	 * @param {Array} [hiddenFields] - Field names to mask with '***HIDDEN***'
	 * @param {Function} [closeButton] - Custom close button renderer
	 */
	showInspectModal: function(title, data, hiddenFields, closeButton) {
		const displayData = JSON.parse(JSON.stringify(data));

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

		if (hiddenFields && hiddenFields.length > 0) {
			content.unshift(E('p', { 'style': 'margin-bottom: 10px; color: #e74c3c;' }, [
				E('strong', {}, _('Security Notice:')), ' ', _('Sensitive data is hidden for security reasons.')
			]));
		}

		if (closeButton && typeof closeButton === 'function') {
			content.push(closeButton());
		} else {
			content.push(E('div', { 'class': 'right', 'style': 'margin-top: 10px;' }, [
				E('button', { 'class': 'cbi-button', 'click': () => ui.hideModal() }, _('Close'))
			]));
		}

		ui.showModal(title, content);
	}
});

const List = baseclass.extend({
	Util: ListUtil,
});

return List;
