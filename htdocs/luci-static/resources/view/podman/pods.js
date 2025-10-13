'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.pod-form as PodForm';

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
			return this.generic_failure(data.error);
		}

		// Initialize list helper
		this.listHelper = new pui.ListViewHelper({
			prefix: 'pods',
			itemName: 'pod',
			rpc: podmanRPC.pod,
			data: data.pods,
			view: this
		});

		const getPodData = (sectionId) => data.pods[sectionId.replace('pods', '')];

		this.map = new form.JSONMap(data, _('Pods'));
		const section = this.map.section(form.TableSection, 'pods', '', _('Manage Podman pods'));
		let o;

		section.anonymous = true;
		section.nodescription = true;

		// Checkbox column for selection
		o = section.option(form.DummyValue, 'Id', new ui.Checkbox(0, { hiddenname: 'all' }).render());
		o.cfgvalue = (sectionId) => {
			return new ui.Checkbox(0, { hiddenname: sectionId }).render();
		};

		// Name column
		o = section.option(form.DummyValue, 'Name', _('Name'));
		o.cfgvalue = (sectionId) => {
			const pod = getPodData(sectionId);
			return E('a', {
				href: '#',
				click: (ev) => {
					ev.preventDefault();
					this.handleInspect(pod.Name);
				}
			}, E('strong', {}, pod.Name || _('Unknown')));
		};
		o.rawhtml = true;

		// Status column
		o = section.option(form.DummyValue, 'Status', _('Status'));
		o.cfgvalue = (sectionId) => {
			const pod = getPodData(sectionId);
			const status = pod.Status || _('Unknown');
			return E('span', { 'class': 'badge status-' + status.toLowerCase() }, status);
		};
		o.rawhtml = true;

		// Containers column
		o = section.option(form.DummyValue, 'Containers', _('Containers'));
		o.cfgvalue = (sectionId) => {
			const pod = getPodData(sectionId);
			const containerCount = pod.Containers ? pod.Containers.length : 0;
			return containerCount.toString();
		};

		// Infra ID column
		o = section.option(form.DummyValue, 'InfraId', _('Infra ID'));
		o.cfgvalue = (sectionId) => {
			const pod = getPodData(sectionId);
			return pod.InfraId ? utils.truncate(pod.InfraId, 12) : _('N/A');
		};

		// Created column
		o = section.option(form.DummyValue, 'Created', _('Created'));
		o.cfgvalue = (sectionId) => {
			const pod = getPodData(sectionId);
			return pod.Created ? utils.formatDate(Date.parse(pod.Created) / 1000) : _('Unknown');
		};

		// Actions column
		o = section.option(form.DummyValue, 'Actions', _('Actions'));
		o.cfgvalue = (sectionId) => {
			const pod = getPodData(sectionId);
			const id = pod.Id;
			const name = pod.Name;
			const isRunning = pod.Status === 'Running';
			const isPaused = pod.Status === 'Paused';

			const startStopLabel = isRunning ? _('Stop') : _('Start');
			const startStopClass = isRunning ? 'negative' : 'positive';
			const startStopHandler = isRunning ?
				() => this.handleStop(id) :
				() => this.handleStart(id);

			const pauseLabel = isPaused ? _('Unpause') : _('Pause');
			const pauseHandler = isPaused ?
				() => this.handleUnpause(id) :
				() => this.handlePause(id);

			return E('div', {}, [
				new pui.Button(startStopLabel, startStopHandler, startStopClass).render(),
				' ',
				new pui.Button(_('Restart'), () => this.handleRestart(id)).render(),
				' ',
				new pui.Button(pauseLabel, pauseHandler).render(),
				' ',
				new pui.Button(_('Remove'), () => this.handleRemove(id, name), 'remove').render()
			]);
		};
		o.rawhtml = true;

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreatePod()
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
		utils.handleBulkDelete({
			selected: this.getSelectedPods(),
			itemName: 'pod',
			deletePromiseFn: (pod) => podmanRPC.pod.remove(pod.name, true),
			formatItemName: (pod) => pod.name
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
	handleRefresh: function() {
		window.location.reload();
	},

	/**
	 * Show create pod dialog
	 */
	handleCreatePod: function() {
		PodForm.render(() => this.handleRefresh());
	},

	/**
	 * Start a pod
	 * @param {string} id - Pod ID
	 */
	handleStart: function(id) {
		ui.showModal(_('Starting Pod'), [
			E('p', { 'class': 'spinning' }, _('Starting pod...'))
		]);

		podmanRPC.pod.start(id).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to start pod: %s').format(result.error)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Pod started successfully')), 3000, 'info');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to start pod: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Stop a pod
	 * @param {string} id - Pod ID
	 */
	handleStop: function(id) {
		ui.showModal(_('Stopping Pod'), [
			E('p', { 'class': 'spinning' }, _('Stopping pod...'))
		]);

		podmanRPC.pod.stop(id).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to stop pod: %s').format(result.error)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Pod stopped successfully')), 3000, 'info');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to stop pod: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Restart a pod
	 * @param {string} id - Pod ID
	 */
	handleRestart: function(id) {
		ui.showModal(_('Restarting Pod'), [
			E('p', { 'class': 'spinning' }, _('Restarting pod...'))
		]);

		podmanRPC.pod.restart(id).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to restart pod: %s').format(result.error)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Pod restarted successfully')), 3000, 'info');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to restart pod: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Pause a pod
	 * @param {string} id - Pod ID
	 */
	handlePause: function(id) {
		ui.showModal(_('Pausing Pod'), [
			E('p', { 'class': 'spinning' }, _('Pausing pod...'))
		]);

		podmanRPC.pod.pause(id).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to pause pod: %s').format(result.error)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Pod paused successfully')), 3000, 'info');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to pause pod: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Unpause a pod
	 * @param {string} id - Pod ID
	 */
	handleUnpause: function(id) {
		ui.showModal(_('Unpausing Pod'), [
			E('p', { 'class': 'spinning' }, _('Unpausing pod...'))
		]);

		podmanRPC.pod.unpause(id).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to unpause pod: %s').format(result.error)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Pod unpaused successfully')), 3000, 'info');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to unpause pod: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Remove a pod
	 * @param {string} id - Pod ID
	 * @param {string} name - Pod name
	 */
	handleRemove: function(id, name) {
		if (!confirm(_('Are you sure you want to remove pod %s?').format(name)))
			return;

		ui.showModal(_('Removing Pod'), [
			E('p', { 'class': 'spinning' }, _('Removing pod...'))
		]);

		podmanRPC.pod.remove(name, false).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to remove pod: %s').format(result.error)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Pod removed successfully')), 3000, 'info');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to remove pod: %s').format(err.message)), 'error');
		});
	}
});
