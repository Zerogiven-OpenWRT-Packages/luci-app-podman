'use strict';

'require view';
'require poll';
'require ui';
'require form';
'require session';
'require podman.container-util as ContainerUtil';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.format as format';
'require podman.openwrt-network as openwrtNetwork';

'require view.podman.container-tab.info as containerInfo';
'require view.podman.container-tab.stats as containerStats';
'require view.podman.container-tab.logs as containerLogs';
'require view.podman.container-tab.health as containerHealth';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/podman/podman.css')
}));

/**
 * Container detail view with tabbed interface
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	/**
	 * Load container data on view initialization
	 * @returns {Promise<Object>} Container inspect data and networks
	 */
	load: async function () {
		// Extract container ID from URL path
		// URL format: /cgi-bin/luci/admin/podman/container/<id>
		const path = window.location.pathname;
		const matches = path.match(/container\/([a-f0-9]+)/i);

		if (!matches || !matches[1]) {
			return Promise.resolve({
				error: _('No container ID in URL')
			});
		}

		const containerId = matches[1];

		return Promise.all([
			podmanRPC.container.inspect(containerId),
			podmanRPC.network.list(),
		]).then((results) => {
			return {
				containerId,
				container: results[0],
				networks: results[1] || []
			};
		}).catch((err) => {
			return {
				error: err.message || _('Failed')
			};
		});
	},

	/**
	 * Render the container detail view
	 * @param {Object} data - Container and network data from load()
	 * @returns {Element} Container detail view element
	 */
	render: function (data) {
		// Handle errors from load() - redirect to containers list
		// Check for error, missing container, or invalid container data (no Id means container doesn't exist)
		if (data && data.error || !data.container || !data.container.Id) {
			podmanUI.warningTimeNotification(data.error || _('Not found'));

			window.location.href = L.url('admin/podman/containers');

			return E('div', {}, _('Redirecting to containers list...'));
		}

		// Store data for use in methods
		this.containerId = data.containerId;
		this.containerData = data.container;

		// Create header with container name and status
		const name = this.containerData.Name ?
			this.containerData.Name.replace(/^\//, '')
			:
			this.containerId.substring(0, 12);
		const state = this.containerData.State || {};
		const status = state.Status || _('Unknown').toLowerCase();

		const header = E('div', {
			'style': 'margin-bottom: 20px;'
		}, [
			E('h2', {}, [
				name,
				' ',
				E('span', {
					'class': 'container-status container-status-' + status.toLowerCase(),
				}, status)
			]),
			E('div', {
				'style': 'margin-top: 10px;'
			}, [
				this.createActionButtons(this.containerId, name, status === 'running')
			])
		]);

		// Build tabs using podmanUI.Tabs helper
		const tabs = new podmanUI.Tabs('info');
		tabs
			.addTab('info', _('Info'), 'tab-info-content')
			.addTab('resources', _('Resources'), 'tab-resources-content')
			.addTab('stats', _('Stats'), E('div', {
				'id': 'tab-stats-content'
			}, [
				E('p', {}, _('Loading...'))
			]))
			.addTab('logs', _('Logs'), E('div', {
				'id': 'tab-logs-content'
			}, [
				E('p', {}, _('Loading...'))
			]))
			.addTab('health', _('Health'), E('div', {
				'id': 'tab-health-content'
			}, [
				E('p', {}, _('Loading...'))
			]))
			.addTab('inspect', _('Inspect'), 'tab-inspect-content')
			.addTab('console', _('Console'), E('div', {
				'id': 'tab-console-content'
			}, [
				E('p', {}, _('Terminal access coming soon...'))
			]));

		// Render tab container (includes automatic tab initialization)
		const tabContainer = tabs.render();

		// Load tab contents after DOM is ready
		requestAnimationFrame(() => {
			this.renderInfoTab();
			this.renderResourcesTab();
			this.renderStatsTab();
			this.renderLogsTab();
			this.renderHealthTab();
			this.renderInspectTab();
		});

		return E('div', {}, [header, tabContainer]);
	},

	/**
	 * Create action buttons for container
	 * @param {string} id - Container ID
	 * @param {string} name - Container name
	 * @param {boolean} isRunning - Whether container is running
	 * @returns {Element} Button group
	 */
	createActionButtons: function (id, name, isRunning) {
		const buttons = [];

		if (isRunning) {
			buttons.push(new podmanUI.Button(_('Stop'), () => this.handleStop(id), 'negative')
				.render());
		} else {
			buttons.push(new podmanUI.Button(_('Start'), () => this.handleStart(id), 'positive')
				.render());
		}

		buttons.push(' ');
		buttons.push(new podmanUI.Button(_('Restart'), () => this.handleRestart(id)).render());

		buttons.push(' ');
		buttons.push(new podmanUI.Button(_('Remove'), () => this.handleRemove(id, name), 'remove')
			.render());

		buttons.push(' ');

		// Determine back button destination from query parameter
		const urlParams = new URLSearchParams(window.location.search);
		const from = urlParams.get('from');
		let backUrl = L.url('admin/podman/containers');
		let backText = _('Back to Containers');

		if (from === 'pods') {
			backUrl = L.url('admin/podman/pods');
			backText = _('Back to Pods');
		}

		buttons.push(new podmanUI.Button(backText, backUrl).render());

		return E('div', {}, buttons);
	},

	/**
	 * Render Info tab with container details and configuration
	 */
	renderInfoTab: async function () {
		const container = document.getElementById('tab-info-content');
		if (!container) return;

		containerInfo.render(container, this.containerData);
	},

	/**
	 * Render Resources tab with CPU, memory, and I/O limit configuration
	 */
	renderResourcesTab: function () {
		const container = document.getElementById('tab-resources-content');
		if (!container) return;

		const editor = new podmanForm.Resource.init();
		editor.render(this.containerId, this.containerData).then((renderedForm) => {
			const wrapper = E('div', {
				'class': 'cbi-section'
			}, [
				E('div', {
					'class': 'cbi-section-descr'
				}, _(
					'Configure resource limits for this container. Changes will be applied immediately.'
				)),
				renderedForm
			]);
			container.appendChild(wrapper);
		});
	},

	/**
	 * Render Stats tab with resource usage metrics
	 */
	renderStatsTab: function () {
		const content = document.getElementById('tab-stats-content');
		if (!content) return;

		containerStats.render(content, this.containerId, this.containerData);
	},

	/**
	 * Render Logs tab with streaming and non-streaming log viewer
	 */
	renderLogsTab: function () {
		const content = document.getElementById('tab-logs-content');
		if (!content) return;

		containerLogs.render(content, this.containerId);
	},

	/**
	 * Render Health tab with health check status, history, and configuration (read-only)
	 */
	renderHealthTab: function () {
		const content = document.getElementById('tab-health-content');
		if (!content) return;

		containerHealth.render(content, this.containerData);
	},

	/**
	 * Render Inspect tab with full JSON container data
	 */
	renderInspectTab: function () {
		const container = document.getElementById('tab-inspect-content');
		if (!container) return;

		const data = this.containerData;

		const jsonSection = new podmanUI.Section();
		jsonSection.addNode(
			'',
			'',
			E('pre', { 'class': 'code-area' }, JSON.stringify(data, null, 2))
		);

		container.appendChild(jsonSection.render());
	},

	/**
	 * Handle container start action
	 * @param {string} id - Container ID
	 */
	handleStart: function (id) {
		ContainerUtil.startContainers(id).then(() => {
			window.location.reload();
		});
	},

	/**
	 * Handle container stop action
	 * @param {string} id - Container ID
	 */
	handleStop: function (id) {
		ContainerUtil.stopContainers(id).then(() => {
			window.location.reload();
		});
	},

	/**
	 * Handle container restart action
	 * @param {string} id - Container ID
	 */
	handleRestart: function (id) {
		ContainerUtil.restartContainers(id).then(() => {
			window.location.reload();
		});
	},

	/**
	 * Handle container remove action
	 * @param {string} id - Container ID
	 * @param {string} name - Container name
	 */
	handleRemove: function (id, name) {
		if (!confirm(_('Are you sure you want to delete %s?').format(name)))
			return;

		ContainerUtil.removeContainers(id).then(() => {
			window.location.href = L.url('admin/podman/containers');
		});
	},
});
