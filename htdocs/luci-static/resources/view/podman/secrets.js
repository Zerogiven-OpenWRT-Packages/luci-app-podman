'use strict';

'require view';
'require form';
'require ui';
'require podman.utils as utils';
'require podman.list as List';
'require podman.rpc as podmanRPC';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';

/**
 * Secret management view with create, inspect, and delete operations
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load secret data
	 * @returns {Promise<Object>} Secret data or error
	 */
	load: async () => {
		return podmanRPC.secret.list()
			.then((secrets) => {
				return {
					secrets: secrets || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed to load secrets')
				};
			});
	},

	/**
	 * Render secrets view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function(data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		this.listHelper = new List.Util({
			itemName: 'secret',
			rpc: podmanRPC.secret,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Secrets'));

		const section = this.map.section(form.TableSection, 'secrets', '', _(
			'Manage Podman secrets'));
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'ID', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		o = section.option(podmanForm.field.LinkDataDummyValue, 'Name', _('Name'));
		o.click = (secret) => {
			const name = secret.Spec && secret.Spec.Name ? secret.Spec.Name : (secret.Name ||
				_('Unknown'));
			this.handleInspect(name);
		};
		o.text = (secret) => secret.Spec && secret.Spec.Name ? secret.Spec.Name : (secret.Name ||
			_('Unknown'));

		o = section.option(form.DummyValue, 'Driver', _('Driver'));
		o.cfgvalue = (sectionId) => {
			const secret = this.map.data.data[sectionId];
			return secret.Spec && secret.Spec.Driver && secret.Spec.Driver.Name ?
				secret.Spec.Driver.Name : _('file');
		};

		o = section.option(podmanForm.field.DataDummyValue, 'CreatedAt', _('Created'));
		o.cfgformatter = (cfg) => utils.formatDate(Date.parse(cfg) / 1000);

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateSecret()
		});

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
	 * Delete selected secrets
	 */
	handleDeleteSelected: function () {
		this.listHelper.bulkDelete({
			selected: this.listHelper.getSelected((secret) => {
				return secret.Spec && secret.Spec.Name ? secret.Spec.Name : secret.Name;
			}),
			deletePromiseFn: (name) => podmanRPC.secret.remove(name),
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Refresh secret list
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	handleRefresh: function (clearSelections) {
		this.listHelper.refreshTable(clearSelections || false)
	},

	/**
	 * Show create secret form
	 */
	handleCreateSecret: function () {
		const form = new podmanForm.Secret();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Show secret inspect modal (hides SecretData field)
	 * @param {string} name - Secret name
	 */
	handleInspect: function (name) {
		this.listHelper.showInspect(name, ['SecretData']);
	}
});
