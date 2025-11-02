'use strict';
'require view';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';
'require podman.container-util as ContainerUtil';
'require ui';

/**
 * @module view.podman.containers
 * @description Container management view using proper LuCI form components
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load container data on view initialization
	 * @returns {Promise<Object>} Container data wrapped in object
	 */
	load: async () => {
		return podmanRPC.container.list('all=true')
			.then((containers) => {
				return {
					containers: containers || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed to load containers')
				};
			});
	},

	/**
	 * Render the containers view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Container view element
	 */
	render: function (data) {
		// Handle errors from load()
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		// Initialize list helper with full data object
		this.listHelper = new List.Util({
			itemName: 'container',
			rpc: podmanRPC.container,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Containers'));

		const section = this.map.section(form.TableSection, 'containers', '', _(
			'Manage Podman containers'));
		section.anonymous = true;

		let o;

		// Checkbox column for selection
		o = section.option(podmanForm.field.SelectDummyValue, 'ID', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		// Name column
		o = section.option(form.DummyValue, 'Names', _('Name'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];

			if (container.Names && container.Names[0]) {
				return container.Names[0];
			}
			return utils.truncate(container.Id, 10);
		};

		// Id column
		o = section.option(form.DummyValue, 'Id', _('Id'));
		o.cfgvalue = (sectionId) => {
			const containerId = this.map.data.data[sectionId].Id;
			return E('a', {
				href: L.url('admin/podman/container', containerId)
			}, utils.truncate(containerId, 10));
		};

		// Image column
		o = section.option(podmanForm.field.DataDummyValue, 'Image', _('Image'));
		// Status column
		o = section.option(podmanForm.field.DataDummyValue, 'State', _('Status'));
		// Health column
		o = section.option(form.DummyValue, 'Health', _('Health'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const health = container.State && container.State.Health;

			// No health check configured - show em dash
			if (!health) {
				return E('span', {
					'style': 'color: #999;'
				}, '—');
			}

			// Health check configured but status not set yet or empty - treat as starting
			const status = health.Status || 'starting';
			const badgeClass = 'badge status-' + status.toLowerCase();

			return E('span', {
				'class': badgeClass
			}, status);
		};
		o.rawhtml = true;
		// Created column
		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = utils.formatDate;

		// Create toolbar using helper with custom buttons
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleRemove(),
			onRefresh: () => this.refreshTable(false),
			onCreate: undefined, // Create handled by MultiButton below
			customButtons: [{
					text: '&#9658;', // Play symbol
					handler: () => this.handleStart(),
					cssClass: 'positive'
				},
				{
					text: '&#9724;', // Stop symbol
					handler: () => this.handleStop(),
					cssClass: 'negative'
				},
				{
					text: '&#10010;', // Heavy plus sign (health check symbol)
					handler: () => this.handleBulkHealthCheck(),
					cssClass: 'apply'
				}
			]
		});

		// Add create menu button at the beginning of the toolbar
		const createButton = new podmanUI.MultiButton({}, 'add')
			.addItem(_('Create Container'), () => this.handleCreateContainer())
			.addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
			.addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
			.render();

		toolbar.prependButton(createButton);

		return this.map.render().then((mapRendered) => {
			const viewContainer = E('div', {
				'class': 'podman-view-container'
			});

			// Add toolbar outside map (persists during refresh)
			viewContainer.appendChild(toolbar.container);
			// Add map content
			viewContainer.appendChild(mapRendered);
			// Setup "select all" checkbox using helper
			this.listHelper.setupSelectAll(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Refresh table data without full page reload
	 * @param {boolean} clearSelections - Whether to clear checkbox selections after refresh
	 */
	refreshTable: function (clearSelections) {
		return this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Get selected container IDs from checkboxes
	 * @returns {Array<string>} Array of selected container IDs
	 */
	getSelectedContainerIds: function () {
		return this.listHelper.getSelected((container) => container.Id);
	},

	handleCreateContainer: function () {
		const form = new podmanForm.Container();
		form.submit = () => this.refreshTable(false);
		form.render();
	},

	handleImportFromRunCommand: function () {
		const form = new podmanForm.Container();
		form.submit = () => this.refreshTable(false);
		form.showImportFromRunCommand();
	},

	handleImportFromCompose: function () {
		// Feature not yet implemented
	},

	/**
	 * Handle container start action for selected containers
	 */
	handleStart: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.startContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Handle container stop action for selected containers
	 */
	handleStop: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.stopContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Handle container remove action for selected containers
	 */
	handleRemove: function () {
		this.listHelper.bulkDelete({
			selected: this.getSelectedContainerIds(),
			deletePromiseFn: (id) => podmanRPC.container.remove(id, true, true),
			onSuccess: () => this.refreshTable(true)
		});
	},

	/**
	 * Handle bulk health check action for selected containers
	 */
	handleBulkHealthCheck: function () {
		const selected = this.getSelectedContainerIds();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No containers selected')), 3000,
				'warning');
			return;
		}

		// Filter containers that have health checks configured
		const containersWithHealth = selected.filter((id) => {
			const container = this.listHelper.data.containers.find((c) => c.Id === id);
			return container && container.State && container.State.Health;
		});

		if (containersWithHealth.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _(
				'No selected containers have health checks configured')), 3000, 'warning');
			return;
		}

		podmanUI.showSpinningModal(_('Running Health Checks'), _(
			'Running health checks on selected containers...'));

		const healthCheckPromises = containersWithHealth.map((id) => {
			return podmanRPC.container.healthcheck(id).catch((err) => {
				return {
					error: err.message,
					id: id
				};
			});
		});

		Promise.all(healthCheckPromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				const errorMsg = errors.map((e) => `${e.id.substring(0, 12)}: ${e.error}`)
					.join(', ');
				podmanUI.errorNotification(_(
					'Failed to run health checks on some containers: %s').format(
					errorMsg));
			} else {
				podmanUI.successTimeNotification(_(
					'Health checks completed successfully'));
			}
			this.refreshTable(false);
		});
	}
});
