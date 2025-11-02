'require baseclass';
'require ui';
'require podman.ui as podmanUI';
'require podman.utils as utils';
'require podman.rpc as podmanRPC';

const ListUtil = baseclass.extend({
	__name__: 'ListUtil',
	__init__: function (options) {
		this.itemName = options.itemName;
		this.prefix = this.itemName + 's';
		this.rpc = options.rpc;
		this.data = options.data;
		this.view = options.view;

		// Determine the data key for accessing the array
		// Try prefix first, fallback to first key in object
		if (this.data && typeof this.data === 'object' && !Array.isArray(this.data)) {
			if (this.data[this.prefix]) {
				this.dataKey = this.prefix;
			} else {
				// Fallback: use first key
				const keys = Object.keys(this.data);
				if (keys.length > 0) {
					this.dataKey = keys[0];
				}
			}
		}
	},

	getDataArray: function () {
		if (!this.data) return [];

		// If data is already an array, return it
		if (Array.isArray(this.data)) {
			return this.data;
		}

		// If data is an object, extract array using dataKey
		if (this.dataKey && this.data[this.dataKey]) {
			return this.data[this.dataKey];
		}

		return [];
	},

	setupSelectAll: function (rendered) {
		utils.setupSelectAllCheckbox(rendered, this.prefix);
	},

	createToolbar: function (options) {
		const buttons = [];

		// Create button (first for prominence)
		if (options.onCreate !== undefined) {
			buttons.push(new podmanUI.Button(
				_('Create %s').format(this.itemName.charAt(0).toUpperCase() + this
					.itemName.slice(1)),
				options.onCreate,
				'add'
			).render());
			buttons.push(' ');
		}

		// Delete button
		if (options.onDelete !== undefined) {
			buttons.push(new podmanUI.Button(
				_('Delete Selected'),
				options.onDelete,
				'remove'
			).render());
			buttons.push(' ');
		}

		// Custom buttons
		if (options.customButtons) {
			options.customButtons.forEach((btn) => {
				buttons.push(new podmanUI.Button(btn.text, btn.handler, btn.cssClass)
					.render());
				buttons.push(' ');
			});
		}

		// Refresh button (last)
		if (options.onRefresh !== undefined) {
			buttons.push(new podmanUI.Button(
				_('Refresh'),
				options.onRefresh || (() => window.location.reload()),
				'apply'
			).render());
		}

		const container = E('div', {
			'style': 'margin-bottom: 10px;'
		}, buttons);

		return {
			container: container,
			buttons: buttons,
			// Helper method to add buttons at the end of toolbar
			addButton: function (button) {
				container.appendChild(document.createTextNode(' '));
				container.appendChild(button);
			},
			// Helper method to add buttons at the beginning of toolbar
			prependButton: function (button) {
				if (container.firstChild) {
					container.insertBefore(document.createTextNode(' '), container
						.firstChild);
					container.insertBefore(button, container.firstChild);
				} else {
					container.appendChild(button);
				}
			}
		};
	},

	getSelected: function (extractFn) {
		return utils.getSelectedFromCheckboxes(this.prefix, this.getDataArray(), extractFn);
	},

	bulkDelete: function (options) {
		const selected = options.selected || this.getSelected();

		if (selected.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format(this.itemName + 's'));
			return;
		}

		// Format item names for confirmation
		const formatFn = options.formatItemName || ((item) => typeof item === 'string' ? item :
			item.name || item.Name || item.id || item.Id);
		const itemNames = selected.map(formatFn).join(', ');

		if (!confirm(_('Are you sure you want to remove %d %s?\n\n%s').format(
				selected.length,
				selected.length === 1 ? this.itemName : this.itemName + 's',
				itemNames
			))) {
			return;
		}

		podmanUI.showSpinningModal(_('Deleting %s').format(this.itemName + 's'), _(
			'Deleting %d selected %s...').format(
			selected.length,
			selected.length === 1 ? this.itemName : this.itemName + 's'
		));

		const deletePromises = selected.map(options.deletePromiseFn);

		Promise.all(deletePromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				podmanUI.errorNotification(_('Failed to delete %d %s').format(
					errors.length,
					errors.length === 1 ? this.itemName : this.itemName + 's'
				));
			} else {
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
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to delete some %s: %s').format(this
				.itemName + 's', err.message));
		});
	},

	refreshTable: function (clearSelections) {
		if (!this.view) {
			console.error('ListViewHelper: view reference is required for refreshTable()');
			return Promise.reject(new Error('view reference required'));
		}

		const indicatorId = 'podman-refresh-' + this.prefix;
		ui.showIndicator(indicatorId, _('Refreshing %s...').format(this.prefix));

		return this.view.load().then((data) => {
			// Update listHelper data reference - single source of truth
			this.data = data;

			// Get the data array
			const itemsArray = this.getDataArray();
			const config_name = this.view.map.config;

			// Remove all existing sections
			const existingSections = this.view.map.data.sections(config_name, this
				.prefix);
			existingSections.forEach((section) => {
				this.view.map.data.remove(config_name, section['.name']);
			});

			(itemsArray || []).forEach((item, index) => {
				this.view.map.data.add(config_name, this.prefix, this.prefix +
					index);

				const newData = Object.assign(this.view.map.data.data[this
					.prefix + index], item);
				this.view.map.data.data[this.prefix + index] = newData;
			});

			return this.view.map.save(null, true);
		}).then(() => {
			// Always setup checkboxes after refresh, optionally clear them
			const container = document.querySelector('.podman-view-container');
			if (container) {
				this.setupSelectAll(container);

				// Clear all checkboxes if requested
				if (clearSelections) {
					const checkboxes = container.querySelectorAll(
						'input[type="checkbox"]');
					checkboxes.forEach((cb) => {
						cb.checked = false;
					});
				}
			}
			ui.hideIndicator(indicatorId);
		}).catch((err) => {
			ui.hideIndicator(indicatorId);
			podmanUI.errorNotification(_('Failed to refresh: %s').format(err.message));
		});
	},

	showInspect: function (identifier, hiddenFields, closeButtonFn) {
		podmanUI.showSpinningModal(_('Fetching information...'), _('Loading %s Details').format(
			this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1)));

		this.rpc.inspect(identifier).then((data) => {
			ui.hideModal();

			if (!data) {
				podmanUI.errorNotification(_('No data received'));
				return;
			}

			this.showInspectModal(
				_('%s Information').format(this.itemName.charAt(0).toUpperCase() +
					this.itemName.slice(1)),
				data,
				hiddenFields,
				closeButtonFn
			);
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to inspect: %s').format(err.message));
		});
	},

	showInspectModal: function (title, data, hiddenFields, closeButton) {
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
			content.unshift(E('p', {
				'style': 'margin-bottom: 10px; color: #e74c3c;'
			}, [
				E('strong', {}, _('Security Notice:')),
				' ',
				_('Sensitive data is hidden for security reasons.')
			]));
		}

		// Add close button
		if (closeButton && typeof closeButton === 'function') {
			content.push(closeButton());
		} else {
			content.push(E('div', {
				'class': 'right',
				'style': 'margin-top: 10px;'
			}, [
				E('button', {
					'class': 'cbi-button',
					'click': () => ui.hideModal()
				}, _('Close'))
			]));
		}

		ui.showModal(title, content);
	},
});

const List = baseclass.extend({
	Util: ListUtil,
});

return List;
