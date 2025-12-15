'use strict';

'require view';
'require form';
'require ui';
'require podman.utils as utils';
'require podman.format as format';
'require podman.list as List';
'require podman.rpc as podmanRPC';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';

/**
 * Pod management view with create, start, stop, inspect, and delete operations
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load pod data
	 * @returns {Promise<Object>} Pod data or error
	 */
	load: async () => {
		return podmanRPC.pod.list()
			.then((pods) => {
				return {
					pods: pods || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed to load %s').format(_('Pods').toLowerCase())
				};
			});
	},

	/**
	 * Render pods view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function(data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		this.listHelper = new List.Util({
			itemName: 'pod',
			rpc: podmanRPC.pod,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Pods'));

		const section = this.map.section(form.TableSection, 'pods', '', _('Manage Podman %s').format(_('Pods').toLowerCase()));
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'Id', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		o = section.option(podmanForm.field.LinkDataDummyValue, 'Name', _('Name'));
		o.click = (pod) => this.handleInspect(pod.Name);
		o.text = (pod) => pod.Name || _('Unknown');

		o = section.option(form.DummyValue, 'Status', _('Status'));
		o.cfgvalue = (sectionId) => {
			const pod = this.map.data.data[sectionId];
			const status = pod.Status || _('Unknown');
			return E('span', {
				'class': 'badge status-' + status.toLowerCase()
			}, status);
		};

	o = section.option(form.DummyValue, 'Containers', _('Containers'));
	o.cfgvalue = (sectionId) => {
		const pod = this.map.data.data[sectionId];
		const containers = pod.Containers || [];

		if (containers.length === 0) {
			return '0';
		}

		const containerLinks = containers.map((container) => {
			const containerId = container.Id;
			const shortId = utils.truncate(containerId, 12);
			return E('a', {
				'href': L.url('admin/podman/container', containerId) + '?from=pods',
				'style': 'margin-right: 8px;'
			}, shortId);
		});

		return E('div', {}, [
			E('span', { 'style': 'font-weight: bold; margin-right: 8px;' }, containers.length + ':'),
			...containerLinks
		]);
	};
	o.rawhtml = true;
		o = section.option(form.DummyValue, 'InfraId', _('Infra ID'));
		o.cfgvalue = (sectionId) => {
			const pod = this.map.data.data[sectionId];
			return pod.InfraId ? utils.truncate(pod.InfraId, 12) : _('N/A');
		};

		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = (cfg) => format.date(Date.parse(cfg) / 1000);


		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreatePod(),
			customButtons: [{
					text: '&#9658;', // Play symbol
					handler: () => this.handleStart(),
					cssClass: 'positive',
					tooltip: _('Start selected %s').format(_('Pods').toLowerCase())
				},
				{
					text: '&#9724;', // Stop symbol
					handler: () => this.handleStop(),
					cssClass: 'negative',
					tooltip: _('Stop selected %s').format(_('Pods').toLowerCase())
				}
			]
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
	 * Get selected pods
	 * @returns {Array<Object>} Array of {id, name} objects
	 */
	getSelectedPods: function () {
		return this.listHelper.getSelected((pod) => ({
			id: pod.Id,
			name: pod.Name
		}));
	},

	/**
	 * Delete selected pods
	 */
	handleDeleteSelected: function () {
		this.listHelper.bulkDelete({
			selected: this.getSelectedPods(),
			deletePromiseFn: (pod) => podmanRPC.pod.remove(pod.name, true),
			formatItemName: (pod) => pod.name,
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Show pod inspect modal
	 * @param {string} name - Pod name
	 */
	handleInspect: function (name) {
		this.listHelper.showInspect(name);
	},

	/**
	 * Refresh pod list
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	handleRefresh: function (clearSelections) {
		this.listHelper.refreshTable(clearSelections)
	},

	/**
	 * Show create pod form
	 */
	handleCreatePod: function () {
		const form = new podmanForm.Pod();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Start selected pods
	 */
	handleStart: function () {
		const selected = this.getSelectedPods();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No %s selected').format(_('Pods').toLowerCase())), 3000, 'warning');
			return;
		}

		podmanUI.showSpinningModal(_('Starting %s').format(_('Pods')), _('Starting selected %s...').format(_('Pods').toLowerCase()));

		const startPromises = selected.map((pod) => {
			return podmanRPC.pod.start(pod.id).catch((err) => {
				return {
					error: err.message,
					name: pod.name
				};
			});
		});

		Promise.all(startPromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				const errorMsg = errors.map((e) => `${e.name}: ${e.error}`).join(', ');
				podmanUI.errorNotification(_('Failed to start some pods: %s').format(
					errorMsg));
			} else {
				podmanUI.successTimeNotification(_('%s started successfully').format(_('Pods')));
			}
			this.handleRefresh(false);
		});
	},

	/**
	 * Stop selected pods
	 */
	handleStop: function () {
		const selected = this.getSelectedPods();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No %s selected').format(_('Pods').toLowerCase())), 3000, 'warning');
			return;
		}

		podmanUI.showSpinningModal(_('Stopping %s').format(_('Pods')), _('Stopping selected %s...').format(_('Pods').toLowerCase()));

		const stopPromises = selected.map((pod) => {
			return podmanRPC.pod.stop(pod.id).catch((err) => {
				return {
					error: err.message,
					name: pod.name
				};
			});
		});

		Promise.all(stopPromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				const errorMsg = errors.map((e) => `${e.name}: ${e.error}`).join(', ');
				podmanUI.errorNotification(_('Failed to stop some pods: %s').format(
					errorMsg));
			} else {
				podmanUI.successTimeNotification(_('%s stopped successfully').format(_('Pods')));
			}
			this.handleRefresh(false);
		});
	},




});
