'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.secret-form as SecretForm';

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
			return this.generic_failure(data.error);
		}

		// Initialize list helper
		this.listHelper = new pui.ListViewHelper({
			prefix: 'secrets',
			itemName: 'secret',
			rpc: podmanRPC.secret,
			data: data.secrets,
			view: this
		});

		const getSecretData = (sectionId) => data.secrets[sectionId.replace('secrets', '')];

		this.map = new form.JSONMap(data, _('Secrets'));
		const section = this.map.section(form.TableSection, 'secrets', '', _('Manage Podman secrets'));
		let o;

		section.anonymous = true;
		section.nodescription = true;

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
			deletePromiseFn: (name) => podmanRPC.secret.remove(name)
		});
	},

	/**
	 * Refresh secret list
	 */
	handleRefresh: function() {
		window.location.reload();
	},

	/**
	 * Show create secret dialog
	 */
	handleCreateSecret: function() {
		SecretForm.render(() => this.handleRefresh());
	},

	/**
	 * Show secret details
	 * @param {string} name - Secret name
	 */
	handleInspect: function(name) {
		this.listHelper.showInspect(name, ['SecretData']);
	}
});
