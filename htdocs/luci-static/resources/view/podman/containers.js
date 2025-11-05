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
 * Container management view with create, start, stop, health check, and delete operations
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load container data (all containers including stopped)
	 * @returns {Promise<Object>} Container data or error
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
	 * Render containers view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function(data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

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

		o = section.option(podmanForm.field.SelectDummyValue, 'ID', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		o = section.option(form.DummyValue, 'Names', _('Name'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];

			if (container.Names && container.Names[0]) {
				return container.Names[0];
			}
			return utils.truncate(container.Id, 10);
		};

		o = section.option(form.DummyValue, 'Id', _('Id'));
		o.cfgvalue = (sectionId) => {
			const containerId = this.map.data.data[sectionId].Id;
			return E('a', {
				href: L.url('admin/podman/container', containerId)
			}, utils.truncate(containerId, 10));
		};

		o = section.option(podmanForm.field.DataDummyValue, 'Image', _('Image'));
		o = section.option(podmanForm.field.DataDummyValue, 'State', _('Status'));
		o = section.option(form.DummyValue, 'Health', _('Health'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const health = container.State && container.State.Health;

			if (!health) {
				return E('span', {
					'style': 'color: #999;'
				}, '—');
			}

			const status = health.Status || 'starting';
			const badgeClass = 'badge status-' + status.toLowerCase();

			return E('span', {
				'class': badgeClass
			}, status);
		};
		o.rawhtml = true;
		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = utils.formatDate;

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleRemove(),
			onRefresh: () => this.refreshTable(false),
			onCreate: undefined,
			customButtons: [{
					text: '&#9658;',
					handler: () => this.handleStart(),
					cssClass: 'positive',
					tooltip: _('Start selected containers')
				},
				{
					text: '&#9724;',
					handler: () => this.handleStop(),
					cssClass: 'negative',
					tooltip: _('Stop selected containers')
				},
				{
					text: '&#10010;',
					handler: () => this.handleBulkHealthCheck(),
					cssClass: 'apply',
					tooltip: _('Run health checks on selected containers')
				}
			]
		});

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

			viewContainer.appendChild(toolbar.container);
			viewContainer.appendChild(mapRendered);
			this.listHelper.setupSelectAll(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Refresh table data
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	refreshTable: function (clearSelections) {
		return this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Get selected container IDs
	 * @returns {Array<string>} Array of container IDs
	 */
	getSelectedContainerIds: function () {
		return this.listHelper.getSelected((container) => container.Id);
	},

	/**
	 * Show create container form
	 */
	handleCreateContainer: function () {
		const form = new podmanForm.Container();
		form.submit = () => this.refreshTable(false);
		form.render();
	},

	/**
	 * Show import from docker run command dialog
	 */
	handleImportFromRunCommand: function () {
		const form = new podmanForm.Container();
		form.submit = () => this.refreshTable(false);
		form.showImportFromRunCommand();
	},

	/**
	 * Show import from compose file dialog (not implemented)
	 */
	handleImportFromCompose: function() {
	},

	/**
	 * Start selected containers
	 */
	handleStart: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.startContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Stop selected containers
	 */
	handleStop: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.stopContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Remove selected containers
	 */
	handleRemove: function () {
		this.listHelper.bulkDelete({
			selected: this.getSelectedContainerIds(),
			deletePromiseFn: (id) => podmanRPC.container.remove(id, true, true),
			onSuccess: () => this.refreshTable(true)
		});
	},

	/**
	 * Run health checks on selected containers
	 */
	handleBulkHealthCheck: function () {
		const selected = this.getSelectedContainerIds();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No containers selected')), 3000,
				'warning');
			return;
		}

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
