'use strict';
'require view';
'require ui';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';

/**
 * @module view.podman.container
 * @description Container detail view with tabbed interface
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	/**
	 * Generic failure handler for rendering errors
	 * @param {string} message - Error message to display
	 * @returns {Element} Error element
	 */
	generic_failure: function(message) {
		return E('div', {
			'class': 'alert-message error'
		}, [
			E('h3', {}, _('Error')),
			E('p', {}, message)
		]);
	},

	/**
	 * Load container data on view initialization
	 * @returns {Promise<Object>} Container inspect data and networks
	 */
	load: function() {
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
				containerId: containerId,
				container: results[0],
				networks: results[1] || []
			};
		}).catch((err) => {
			return {
				error: err.message || _('Failed to load container data')
			};
		});
	},

	/**
	 * Render the container detail view
	 * @param {Object} data - Container and network data from load()
	 * @returns {Element} Container detail view element
	 */
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return this.generic_failure(data.error);
		}

		// Handle missing data
		if (!data || !data.container) {
			return this.generic_failure(_('Container not found'));
		}

		// Store data for use in methods
		this.containerId = data.containerId;
		this.containerData = data.container;
		this.networksData = data.networks;

		// Create header with container name and status
		const name = this.containerData.Name ? this.containerData.Name.replace(/^\//, '') : this.containerId.substring(0, 12);
		const state = this.containerData.State || {};
		const status = state.Status || 'unknown';

		const header = E('div', { 'style': 'margin-bottom: 20px;' }, [
			E('h2', {}, [
				_('Container: %s').format(name),
				' ',
				E('span', {
					'class': 'badge status-' + status.toLowerCase(),
					'style': 'font-size: 14px; vertical-align: middle;'
				}, status)
			]),
			E('div', { 'style': 'margin-top: 10px;' }, [
				this.createActionButtons(this.containerId, name, status === 'running')
			])
		]);

		// Check if we should restore a specific tab
		const savedTab = sessionStorage.getItem('podman_active_tab');
		if (savedTab) {
			sessionStorage.removeItem('podman_active_tab');
		}

		// Create tab container
		const tabContainer = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'tab-panes' }, [
					// Info Tab (active by default unless savedTab exists)
					E('div', {
						'class': 'tab-pane',
						'data-tab': 'info',
						'data-tab-title': _('Info'),
						'data-tab-active': !savedTab || savedTab === 'info' ? 'true' : null
					}, [
						E('div', { 'id': 'tab-info-content' })
					]),
					// Resources Tab
					E('div', {
						'class': 'tab-pane',
						'data-tab': 'resources',
						'data-tab-title': _('Resources'),
						'data-tab-active': savedTab === 'resources' ? 'true' : null
					}, [
						E('div', { 'id': 'tab-resources-content' })
					]),
					// Stats Tab
					E('div', {
						'class': 'tab-pane',
						'data-tab': 'stats',
						'data-tab-title': _('Stats')
					}, [
						E('div', { 'id': 'tab-stats-content' }, [
							E('p', {}, _('Loading stats...'))
						])
					]),
					// Logs Tab
					E('div', {
						'class': 'tab-pane',
						'data-tab': 'logs',
						'data-tab-title': _('Logs')
					}, [
						E('div', { 'id': 'tab-logs-content' }, [
							E('p', {}, _('Loading logs...'))
						])
					]),
					// Console Tab
					E('div', {
						'class': 'tab-pane',
						'data-tab': 'console',
						'data-tab-title': _('Console')
					}, [
						E('div', { 'id': 'tab-console-content' }, [
							E('p', {}, _('Terminal access coming soon...'))
						])
					])
				])
			])
		]);

		// Initialize tabs after DOM is ready
		requestAnimationFrame(() => {
			const panes = tabContainer.querySelectorAll('.tab-pane');
			ui.tabs.initTabGroup(panes);

			// Load tab contents
			this.renderInfoTab();
			this.renderResourcesTab();
			this.renderStatsTab();
			this.renderLogsTab();
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
	createActionButtons: function(id, name, isRunning) {
		const buttons = [];

		if (isRunning) {
			buttons.push(new pui.Button(_('Stop'), () => this.handleStop(id), 'negative').render());
		} else {
			buttons.push(new pui.Button(_('Start'), () => this.handleStart(id), 'positive').render());
		}

		buttons.push(' ');
		buttons.push(new pui.Button(_('Restart'), () => this.handleRestart(id)).render());

		buttons.push(' ');
		buttons.push(new pui.Button(_('Remove'), () => this.handleRemove(id, name), 'remove').render());

		buttons.push(' ');
		buttons.push(new pui.Button(_('Back to List'), L.url('admin/podman/containers')).render());

		return E('div', {}, buttons);
	},

	/**
	 * Render the Info tab content
	 */
	renderInfoTab: function() {
		const container = document.getElementById('tab-info-content');
		if (!container) return;

		const data = this.containerData;
		const config = data.Config || {};
		const hostConfig = data.HostConfig || {};
		const networkSettings = data.NetworkSettings || {};

		// Build info sections
		const sections = [];

		// Basic Information
		const basicRows = [
			this.createEditableRow(_('Name'), data.Name ? data.Name.replace(/^\//, '') : '-', 'name'),
			this.createInfoRow(_('ID'), data.Id ? data.Id.substring(0, 64) : '-'),
			this.createInfoRow(_('Image'), config.Image || '-'),
			this.createInfoRow(_('Status'), data.State ? data.State.Status : '-'),
			this.createInfoRow(_('Created'), data.Created ? utils.formatDate(data.Created) : '-'),
			this.createInfoRow(_('Started'), data.State && data.State.StartedAt ? utils.formatDate(data.State.StartedAt) : '-')
		];

		// Add restart policy with edit
		basicRows.push(this.createEditableRestartRow(hostConfig.RestartPolicy ? hostConfig.RestartPolicy.Name || 'no' : 'no'));

		// Add health status if exists
		if (data.State && data.State.Health) {
			basicRows.push(this.createInfoRow(_('Health'), data.State.Health.Status || '-'));
		}

		sections.push(this.createSection(_('Basic Information'), basicRows));

		// Configuration
		const cmd = config.Cmd ? config.Cmd.join(' ') : '-';
		const entrypoint = config.Entrypoint ? config.Entrypoint.join(' ') : '-';

		sections.push(this.createSection(_('Configuration'), [
			this.createInfoRow(_('Command'), cmd),
			this.createInfoRow(_('Entrypoint'), entrypoint),
			this.createInfoRow(_('Working Directory'), config.WorkingDir || '-'),
			this.createInfoRow(_('User'), config.User || '-'),
			this.createInfoRow(_('Hostname'), config.Hostname || '-'),
			this.createInfoRow(_('Privileged'), hostConfig.Privileged ? _('Yes') : _('No')),
			this.createInfoRow(_('TTY'), config.Tty ? _('Yes') : _('No')),
			this.createInfoRow(_('Interactive'), config.OpenStdin ? _('Yes') : _('No'))
		]));

		// Network
		const networkRows = [
			this.createInfoRow(_('Network Mode'), hostConfig.NetworkMode || 'default')
		];

		if (networkSettings.IPAddress) {
			networkRows.push(this.createInfoRow(_('IP Address'), networkSettings.IPAddress));
		}

		// Add network connections
		if (networkSettings.Networks && Object.keys(networkSettings.Networks).length > 0) {
			Object.keys(networkSettings.Networks).forEach((netName) => {
				const net = networkSettings.Networks[netName];
				networkRows.push(
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, netName),
						E('td', { 'class': 'td' }, [
							net.IPAddress || '-',
							' ',
							E('span', { 'style': 'margin-left: 10px;' }, [
								new pui.Button(_('Disconnect'), () => this.handleNetworkDisconnect(netName), 'remove').render()
							])
						])
					])
				);
			});
		}

		// Add connect to network option
		networkRows.push(this.createNetworkConnectRow());

		// Ports - display as single row with line breaks
		const ports = [];
		if (hostConfig.PortBindings && Object.keys(hostConfig.PortBindings).length > 0) {
			Object.keys(hostConfig.PortBindings).forEach(function(containerPort) {
				const bindings = hostConfig.PortBindings[containerPort];
				if (bindings) {
					bindings.forEach(function(binding) {
						const hostIp = binding.HostIp || '0.0.0.0';
						const hostPort = binding.HostPort || '-';
						ports.push(hostIp + ':' + hostPort + ' → ' + containerPort);
					});
				}
			});
		}

		if (ports.length > 0) {
			networkRows.push(this.createInfoRow(_('Port Mappings'), ports.join('<br>')));
		}

		// Links - display as single row with line breaks
		const links = [];
		if (hostConfig.Links && hostConfig.Links.length > 0) {
			hostConfig.Links.forEach(function(link) {
				links.push(link);
			});
		}

		if (links.length > 0) {
			networkRows.push(this.createInfoRow(_('Links'), links.join('<br>')));
		}

		sections.push(this.createSection(_('Network'), networkRows));

		// Environment Variables
		if (config.Env && config.Env.length > 0) {
			const envRows = config.Env.map(function(env) {
				const parts = env.split('=');
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'font-family: monospace; word-break: break-all;' }, parts[0]),
					E('td', { 'class': 'td', 'style': 'font-family: monospace; word-break: break-all;' }, parts.slice(1).join('='))
				]);
			});

			sections.push(this.createTableSection(_('Environment Variables'),
				[_('Variable'), _('Value')],
				envRows
			));
		}

		// Mounts
		if (data.Mounts && data.Mounts.length > 0) {
			const mountRows = data.Mounts.map(function(mount) {
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, mount.Type || '-'),
					E('td', { 'class': 'td', 'style': 'word-break: break-all;' }, mount.Source || '-'),
					E('td', { 'class': 'td', 'style': 'word-break: break-all;' }, mount.Destination || '-'),
					E('td', { 'class': 'td' }, mount.RW ? 'rw' : 'ro')
				]);
			});

			sections.push(this.createTableSection(_('Mounts'),
				[_('Type'), _('Source'), _('Destination'), _('Mode')],
				mountRows
			));
		}

		// Labels
		if (config.Labels && Object.keys(config.Labels).length > 0) {
			const labelRows = [];
			Object.keys(config.Labels).forEach(function(key) {
				labelRows.push(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'font-family: monospace; word-break: break-all;' }, key),
					E('td', { 'class': 'td', 'style': 'font-family: monospace; word-break: break-all;' }, config.Labels[key])
				]));
			});

			sections.push(this.createTableSection(_('Labels'),
				[_('Key'), _('Value')],
				labelRows
			));
		}

		// Append all sections
		sections.forEach(function(section) {
			container.appendChild(section);
		});
	},

	/**
	 * Render the Resources tab content
	 */
	renderResourcesTab: function() {
		const container = document.getElementById('tab-resources-content');
		if (!container) return;

		const data = this.containerData;
		const hostConfig = data.HostConfig || {};

		// Get current resource values
		const cpuShares = hostConfig.CpuShares || 0;
		const cpuQuota = hostConfig.CpuQuota || 0;
		const cpuPeriod = hostConfig.CpuPeriod || 100000;
		const memory = hostConfig.Memory || 0;
		const memorySwap = hostConfig.MemorySwap || 0;
		const blkioWeight = hostConfig.BlkioWeight || 0;

		// Calculate CPU limit from quota/period (CPUs = quota / period)
		const cpuLimit = cpuQuota > 0 ? (cpuQuota / cpuPeriod).toFixed(2) : '';

		// Build form
		const form = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-descr' }, _('Configure resource limits for this container. Changes will be applied immediately.')),
			E('div', { 'class': 'cbi-section-node' }, [
				// CPU Resources
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('CPU Limit')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'number',
							'id': 'resource-cpu-limit',
							'class': 'cbi-input-text',
							'value': cpuLimit,
							'placeholder': '0.5, 1.0, 2.0',
							'step': '0.1',
							'min': '0',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _('Number of CPUs (e.g., 0.5, 1.0, 2.0). Leave empty for unlimited.'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('CPU Shares Weight')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'number',
							'id': 'resource-cpu-shares',
							'class': 'cbi-input-text',
							'value': cpuShares || '',
							'placeholder': '1024',
							'min': '0',
							'max': '262144',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _('CPU shares (relative weight), default is 1024. 0 = use default.'))
					])
				]),
				// Memory Resources
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Memory Limit')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'id': 'resource-memory',
							'class': 'cbi-input-text',
							'value': memory > 0 ? utils.formatBytes(memory, 0) : '',
							'placeholder': '512m, 1g, 2g',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _('Memory limit (e.g., 512m, 1g, 2g). Leave empty for unlimited.'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Memory + Swap Limit')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'id': 'resource-memory-swap',
							'class': 'cbi-input-text',
							'value': memorySwap > 0 ? utils.formatBytes(memorySwap, 0) : '',
							'placeholder': '1g, 2g',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _('Total memory limit (memory + swap). -1 for unlimited swap. Leave empty for unlimited.'))
					])
				]),
				// Block IO
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Block IO Weight')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'number',
							'id': 'resource-blkio-weight',
							'class': 'cbi-input-text',
							'value': blkioWeight || '',
							'placeholder': '500',
							'min': '10',
							'max': '1000',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _('Block IO weight (relative weight), 10-1000. 0 = use default.'))
					])
				]),
				// Update button
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, ' '),
					E('div', { 'class': 'cbi-value-field' }, [
						new pui.Button(_('Update Resources'), () => this.handleResourceUpdate(), 'save').render()
					])
				])
			])
		]);

		container.appendChild(form);
	},

	/**
	 * Render the Stats tab content
	 */
	renderStatsTab: function() {
		const container = document.getElementById('tab-stats-content');
		if (!container) return;

		// Clear existing content
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		// Create stats display
		const statsDisplay = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('table', { 'class': 'table', 'id': 'stats-table' }, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('CPU Usage')),
						E('td', { 'class': 'td', 'id': 'stat-cpu' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Memory Usage')),
						E('td', { 'class': 'td', 'id': 'stat-memory' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Memory Limit')),
						E('td', { 'class': 'td', 'id': 'stat-memory-limit' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Memory %')),
						E('td', { 'class': 'td', 'id': 'stat-memory-percent' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Network I/O')),
						E('td', { 'class': 'td', 'id': 'stat-network' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Block I/O')),
						E('td', { 'class': 'td', 'id': 'stat-blockio' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('PIDs')),
						E('td', { 'class': 'td', 'id': 'stat-pids' }, '-')
					])
				])
			])
		]);

		container.appendChild(statsDisplay);

		// Load stats
		this.updateStats();
	},

	/**
	 * Update stats display
	 */
	updateStats: function() {
		podmanRPC.container.stats(this.containerId).then((result) => {
			if (!result || !result.Stats || result.Stats.length === 0) {
				return;
			}

			const stats = result.Stats[0];

			// CPU Usage
			const cpuPercent = stats.CPUPerc || '0%';
			document.getElementById('stat-cpu').textContent = cpuPercent;

			// Memory Usage
			const memUsage = stats.MemUsage || '-';
			document.getElementById('stat-memory').textContent = memUsage;

			// Memory Limit
			const memLimit = stats.MemLimit ? utils.formatBytes(stats.MemLimit) : _('Unlimited');
			document.getElementById('stat-memory-limit').textContent = memLimit;

			// Memory Percent
			const memPercent = stats.MemPerc || '0%';
			document.getElementById('stat-memory-percent').textContent = memPercent;

			// Network I/O
			const netIO = stats.NetIO || '-';
			document.getElementById('stat-network').textContent = netIO;

			// Block I/O
			const blockIO = stats.BlockIO || '-';
			document.getElementById('stat-blockio').textContent = blockIO;

			// PIDs
			const pids = stats.PIDs || '0';
			document.getElementById('stat-pids').textContent = pids;

		}).catch((err) => {
			console.error('Failed to load stats:', err);
		});
	},

	/**
	 * Render the Logs tab content
	 */
	renderLogsTab: function() {
		const container = document.getElementById('tab-logs-content');
		if (!container) return;

		// Clear existing content
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		// Create logs display
		const logsDisplay = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				// Controls
				E('div', { 'style': 'margin-bottom: 10px;' }, [
					E('label', { 'style': 'margin-right: 15px;' }, [
						E('input', {
							'type': 'checkbox',
							'id': 'log-stream-toggle',
							'style': 'margin-right: 5px;',
							'change': (ev) => this.toggleLogStream(ev)
						}),
						_('Live Stream')
					]),
					E('label', { 'style': 'margin-right: 15px;' }, [
						_('Lines: '),
						E('input', {
							'type': 'number',
							'id': 'log-lines',
							'class': 'cbi-input-text',
							'value': '1000',
							'min': '10',
							'max': '10000',
							'style': 'width: 80px; margin-left: 5px;'
						})
					]),
					new pui.Button(_('Clear'), () => this.clearLogs()).render(),
					' ',
					new pui.Button(_('Refresh'), () => this.refreshLogs()).render()
				]),
				// Logs container
				E('pre', {
					'id': 'logs-output',
					'style': 'background: #000; color: #0f0; padding: 10px; height: 600px; overflow: auto; font-family: monospace; font-size: 12px; white-space: pre; resize: vertical;'
				}, _('Loading logs...'))
			])
		]);

		container.appendChild(logsDisplay);

		// Load initial logs
		this.refreshLogs();
	},

	/**
	 * Refresh logs
	 */
	refreshLogs: function() {
		const output = document.getElementById('logs-output');
		if (!output) return;

		// Get the number of lines from input
		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 1000 : 1000;

		podmanRPC.container.logs(this.containerId, 'stdout=true&stderr=true&tail=' + lines).then(function(result) {
			if (result && result.data) {
				output.textContent = result.data || _('No logs available');
			} else {
				output.textContent = _('No logs available');
			}
			// Scroll to bottom
			output.scrollTop = output.scrollHeight;
		}).catch(function(err) {
			output.textContent = _('Failed to load logs: %s').format(err.message);
		});
	},

	/**
	 * Clear logs display
	 */
	clearLogs: function() {
		const output = document.getElementById('logs-output');
		if (output) {
			output.textContent = '';
		}
	},

	/**
	 * Toggle log streaming
	 */
	toggleLogStream: function(ev) {
		const enabled = ev.target.checked;

		if (enabled) {
			// Start streaming
			this.logStreamInterval = setInterval(() => this.refreshLogs(), 2000);
		} else {
			// Stop streaming
			if (this.logStreamInterval) {
				clearInterval(this.logStreamInterval);
				this.logStreamInterval = null;
			}
		}
	},

	/**
	 * Create an info section with key-value pairs
	 * @param {string} title - Section title
	 * @param {Array} rows - Table rows (already created)
	 * @returns {Element} Section element
	 */
	createSection: function(title, rows) {
		return E('div', { 'class': 'cbi-section', 'style': 'margin-bottom: 20px;' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-section-node' }, [
				E('table', { 'class': 'table' }, rows)
			])
		]);
	},

	/**
	 * Create a table section
	 * @param {string} title - Section title
	 * @param {Array<string>} headers - Table headers
	 * @param {Array} rows - Table rows (already created)
	 * @returns {Element} Section element
	 */
	createTableSection: function(title, headers, rows) {
		const headerRow = E('tr', { 'class': 'tr table-titles' },
			headers.map(function(header) {
				return E('th', { 'class': 'th' }, header);
			})
		);

		return E('div', { 'class': 'cbi-section', 'style': 'margin-bottom: 20px;' }, [
			E('h3', {}, title),
			E('div', { 'class': 'cbi-section-node' }, [
				E('table', { 'class': 'table' }, [headerRow].concat(rows))
			])
		]);
	},

	/**
	 * Create an info row
	 * @param {string} label - Row label
	 * @param {string} value - Row value
	 * @returns {Element} Table row
	 */
	createInfoRow: function(label, value) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, label),
			E('td', { 'class': 'td', 'style': 'word-break: break-word;' },
				typeof value === 'string' && value.indexOf('<br>') !== -1 ?
					E('span', { 'innerHTML': value }) :
					value
			)
		]);
	},

	/**
	 * Create an editable name row
	 * @param {string} label - Row label
	 * @param {string} value - Current value
	 * @param {string} field - Field name
	 * @returns {Element} Table row
	 */
	createEditableRow: function(label, value, field) {
		const inputId = 'edit-' + field;
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, label),
			E('td', { 'class': 'td' }, [
				E('input', {
					'type': 'text',
					'id': inputId,
					'class': 'cbi-input-text',
					'value': value,
					'style': 'width: 60%; margin-right: 5px;'
				}),
				new pui.Button(_('Update'), () => this.handleUpdateName(document.getElementById(inputId).value), 'apply').render()
			])
		]);
	},

	/**
	 * Create an editable restart policy row
	 * @param {string} currentPolicy - Current restart policy
	 * @returns {Element} Table row
	 */
	createEditableRestartRow: function(currentPolicy) {
		const selectId = 'edit-restart-policy';
		const policies = {
			'no': _('No'),
			'always': _('Always'),
			'on-failure': _('On Failure'),
			'unless-stopped': _('Unless Stopped')
		};

		const options = [];
		Object.keys(policies).forEach(function(key) {
			options.push(E('option', {
				'value': key,
				'selected': key === currentPolicy ? 'selected' : null
			}, policies[key]));
		});

		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Restart Policy')),
			E('td', { 'class': 'td' }, [
				E('select', {
					'id': selectId,
					'class': 'cbi-input-select',
					'style': 'width: 60%; margin-right: 5px;'
				}, options),
				new pui.Button(_('Update'), () => this.handleUpdateRestartPolicy(document.getElementById(selectId).value), 'apply').render()
			])
		]);
	},

	/**
	 * Create network connect row
	 * @returns {Element} Table row
	 */
	createNetworkConnectRow: function() {
		const selectId = 'connect-network-select';
		const ipInputId = 'connect-network-ip';

		const options = [E('option', { 'value': '' }, _('-- Select Network --'))];

		if (this.networksData && Array.isArray(this.networksData)) {
			this.networksData.forEach(function(net) {
				const name = net.Name || net.name;
				if (name && name !== 'none' && name !== 'host') {
					options.push(E('option', { 'value': name }, name));
				}
			});
		}

		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _('Connect to')),
			E('td', { 'class': 'td' }, [
				E('select', {
					'id': selectId,
					'class': 'cbi-input-select',
					'style': 'width: 40%; margin-right: 5px;'
				}, options),
				E('input', {
					'type': 'text',
					'id': ipInputId,
					'class': 'cbi-input-text',
					'placeholder': _('IP (optional)'),
					'style': 'width: 30%; margin-right: 5px;'
				}),
				new pui.Button(_('Connect'), () => {
					const netName = document.getElementById(selectId).value;
					const ip = document.getElementById(ipInputId).value;
					if (netName) {
						this.handleNetworkConnect(netName, ip);
					}
				}, 'positive').render()
			])
		]);
	},

	/**
	 * Handle name update
	 * @param {string} newName - New container name
	 */
	handleUpdateName: function(newName) {
		if (!newName || newName === this.containerData.Name.replace(/^\//, '')) {
			return;
		}

		ui.showModal(_('Updating Container'), [
			E('p', { 'class': 'spinning' }, _('Renaming container...'))
		]);

		// Podman rename API call
		podmanRPC.container.rename(this.containerId, newName).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to rename container: %s').format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Container renamed successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to rename container: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle restart policy update
	 * @param {string} policy - New restart policy
	 */
	handleUpdateRestartPolicy: function(policy) {
		ui.showModal(_('Updating Container'), [
			E('p', { 'class': 'spinning' }, _('Updating restart policy...'))
		]);

		// Podman libpod API uses query parameters for restart policy
		const updateData = {
			RestartPolicy: policy
		};

		// Only add RestartRetries if policy is on-failure
		if (policy === 'on-failure') {
			updateData.RestartRetries = 5;
		}

		podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to update restart policy: %s').format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Restart policy updated successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to update restart policy: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle network connect
	 * @param {string} networkName - Network name
	 * @param {string} ip - Optional IP address
	 */
	handleNetworkConnect: function(networkName, ip) {
		ui.showModal(_('Connecting to Network'), [
			E('p', { 'class': 'spinning' }, _('Connecting container to network...'))
		]);

		// Build params according to Podman API NetworkConnectOptions schema
		const params = { container: this.containerId };
		if (ip) {
			params.static_ips = [ip];  // static_ips is an array
		}

		podmanRPC.network.connect(networkName, JSON.stringify(params)).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to connect to network: %s').format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Connected to network successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to connect to network: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle network disconnect
	 * @param {string} networkName - Network name
	 */
	handleNetworkDisconnect: function(networkName) {
		if (!confirm(_('Disconnect from network %s?').format(networkName)))
			return;

		ui.showModal(_('Disconnecting from Network'), [
			E('p', { 'class': 'spinning' }, _('Disconnecting container from network...'))
		]);

		// Build params according to Podman API DisconnectOptions schema (capital C for Container)
		podmanRPC.network.disconnect(networkName, JSON.stringify({ Container: this.containerId })).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to disconnect from network: %s').format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Disconnected from network successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to disconnect from network: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle resource update
	 */
	handleResourceUpdate: function() {
		// Get values from form
		const cpuLimit = document.getElementById('resource-cpu-limit').value;
		const cpuShares = document.getElementById('resource-cpu-shares').value;
		const memoryStr = document.getElementById('resource-memory').value;
		const memorySwapStr = document.getElementById('resource-memory-swap').value;
		const blkioWeight = document.getElementById('resource-blkio-weight').value;

		// Parse memory values (convert from human readable to bytes)
		const parseMemory = function(str) {
			if (!str) return 0;
			const match = str.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b?)?$/i);
			if (!match) return null;

			const value = parseFloat(match[1]);
			const unit = (match[2] || 'b').toLowerCase();

			const multipliers = {
				'b': 1,
				'k': 1024, 'kb': 1024,
				'm': 1024 * 1024, 'mb': 1024 * 1024,
				'g': 1024 * 1024 * 1024, 'gb': 1024 * 1024 * 1024,
				't': 1024 * 1024 * 1024 * 1024, 'tb': 1024 * 1024 * 1024 * 1024
			};

			return Math.floor(value * (multipliers[unit] || 1));
		};

		const memory = parseMemory(memoryStr);
		const memorySwap = memorySwapStr === '-1' ? -1 : parseMemory(memorySwapStr);

		// Validate
		if (memory === null && memoryStr) {
			ui.addNotification(null, E('p', _('Invalid memory format. Use: 512m, 1g, etc.')), 'error');
			return;
		}
		if (memorySwap === null && memorySwapStr && memorySwapStr !== '-1') {
			ui.addNotification(null, E('p', _('Invalid memory swap format. Use: 512m, 1g, -1, etc.')), 'error');
			return;
		}

		// Build update data according to UpdateEntities schema
		const updateData = {};

		// CPU configuration
		if (cpuLimit || cpuShares) {
			updateData.cpu = {};

			// CPU Limit: Convert CPUs to quota (quota = CPUs * period)
			if (cpuLimit) {
				const period = 100000; // Default period in microseconds
				updateData.cpu.quota = Math.floor(parseFloat(cpuLimit) * period);
				updateData.cpu.period = period;
			}

			// CPU Shares
			if (cpuShares) {
				updateData.cpu.shares = parseInt(cpuShares) || 0;
			}
		}

		// Memory configuration
		if (memory > 0 || memorySwap) {
			updateData.memory = {};

			if (memory > 0) {
				updateData.memory.limit = memory;
			}

			if (memorySwap !== 0) {
				updateData.memory.swap = memorySwap;
			}
		}

		// Block IO configuration
		if (blkioWeight) {
			updateData.blockIO = {
				weight: parseInt(blkioWeight) || 0
			};
		}

		if (Object.keys(updateData).length === 0) {
			ui.addNotification(null, E('p', _('No changes to apply')), 'warning');
			return;
		}

		ui.showModal(_('Updating Resources'), [
			E('p', { 'class': 'spinning' }, _('Updating container resources...'))
		]);

		// Call update RPC with body data
		podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to update resources: %s').format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Resources updated successfully')));
				// Store current tab before reload
				sessionStorage.setItem('podman_active_tab', 'resources');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to update resources: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Handle container start action
	 * @param {string} id - Container ID
	 */
	handleStart: function(id) {
		utils.handleOperation({
			loadingTitle: _('Starting Container'),
			loadingMessage: _('Starting container...'),
			successMessage: _('Container started successfully'),
			errorPrefix: _('Failed to start container'),
			operation: podmanRPC.container.start(id),
			onSuccess: () => {
				window.location.reload();
			}
		});
	},

	/**
	 * Handle container stop action
	 * @param {string} id - Container ID
	 */
	handleStop: function(id) {
		utils.handleOperation({
			loadingTitle: _('Stopping Container'),
			loadingMessage: _('Stopping container...'),
			successMessage: _('Container stopped successfully'),
			errorPrefix: _('Failed to stop container'),
			operation: podmanRPC.container.stop(id),
			onSuccess: () => {
				window.location.reload();
			}
		});
	},

	/**
	 * Handle container restart action
	 * @param {string} id - Container ID
	 */
	handleRestart: function(id) {
		utils.handleOperation({
			loadingTitle: _('Restarting Container'),
			loadingMessage: _('Restarting container...'),
			successMessage: _('Container restarted successfully'),
			errorPrefix: _('Failed to restart container'),
			operation: podmanRPC.container.restart(id),
			onSuccess: () => {
				window.location.reload();
			}
		});
	},

	/**
	 * Handle container remove action
	 * @param {string} id - Container ID
	 * @param {string} name - Container name
	 */
	handleRemove: function(id, name) {
		if (!confirm(_('Are you sure you want to remove container %s?').format(name)))
			return;

		utils.handleOperation({
			loadingTitle: _('Removing Container'),
			loadingMessage: _('Removing container...'),
			successMessage: _('Container removed successfully'),
			errorPrefix: _('Failed to remove container'),
			operation: podmanRPC.container.remove(id, false),
			onSuccess: function() {
				window.location.href = L.url('admin/podman/containers');
			}
		});
	}
});
