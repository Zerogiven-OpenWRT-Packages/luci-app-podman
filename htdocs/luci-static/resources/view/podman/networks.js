'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.network-form as NetworkForm';

/**
 * @module view.podman.networks
 * @description Network management view using proper LuCI form components
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
	 * Load network data on view initialization
	 * @returns {Promise<Object>} Network data wrapped in object
	 */
	load: async () => {
		return podmanRPC.network.list()
			.then((networks) => {
				return { networks: networks || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load networks') };
			});
	},

	/**
	 * Render the networks view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Networks view element
	 */
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return this.generic_failure(data.error);
		}

		// Initialize list helper
		this.listHelper = new pui.ListViewHelper({
			prefix: 'networks',
			itemName: 'network',
			rpc: podmanRPC.network,
			data: data.networks,
			view: this
		});

		const getNetworkData = (sectionId) => data.networks[sectionId.replace('networks', '')];

		this.map = new form.JSONMap(data, _('Networks'));
		const section = this.map.section(form.TableSection, 'networks', '', _('Manage Podman networks'));
		let o;

		section.anonymous = true;
		section.nodescription = true;

		// Checkbox column for selection
		o = section.option(form.DummyValue, 'name', new ui.Checkbox(0, { hiddenname: 'all' }).render());
		o.cfgvalue = (sectionId) => {
			return new ui.Checkbox(0, { hiddenname: sectionId }).render();
		};

		// Name column
		o = section.option(form.DummyValue, 'Name', _('Name'));
		o.cfgvalue = (sectionId) => {
			const network = getNetworkData(sectionId);
			return E('a', {
				href: '#',
				click: (ev) => {
					ev.preventDefault();
					this.handleInspect(network.name || network.Name);
				}
			}, E('strong', {}, network.name || network.Name || _('Unknown')));
		};
		o.rawhtml = true;

		// Driver column
		o = section.option(form.DummyValue, 'Driver', _('Driver'));
		o.cfgvalue = (sectionId) => {
			const network = getNetworkData(sectionId);
			return network.driver || network.Driver || _('Unknown');
		};

		// Subnet column
		o = section.option(form.DummyValue, 'Subnet', _('Subnet'));
		o.cfgvalue = (sectionId) => {
			const network = getNetworkData(sectionId);
			// Handle Podman API format (lowercase)
			if (network.subnets && network.subnets.length > 0) {
				return network.subnets[0].subnet || _('N/A');
			}
			// Handle Docker-compat format (uppercase)
			else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
				return network.IPAM.Config[0].Subnet || _('N/A');
			}
			return _('N/A');
		};

		// Gateway column
		o = section.option(form.DummyValue, 'Gateway', _('Gateway'));
		o.cfgvalue = (sectionId) => {
			const network = getNetworkData(sectionId);
			// Handle Podman API format (lowercase)
			if (network.subnets && network.subnets.length > 0) {
				return network.subnets[0].gateway || _('N/A');
			}
			// Handle Docker-compat format (uppercase)
			else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
				return network.IPAM.Config[0].Gateway || _('N/A');
			}
			return _('N/A');
		};

		// Created column
		o = section.option(form.DummyValue, 'Created', _('Created'));
		o.cfgvalue = (sectionId) => {
			const network = getNetworkData(sectionId);
			const created = network.created || network.Created;
			return created ? utils.formatDate(new Date(created).getTime() / 1000) : _('Unknown');
		};

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateNetwork()
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
	 * Get selected network names from checkboxes
	 * @returns {Array<string>} Array of network names
	 */
	getSelectedNetworks: function() {
		return this.listHelper.getSelected((network) => network.name || network.Name);
	},

	/**
	 * Delete selected networks
	 */
	handleDeleteSelected: function() {
		utils.handleBulkDelete({
			selected: this.getSelectedNetworks(),
			itemName: 'network',
			deletePromiseFn: (name) => podmanRPC.network.remove(name, false)
		});
	},

	/**
	 * Refresh network list
	 */
	handleRefresh: function() {
		window.location.reload();
	},

	/**
	 * Show create network dialog
	 */
	handleCreateNetwork: function() {
		NetworkForm.render(() => this.handleRefresh());
	},

	/**
	 * Show network details
	 * @param {string} name - Network name
	 */
	handleInspect: function(name) {
		this.listHelper.showInspect(name);
	}
});
