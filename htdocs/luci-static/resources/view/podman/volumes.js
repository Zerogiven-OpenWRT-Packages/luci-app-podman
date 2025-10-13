'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.volume-form as VolumeForm';

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
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return this.generic_failure(data.error);
		}

		// Initialize list helper
		this.listHelper = new pui.ListViewHelper({
			prefix: 'volumes',
			itemName: 'volume',
			rpc: podmanRPC.volume,
			data: data.volumes,
			view: this
		});

		const getVolumeData = (sectionId) => data.volumes[sectionId.replace('volumes', '')];

		this.map = new form.JSONMap(data, _('Volumes'));
		const section = this.map.section(form.TableSection, 'volumes', '', _('Manage Podman volumes'));
		let o;

		section.anonymous = true;
		section.nodescription = true;

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
			}, E('strong', {}, volume.Name || _('Unknown')));
		};
		o.rawhtml = true;

		// Driver column
		o = section.option(form.DummyValue, 'Driver', _('Driver'));

		// Mountpoint column
		o = section.option(form.DummyValue, 'Mountpoint', _('Mountpoint'));
		o.cfgvalue = (sectionId) => {
			const volume = getVolumeData(sectionId);
			return utils.truncate(volume.Mountpoint || _('N/A'), 50);
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
	 * Get selected volume names from checkboxes
	 * @returns {Array<string>} Array of selected volume names
	 */
	getSelectedVolumes: function() {
		return this.listHelper.getSelected((volume) => volume.Name);
	},

	/**
	 * Delete selected volumes
	 */
	handleDeleteSelected: function() {
		utils.handleBulkDelete({
			selected: this.getSelectedVolumes(),
			itemName: 'volume',
			deletePromiseFn: (name) => podmanRPC.volume.remove(name, false)
		});
	},

	/**
	 * Refresh volume list
	 */
	handleRefresh: function() {
		window.location.reload();
	},

	/**
	 * Show create volume dialog
	 */
	handleCreateVolume: function() {
		VolumeForm.render(() => this.handleRefresh());
	},

	/**
	 * Show volume details
	 * @param {string} name - Volume name
	 */
	handleInspect: function(name) {
		this.listHelper.showInspect(name);
	}
});
