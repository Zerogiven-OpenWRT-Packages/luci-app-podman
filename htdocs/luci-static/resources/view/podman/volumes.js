'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.form as pform';

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
				return { volumes: volumes || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load volumes') };
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
		this.listHelper = new pui.ListViewHelper({
			prefix: 'volumes',
			itemName: 'volume',
			rpc: podmanRPC.volume,
			data: data,
			view: this
		});

		const getVolumeData = (sectionId) => {
			return this.listHelper.data.volumes[sectionId.replace('volumes', '')];
		}

		this.map = new form.JSONMap(this.listHelper.data, _('Volumes'));
		const section = this.map.section(form.TableSection, 'volumes', '', _('Manage Podman volumes'));
		let o;

		section.anonymous = true;
		section.nodescriptions = true;

		// Checkbox column for selection
		o = section.option(form.DummyValue, 'Name', new ui.Checkbox(0, { hiddenname: 'all' }).render());
		o.cfgvalue = (sectionId) => {
			return new ui.Checkbox(0, { hiddenname: sectionId }).render();
		};

		// Name column
		o = section.option(form.DummyValue, 'VolumeName', _('Name'));
		o.cfgvalue = (sectionId) => {
			const volume = getVolumeData(sectionId);
			return E('a', {
				href: '#',
				click: (ev) => {
					ev.preventDefault();
					this.handleInspect(volume.Name);
				}
			}, E('strong', { 'title': volume.Name || _('Unknown') }, utils.truncate(volume.Name || _('Unknown'), 20)));
		};
		o.rawhtml = true;

		// Driver column
		o = section.option(form.DummyValue, 'Driver', _('Driver'));
		o.cfgvalue = (sectionId) => {
			const volume = getVolumeData(sectionId);
			return volume && volume.Driver ? volume.Driver : _('local');
		};

		// Mountpoint column
		o = section.option(form.DummyValue, 'Mountpoint', _('Mountpoint'));
		o.cfgvalue = (sectionId) => {
			const volume = getVolumeData(sectionId);
			return utils.truncate(volume.Mountpoint || _('N/A'), 30);
		};

		// Created column
		o = section.option(form.DummyValue, 'CreatedAt', _('Created'));
		o.cfgvalue = (sectionId) => {
			const volume = getVolumeData(sectionId);
			return volume.CreatedAt ? utils.formatDate(Date.parse(volume.CreatedAt) / 1000) : _('Unknown');
		};

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateVolume()
		});

		return this.map.render().then((mapRendered) => {
			// Create wrapper container to separate toolbar from map
			// This prevents toolbar from being wiped during map.save() refresh
			const viewContainer = E('div', { 'class': 'podman-view-container' });

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
	 * Get selected volume names from checkboxes
	 * @returns {Array<string>} Array of selected volume names
	 */
	getSelectedVolumes: function () {
		return this.listHelper.getSelected((volume) => volume.Name);
	},

	/**
	 * Delete selected volumes
	 */
	handleDeleteSelected: function () {
		utils.handleBulkDelete({
			selected: this.getSelectedVolumes(),
			itemName: 'volume',
			deletePromiseFn: (name) => podmanRPC.volume.remove(name, false),
			onSuccess: () => this.refreshTable(true)
		});
	},

	/**
	 * Refresh volume list
	 */
	handleRefresh: function () {
		this.refreshTable(false);
	},

	/**
	 * Show create volume dialog
	 */
	handleCreateVolume: function () {
		new pform.Volume().render(() => this.handleRefresh());
	},

	/**
	 * Show volume details
	 * @param {string} name - Volume name
	 */
	handleInspect: function (name) {
		this.listHelper.showInspect(name);
	}
});
