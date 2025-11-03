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
 * @module view.podman.pods
 * @description Pod management view using proper LuCI form components
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load pod data on view initialization
	 * @returns {Promise<Object>} Pod data wrapped in object
	 */
	load: async () => {
		return podmanRPC.pod.list()
			.then((pods) => {
				return { pods: pods || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load pods') };
			});
	},

	/**
	 * Render the pods view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Pods view element
	 */
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		// Initialize list helper with full data object
		this.listHelper = new List.Util({
			itemName: 'pod',
			rpc: podmanRPC.pod,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Pods'));

		const section = this.map.section(form.TableSection, 'pods', '', _('Manage Podman pods'));
		section.anonymous = true;

		let o;

		// Checkbox column for selection
		o = section.option(podmanForm.field.SelectDummyValue, 'Id', new ui.Checkbox(
		0, { hiddenname: 'all' }).render());

		// Name column
		o = section.option(podmanForm.field.LinkDataDummyValue, 'Name', _('Name'));
		o.click = (pod) => this.handleInspect(pod.Name);
		o.text = (pod) => pod.Name || _('Unknown');

		// Status column
		o = section.option(form.DummyValue, 'Status', _('Status'));
		o.cfgvalue = (sectionId) => {
			const pod = this.map.data.data[sectionId];
			const status = pod.Status || _('Unknown');
			return E('span', { 'class': 'badge status-' + status.toLowerCase() }, status);
		};

	// Containers column - show IDs with links
	o = section.option(form.DummyValue, 'Containers', _('Containers'));
	o.cfgvalue = (sectionId) => {
		const pod = this.map.data.data[sectionId];
		const containers = pod.Containers || [];

		if (containers.length === 0) {
			return '0';
		}

		// Create links for each container ID
		const containerLinks = containers.map((container) => {
			const containerId = container.Id;
			const shortId = utils.truncate(containerId, 12);
			return E('a', {
				'href': L.url('admin/podman/container', containerId) + '?from=pods',
				'style': 'margin-right: 8px;'
			}, shortId);
		});

		// Return count + links
		return E('div', {}, [
			E('span', { 'style': 'font-weight: bold; margin-right: 8px;' }, containers.length + ':'),
			...containerLinks
		]);
	};
	o.rawhtml = true;
		// Infra ID column
		o = section.option(form.DummyValue, 'InfraId', _('Infra ID'));
		o.cfgvalue = (sectionId) => {
			const pod = this.map.data.data[sectionId];
			return pod.InfraId ? utils.truncate(pod.InfraId, 12) : _('N/A');
		};

		// Created column
		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = (cfg) => utils.formatDate(Date.parse(cfg) / 1000);

		// // Actions column
		// o = section.option(form.DummyValue, 'Actions', _('Actions'));
		// o.cfgvalue = (sectionId) => {
		// 	const pod = this.map.data.data[sectionId];
		// 	const id = pod.Id;
		// 	const name = pod.Name;
		// 	const isRunning = pod.Status === 'Running';
		// 	const isPaused = pod.Status === 'Paused';

		// 	const startStopLabel = isRunning ? _('Stop') : _('Start');
		// 	const startStopClass = isRunning ? 'negative' : 'positive';
		// 	const startStopHandler = isRunning ?
		// 		() => this.handleStop(id) :
		// 		() => this.handleStart(id);

		// 	const pauseLabel = isPaused ? _('Unpause') : _('Pause');
		// 	const pauseHandler = isPaused ?
		// 		() => this.handleUnpause(id) :
		// 		() => this.handlePause(id);

		// 	return E('div', {}, [
		// 		new pui.Button(startStopLabel, startStopHandler, startStopClass).render(),
		// 		' ',
		// 		new pui.Button(_('Restart'), () => this.handleRestart(id)).render(),
		// 		' ',
		// 		new pui.Button(pauseLabel, pauseHandler).render(),
		// 		' ',
		// 		new pui.Button(_('Remove'), () => this.handleRemove(id, name), 'remove').render()
		// 	]);
		// };
		// o.rawhtml = true;

		// Create toolbar using helper with custom buttons
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreatePod(),
			customButtons: [{
					text: '&#9658;', // Play symbol
					handler: () => this.handleStart(),
					cssClass: 'positive',
					tooltip: _('Start selected pods')
				},
				{
					text: '&#9724;', // Stop symbol
					handler: () => this.handleStop(),
					cssClass: 'negative',
					tooltip: _('Stop selected pods')
				}
			]
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
	 * Get selected pod objects from checkboxes
	 * @returns {Array<Object>} Array of {id, name} objects for selected pods
	 */
	getSelectedPods: function() {
		return this.listHelper.getSelected((pod) => ({
			id: pod.Id,
			name: pod.Name
		}));
	},

	/**
	 * Delete selected pods
	 */
	handleDeleteSelected: function() {
		this.listHelper.bulkDelete({
			selected: this.getSelectedPods(),
			deletePromiseFn: (pod) => podmanRPC.pod.remove(pod.name, true),
			formatItemName: (pod) => pod.name,
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Inspect a pod and show details in modal
	 * @param {string} name - Pod name
	 */
	handleInspect: function(name) {
		this.listHelper.showInspect(name);
	},

	/**
	 * Refresh pod list
	 */
	handleRefresh: function(clearSelections) {
		this.listHelper.refreshTable(clearSelections)
	},

	/**
	 * Show create pod dialog
	 */
	handleCreatePod: function() {
		const form = new podmanForm.Pod();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Handle pod start action for selected pods
	 */
	handleStart: function() {
		const selected = this.getSelectedPods();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No pods selected')), 3000, 'warning');
			return;
		}

		podmanUI.showSpinningModal(_('Starting Pods'), _('Starting selected pods...'));

		const startPromises = selected.map((pod) => {
			return podmanRPC.pod.start(pod.id).catch((err) => {
				return { error: err.message, name: pod.name };
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
				podmanUI.successTimeNotification(_('Pods started successfully'));
			}
			this.handleRefresh(false);
		});
	},

	/**
	 * Handle pod stop action for selected pods
	 */
	handleStop: function() {
		const selected = this.getSelectedPods();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No pods selected')), 3000, 'warning');
			return;
		}

		podmanUI.showSpinningModal(_('Stopping Pods'), _('Stopping selected pods...'));

		const stopPromises = selected.map((pod) => {
			return podmanRPC.pod.stop(pod.id).catch((err) => {
				return { error: err.message, name: pod.name };
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
				podmanUI.successTimeNotification(_('Pods stopped successfully'));
			}
			this.handleRefresh(false);
		});
	},

	// /**
	//  * Restart a pod
	//  * @param {string} id - Pod ID
	//  */
	// handleRestart: function(id) {
	// 	podmanUI.showSpinningModal(_('Restarting Pod'), _('Restarting pod...'));

	// 	podmanRPC.pod.restart(id).then((result) => {
	// 		ui.hideModal();
	// 		if (result && result.error) {
	// 			podmanUI.errorNotification(_('Failed to restart pod: %s').format(result.error));
	// 		} else {
	// 			podmanUI.successTimeNotification(_('Pod restarted successfully'));
	// 			this.handleRefresh(false);
	// 		}
	// 	}).catch((err) => {
	// 		ui.hideModal();
	// 		podmanUI.errorNotification(_('Failed to restart pod: %s').format(err.message));
	// 	});
	// },

	// /**
	//  * Pause a pod
	//  * @param {string} id - Pod ID
	//  */
	// handlePause: function(id) {
	// 	podmanUI.showSpinningModal(_('Pausing Pod'), _('Pausing pod...'));

	// 	podmanRPC.pod.pause(id).then((result) => {
	// 		ui.hideModal();
	// 		if (result && result.error) {
	// 			podmanUI.errorNotification(_('Failed to pause pod: %s').format(result.error));
	// 		} else {
	// 			podmanUI.successTimeNotification(_('Pod paused successfully'));
	// 			this.handleRefresh(false);
	// 		}
	// 	}).catch((err) => {
	// 		ui.hideModal();
	// 		podmanUI.errorNotification(_('Failed to pause pod: %s').format(err.message));
	// 	});
	// },

	// /**
	//  * Unpause a pod
	//  * @param {string} id - Pod ID
	//  */
	// handleUnpause: function(id) {
	// 	pui.showSpinningModal(_('Unpausing Pod'), _('Unpausing pod...'));

	// 	podmanRPC.pod.unpause(id).then((result) => {
	// 		ui.hideModal();
	// 		if (result && result.error) {
	// 			pui.errorNotification(_('Failed to unpause pod: %s').format(result.error));
	// 		} else {
	// 			pui.successTimeNotification(_('Pod unpaused successfully'));
	// 			this.refreshTable(false);
	// 		}
	// 	}).catch((err) => {
	// 		ui.hideModal();
	// 		pui.errorNotification(_('Failed to unpause pod: %s').format(err.message));
	// 	});
	// },

	// /**
	//  * Remove a pod
	//  * @param {string} id - Pod ID
	//  * @param {string} name - Pod name
	//  */
	// handleRemove: function(id, name) {
	// 	if (!confirm(_('Are you sure you want to remove pod %s?').format(name)))
	// 		return;

	// 	pui.showSpinningModal(_('Removing Pod'), _('Removing pod...'));

	// 	podmanRPC.pod.remove(name, false).then((result) => {
	// 		ui.hideModal();
	// 		if (result && result.error) {
	// 			pui.errorNotification(_('Failed to remove pod: %s').format(result.error));
	// 		} else {
	// 			pui.successTimeNotification(_('Pod removed successfully'));
	// 			this.refreshTable(true);
	// 		}
	// 	}).catch((err) => {
	// 		ui.hideModal();
	// 		pui.errorNotification(_('Failed to remove pod: %s').format(err.message));
	// 	});
	// }
});
