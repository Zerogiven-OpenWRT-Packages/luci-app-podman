'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';

/**
 * @module view.podman.volumes
 * @description Volume management view using proper LuCI form components
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load volume data on view initialization
	 * @returns {Promise<Object>} Volume data wrapped in object
	 */
	load: async () => {
		return podmanRPC.volume.list()
			.then((volumes) => {
				return {
					volumes: volumes || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed to load volumes')
				};
			});
	},

	/**
	 * Render the volumes view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Volumes view element
	 */
	render: function (data) {
		// Handle errors from load()
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		// Initialize list helper with full data object
		this.listHelper = new List.Util({
			itemName: 'volume',
			rpc: podmanRPC.volume,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Volumes'));

		const section = this.map.section(form.TableSection, 'volumes', '', _(
			'Manage Podman volumes'));
		section.anonymous = true;

		let o;

		// Checkbox column for selection
		o = section.option(podmanForm.field.SelectDummyValue, 'Name', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		// Name column
		o = section.option(podmanForm.field.LinkDataDummyValue, 'VolumeName', _('Name'));
		o.click = (volume) => this.handleInspect(volume.Name);
		o.text = (volume) => utils.truncate(volume.Name || _('Unknown'), 20);
		o.linktitle = (volume) => volume.Name || _('Unknown');

		// Driver column
		o = section.option(podmanForm.field.DataDummyValue, 'Driver', _('Driver'));
		o.cfgdefault = _('local');

		// Mountpoint column
		o = section.option(podmanForm.field.DataDummyValue, 'Mountpoint', _('Mountpoint'));
		o.cfgdefault = _('N/A');
		o.cfgtitle = (cfg) => cfg;
		o.cfgformatter = (cfg) => utils.truncate(cfg, 30);

		// Created column
		o = section.option(podmanForm.field.DataDummyValue, 'CreatedAt', _('Created'));
		o.cfgformatter = (cfg) => utils.formatDate(Date.parse(cfg) / 1000);

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateVolume()
		});

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
	 * Delete selected volumes
	 */
	handleDeleteSelected: function () {
		this.listHelper.bulkDelete({
			selected: this.listHelper.getSelected((volume) => volume.Name),
			deletePromiseFn: (name) => podmanRPC.volume.remove(name, false),
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Refresh volume list
	 */
	handleRefresh: function (clearSelections) {
		clearSelections = clearSelections || false;
		this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Show create volume dialog
	 */
	handleCreateVolume: function () {
		const form = new podmanForm.Volume();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Show volume details
	 * @param {string} name - Volume name
	 */
	handleInspect: function (name) {
		this.listHelper.showInspect(name);
	}
});
