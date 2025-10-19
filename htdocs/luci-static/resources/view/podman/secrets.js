'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.form as pform';

/**
 * @module view.podman.secrets
 * @description Secret management view using proper LuCI form components
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load secret data on view initialization
	 * @returns {Promise<Object>} Secret data wrapped in object
	 */
	load: async () => {
		return podmanRPC.secret.list()
			.then((secrets) => {
				return { secrets: secrets || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load secrets') };
			});
	},

	/**
	 * Render the secrets view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Secrets view element
	 */
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		// Initialize list helper with full data object
		this.listHelper = new pui.ListViewHelper({
			prefix: 'secrets',
			itemName: 'secret',
			rpc: podmanRPC.secret,
			data: data,
			view: this
		});

		const getSecretData = (sectionId) => {
			return this.listHelper.data.secrets[sectionId.replace('secrets', '')];
		};

		this.map = new form.JSONMap(this.listHelper.data, _('Secrets'));

		const section = this.map.section(form.TableSection, 'secrets', '', _('Manage Podman secrets'));
		let o;

		section.anonymous = true;
		section.nodescriptions = true;

		// Checkbox column for selection
		o = section.option(form.DummyValue, 'ID', new ui.Checkbox(0, { hiddenname: 'all' }).render());
		o.cfgvalue = (sectionId) => {
			return new ui.Checkbox(0, { hiddenname: sectionId }).render();
		};

		// Name column
		o = section.option(form.DummyValue, 'Name', _('Name'));
		o.cfgvalue = (sectionId) => {
			const secret = getSecretData(sectionId);
			const name = secret.Spec && secret.Spec.Name ? secret.Spec.Name : (secret.Name || _('Unknown'));
			return E('a', {
				href: '#',
				click: (ev) => {
					ev.preventDefault();
					this.handleInspect(name);
				}
			}, E('strong', {}, name));
		};
		o.rawhtml = true;

		// Driver column
		o = section.option(form.DummyValue, 'Driver', _('Driver'));
		o.cfgvalue = (sectionId) => {
			const secret = getSecretData(sectionId);
			return secret.Spec && secret.Spec.Driver && secret.Spec.Driver.Name ?
				secret.Spec.Driver.Name : _('file');
		};

		// Created column
		o = section.option(form.DummyValue, 'CreatedAt', _('Created'));
		o.cfgvalue = (sectionId) => {
			const secret = getSecretData(sectionId);
			return secret.CreatedAt ? utils.formatDate(Date.parse(secret.CreatedAt) / 1000) : _('Unknown');
		};

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateSecret()
		});

		return this.map.render().then((mapRendered) => {
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
	refreshTable: function(clearSelections) {
		return this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Get selected secret names from checkboxes
	 * @returns {Array<string>} Array of secret names
	 */
	getSelectedSecrets: function() {
		return this.listHelper.getSelected((secret) => {
			return secret.Spec && secret.Spec.Name ? secret.Spec.Name : secret.Name;
		});
	},

	/**
	 * Delete selected secrets
	 */
	handleDeleteSelected: function() {
		utils.handleBulkDelete({
			selected: this.getSelectedSecrets(),
			itemName: 'secret',
			deletePromiseFn: (name) => podmanRPC.secret.remove(name),
			onSuccess: () => this.refreshTable(true)
		});
	},

	/**
	 * Refresh secret list
	 */
	handleRefresh: function() {
		this.refreshTable(false);
	},

	/**
	 * Show create secret dialog
	 */
	handleCreateSecret: function() {
		console.log('pform', pform);
		new pform.Secret().render(() => this.handleRefresh());
	},

	/**
	 * Show secret details
	 * @param {string} name - Secret name
	 */
	handleInspect: function(name) {
		this.listHelper.showInspect(name, ['SecretData']);
	}
});
