'use strict';
'require view';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require ui';
'require podman.container-form as ContainerForm';

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
	 * Generic failure handler for rendering errors
	 * @param {string} message - Error message to display
	 * @returns {Element} Error element
	 */
	generic_failure: function(message) {
		return E('div', {
			'class': 'alert-message error'
		}, [_('RPC call failure: '), message]);
	},

	/**
	 * Load container data on view initialization
	 * @returns {Promise<Object>} Container data wrapped in object
	 */
	load: async () => {
		return podmanRPC.container.list('all=true')
			.then((containers) => {
				return { containers: containers || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load containers') };
			});
	},

	/**
	 * Render the containers view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Container view element
	 */
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return this.generic_failure(data.error);
		}

		// Initialize list helper
		this.listHelper = new pui.ListViewHelper({
			prefix: 'containers',
			itemName: 'container',
			rpc: podmanRPC.container,
			data: data.containers,
			view: this
		});

		const getContainerData = (sectionId) => data.containers[sectionId.replace('containers', '')];

		this.map = new form.JSONMap(data, _('Containers'));
		const section = this.map.section(form.TableSection, 'containers', '', _('Manage Podman containers'));
		let o;

		section.anonymous = true;
		section.nodescription = true;

		// Checkbox column for selection
		o = section.option(form.DummyValue, 'ID', new ui.Checkbox(0, { hiddenname: 'all' }).render());
		o.cfgvalue = (sectionId) => {
			return new ui.Checkbox(0, { hiddenname: sectionId }).render();
		};

		// Name column
		o = section.option(form.DummyValue, 'Names', _('Name'));
		o.cfgvalue = (sectionId) => {
			const container = getContainerData(sectionId);
			if (container.Names && container.Names[0]) {
				return container.Names[0];
			}
			return getContainerData(sectionId).Id.substring(0, 12);
		};

		// Id column
		o = section.option(form.DummyValue, 'Id', _('Id'));
		o.cfgvalue = (sectionId) => {
			return E('a', {
				href: L.url('admin/podman/container', getContainerData(sectionId).Id)
			}, utils.truncate(getContainerData(sectionId).Id, 10));
		};
		o.rawhtml = true;

		// Image column
		o = section.option(form.DummyValue, 'Image', _('Image'));

		// Status column
		o = section.option(form.DummyValue, 'State', _('Status'));

		// Created column
		o = section.option(form.DummyValue, 'Created', _('Created'));
		o.cfgvalue = (sectionId) => {
			const container = getContainerData(sectionId);
			return container && container.Created ? utils.formatDate(container.Created) : _('Unknown');
		};

		// Create toolbar using helper with custom buttons
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleRemove(),
			onRefresh: undefined, // No refresh button for containers
			onCreate: undefined, // Create handled by MultiButton below
			customButtons: [
				{
					text: '&#9658;', // Play symbol
					handler: () => this.handleStart(),
					cssClass: 'positive'
				},
				{
					text: '&#9724;', // Stop symbol
					handler: () => this.handleStop(),
					cssClass: 'negative'
				}
			]
		});

		// Add create menu button at the beginning of the toolbar
		const createButton = new pui.MultiButton({}, 'add')
			.addItem(_('Create Container'), () => this.handleCreateContainer())
			.addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
			.addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
			.render();

		toolbar.prependButton(createButton);

		return this.map.render().then((rendered) => {
			const header = rendered.querySelector('.cbi-section');
			if (header) {
				header.insertBefore(toolbar.container, header.firstChild);
			}

			// Setup "select all" checkbox using helper
			this.listHelper.setupSelectAll(rendered);

			return rendered;
		});
	},

	/**
	 * Get selected container IDs from checkboxes
	 * @returns {Array<string>} Array of selected container IDs
	 */
	getSelectedContainerIds: function() {
		return this.listHelper.getSelected((container) => container.Id);
	},

	handleCreateContainer: function() {
		ContainerForm.render();
	},

	handleImportFromRunCommand: function() {
		ui.showModal(_('Import from Run Command'), [
			E('p', {}, _('Import a container configuration from a docker/podman run command.')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Run Command')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('textarea', {
						'id': 'import-run-command',
						'class': 'cbi-input-textarea',
						'style': 'width: 100%; min-height: 150px;',
						'placeholder': 'docker run -d --name mycontainer -p 8080:80 nginx:latest'
					})
				])
			]),
			E('div', { 'class': 'right' }, [
				new pui.Button(_('Cancel'), () => ui.hideModal(), 'neutral').render(),
				' ',
				new pui.Button(_('Import'), () => {
					const cmd = document.getElementById('import-run-command').value;
					if (!cmd.trim()) {
						ui.addNotification(null, E('p', _('Please enter a run command')), 'error');
						return;
					}
					ui.hideModal();
					ui.addTimeLimitedNotification(null, E('p', _('Import from run command not yet implemented')), 3000, 'warning');
				}, 'positive').render()
			])
		]);
	},

	handleImportFromCompose: function() {
		// Feature not yet implemented
	},

	/**
	 * Handle container start action for selected containers
	 */
	handleStart: function() {
		const selected = this.getSelectedContainerIds();
		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No containers selected')), 3000, 'warning');
			return;
		}

		ui.showModal(_('Starting Containers'), [
			E('p', { 'class': 'spinning' }, _('Starting %d container(s)...').format(selected.length))
		]);

		const promises = selected.map((id) => podmanRPC.container.start(id));
		Promise.all(promises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				ui.addNotification(null, E('p', _('Failed to start %d container(s)').format(errors.length)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Started %d container(s) successfully').format(selected.length)), 3000, 'info');
			}
			window.location.reload();
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to start containers: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle container stop action for selected containers
	 */
	handleStop: function() {
		const selected = this.getSelectedContainerIds();
		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No containers selected')), 3000, 'warning');
			return;
		}

		ui.showModal(_('Stopping Containers'), [
			E('p', { 'class': 'spinning' }, _('Stopping %d container(s)...').format(selected.length))
		]);

		const promises = selected.map((id) => podmanRPC.container.stop(id));
		Promise.all(promises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				ui.addNotification(null, E('p', _('Failed to stop %d container(s)').format(errors.length)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Stopped %d container(s) successfully').format(selected.length)), 3000, 'info');
			}
			window.location.reload();
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to stop containers: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle container remove action for selected containers
	 */
	handleRemove: function() {
		utils.handleBulkDelete({
			selected: this.getSelectedContainerIds(),
			itemName: 'container',
			deletePromiseFn: (id) => podmanRPC.container.remove(id, false)
		});
	}
});
