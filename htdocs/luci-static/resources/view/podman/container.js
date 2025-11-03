'use strict';
'require view';
'require poll';
'require ui';
'require form';
'require session';
'require podman.container-util as ContainerUtil';
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
	 * Load container data on view initialization
	 * @returns {Promise<Object>} Container inspect data and networks
	 */
	load: async function() {
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
		if (data && data.error || !data.container) {
			return utils.renderError(data.error || _('Container not found'));
		}

		// Store data for use in methods
		this.containerId = data.containerId;
		this.containerData = data.container;
		this.networksData = data.networks;

		// Create header with container name and status
		const name = this.containerData.Name ? this.containerData.Name.replace(/^\//, '') : this
			.containerId.substring(0, 12);
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
		const savedTab = session.getLocalData('podman_active_tab');
		if (savedTab) {
			session.setLocalData('podman_active_tab', null);
		}

		// Check if container has health check configured
		const hasHealthCheck = this.containerData.State && this.containerData.State.Health;

		// Build tab panes array dynamically
		const tabPanes = [
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
			])
		];

		// Conditionally add Health tab if health check is configured
		if (hasHealthCheck) {
			tabPanes.push(
				E('div', {
					'class': 'tab-pane',
					'data-tab': 'health',
					'data-tab-title': _('Health'),
					'data-tab-active': savedTab === 'health' ? 'true' : null
				}, [
					E('div', { 'id': 'tab-health-content' }, [
						E('p', {}, _('Loading health check data...'))
					])
				])
			);
		}

		// Add Inspect tab
		tabPanes.push(
			E('div', {
				'class': 'tab-pane',
				'data-tab': 'inspect',
				'data-tab-title': _('Inspect'),
				'data-tab-active': savedTab === 'inspect' ? 'true' : null
			}, [
				E('div', { 'id': 'tab-inspect-content' })
			])
		);

		// Add Console tab last
		tabPanes.push(
			E('div', {
				'class': 'tab-pane',
				'data-tab': 'console',
				'data-tab-title': _('Console')
			}, [
				E('div', { 'id': 'tab-console-content' }, [
					E('p', {}, _('Terminal access coming soon...'))
				])
			])
		);

		// Create tab container
		const tabContainer = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'tab-panes' }, tabPanes)
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

			// Load Health tab if configured
			if (hasHealthCheck) {
				this.renderHealthTab();
			}

			// Load Inspect tab
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
	createActionButtons: function(id, name, isRunning) {
		const buttons = [];

		if (isRunning) {
			buttons.push(new pui.Button(_('Stop'), () => this.handleStop(id), 'negative')
			.render());
		} else {
			buttons.push(new pui.Button(_('Start'), () => this.handleStart(id), 'positive')
				.render());
		}

		buttons.push(' ');
		buttons.push(new pui.Button(_('Restart'), () => this.handleRestart(id)).render());

		buttons.push(' ');
		buttons.push(new pui.Button(_('Remove'), () => this.handleRemove(id, name), 'remove')
			.render());

		buttons.push(' ');

		// Determine back button destination from query parameter
		const urlParams = new URLSearchParams(window.location.search);
		const from = urlParams.get('from');
		let backUrl, backText;

		if (from === 'pods') {
			backUrl = L.url('admin/podman/pods');
			backText = _('Back to Pods');
		} else {
			backUrl = L.url('admin/podman/containers');
			backText = _('Back to Containers');
		}

		buttons.push(new pui.Button(backText, backUrl).render());

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
			this.createEditableRow(_('Name'), data.Name ? data.Name.replace(/^\//, '') : '-',
				'name'),
			this.createInfoRow(_('ID'), data.Id ? data.Id.substring(0, 64) : '-'),
			this.createInfoRow(_('Image'), config.Image || '-'),
			this.createInfoRow(_('Status'), data.State ? data.State.Status : '-'),
			this.createInfoRow(_('Created'), data.Created ? utils.formatDate(data.Created) :
				'-'),
			this.createInfoRow(_('Started'), data.State && data.State.StartedAt ? utils
				.formatDate(data.State.StartedAt) : '-')
		];

		// Add restart policy with edit
		basicRows.push(this.createEditableRestartRow(hostConfig.RestartPolicy ? hostConfig
			.RestartPolicy.Name || 'no' : 'no'));

		// Add auto-update status from labels
		const autoUpdateLabel = config.Labels && config.Labels['io.containers.autoupdate'];
		if (autoUpdateLabel) {
			basicRows.push(this.createInfoRow(_('Auto-Update'), autoUpdateLabel));
		} else {
			basicRows.push(this.createInfoRow(_('Auto-Update'), _('Disabled')));
		}

		// Add health status if exists
		if (data.State && data.State.Health) {
			const healthStatus = data.State.Health.Status || 'none';
			const failingStreak = data.State.Health.FailingStreak || 0;
			const log = data.State.Health.Log || [];
			const lastCheck = log.length > 0 ? log[log.length - 1] : null;

			// Build health status display with badge
			const healthBadge = E('span', {
				'class': 'badge status-' + healthStatus.toLowerCase(),
				'style': 'margin-right: 10px;'
			}, healthStatus);

			const healthDetails = [healthBadge];

			// Add failing streak if unhealthy
			if (healthStatus === 'unhealthy' && failingStreak > 0) {
				healthDetails.push(E('span', { 'style': 'color: #ff6b6b;' },
					_(' (%d consecutive failures)').format(failingStreak)));
			}

			// Add last check time if available
			if (lastCheck && lastCheck.End) {
				healthDetails.push(E('br'));
				healthDetails.push(E('small', { 'style': 'color: #666;' },
					_('Last check: %s').format(utils.formatDate(lastCheck.End))));
			}

			// Add manual health check button if container is running
			if (status === 'running') {
				healthDetails.push(' ');
				healthDetails.push(new pui.Button(_('Run Check'), () => this.handleHealthCheck(),
					'positive').render());
			}

			basicRows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
					_('Health')),
				E('td', { 'class': 'td', 'style': 'word-break: break-word;' },
					healthDetails)
			]));
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
			this.createInfoRow(_('Privileged'), hostConfig.Privileged ? _('Yes') : _(
				'No')),
			this.createInfoRow(_('TTY'), config.Tty ? _('Yes') : _('No')),
			this.createInfoRow(_('Interactive'), config.OpenStdin ? _('Yes') : _(
				'No'))
		]));

		// Network
		const networkRows = [
			this.createInfoRow(_('Network Mode'), hostConfig.NetworkMode || 'default')
		];

		// Add network connections
		// System networks that cannot be disconnected (default Podman networks)
		const systemNetworks = ['bridge', 'host', 'none', 'container', 'slirp4netns'];
		let userNetworks = [];

		if (networkSettings.Networks && Object.keys(networkSettings.Networks).length > 0) {
			// Filter to only show user-created networks
			userNetworks = Object.keys(networkSettings.Networks).filter((netName) => {
				return !systemNetworks.includes(netName);
			});

			// Only display user-created networks with disconnect buttons
		userNetworks.forEach((netName) => {
			const net = networkSettings.Networks[netName];
			networkRows.push(
				E('tr', { 'class': 'tr' }, [
					E('td', {
						'class': 'td',
						'style': 'width: 33%; font-weight: bold; cursor: help;',
						'title': (() => {
							const parts = [];
							if (net.IPAddress) parts.push(`IPv4: ${net.IPAddress}`);
							if (net.GlobalIPv6Address) parts.push(`IPv6: ${net.GlobalIPv6Address}`);
							else parts.push('IPv6: disabled');
							if (net.Gateway) parts.push(`Gateway: ${net.Gateway}`);
							if (net.MacAddress) parts.push(`MAC: ${net.MacAddress}`);
							if (net.NetworkID) parts.push(`Network ID: ${net.NetworkID.substring(0, 12)}`);
							return parts.join('\n');
						})()
					}, netName),
					E('td', { 'class': 'td' }, [
						net.IPAddress || '-',
						' ',
						E('span', { 'style': 'margin-left: 10px;' }, [
							new pui.Button(_('Disconnect'), () => this
								.handleNetworkDisconnect(netName),
								'remove').render()
						])
					])
				])
			);
		});
		}

		// Only show legacy IP Address row if no user networks are displayed
		// (avoids duplicate IP display when networks are shown with their IPs)
		if (networkSettings.IPAddress && userNetworks.length === 0) {
			networkRows.push(this.createInfoRow(_('IP Address'), networkSettings.IPAddress));
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
						ports.push(hostIp + ':' + hostPort + ' → ' +
							containerPort);
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
				const varName = parts[0];
				const varValue = parts.slice(1).join('=');

				// Create censored value display (bullet points)
				const censoredValue = '••••••••';

				// Create clickable element that toggles between censored and revealed
				const valueCell = E('td', {
					'class': 'td',
					'style': 'font-family: monospace; word-break: break-all; cursor: pointer; user-select: none;',
					'title': _('Click to reveal/hide value'),
					'data-revealed': 'false',
					'data-value': varValue
				}, censoredValue);

				// Toggle reveal/hide on click
				valueCell.addEventListener('click', function() {
					const isRevealed = this.getAttribute('data-revealed') === 'true';
					if (isRevealed) {
						// Hide value
						this.textContent = censoredValue;
						this.setAttribute('data-revealed', 'false');
					} else {
						// Reveal value
						this.textContent = this.getAttribute('data-value');
						this.setAttribute('data-revealed', 'true');
					}
				});

				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'font-family: monospace; word-break: break-all;' },
						varName),
					valueCell
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
					E('td', { 'class': 'td', 'title': mount.Source || '-' }, utils
						.truncate(mount.Source || '-', 50)),
					E('td', { 'class': 'td', 'title': mount.Destination || '-' },
						utils.truncate(mount.Destination || '-', 50)),
					E('td', { 'class': 'td' }, mount.RW ? 'rw' : 'ro')
				]);
			});

			sections.push(this.createTableSection(_('Mounts'),
				[_('Type'), _('Source'), _('Destination'), _('Mode')],
				mountRows
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
			E('div', { 'class': 'cbi-section-descr' }, _(
				'Configure resource limits for this container. Changes will be applied immediately.'
				)),
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
						E('span', { 'class': 'cbi-value-description' }, _(
							'Number of CPUs (e.g., 0.5, 1.0, 2.0). Leave empty for unlimited.'
							))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _(
						'CPU Shares Weight')),
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
						E('span', { 'class': 'cbi-value-description' }, _(
							'CPU shares (relative weight), default is 1024. 0 = use default.'
							))
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
							'value': memory > 0 ? utils.formatBytes(
								memory, 0) : '',
							'placeholder': '512m, 1g, 2g',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _(
							'Memory limit (e.g., 512m, 1g, 2g). Leave empty for unlimited.'
							))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _(
						'Memory + Swap Limit')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'id': 'resource-memory-swap',
							'class': 'cbi-input-text',
							'value': memorySwap > 0 ? utils.formatBytes(
								memorySwap, 0) : '',
							'placeholder': '1g, 2g',
							'style': 'width: 200px; margin-right: 5px;'
						}),
						E('span', { 'class': 'cbi-value-description' }, _(
							'Total memory limit (memory + swap). -1 for unlimited swap. Leave empty for unlimited.'
							))
					])
				]),
				// Block IO
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _(
						'Block IO Weight')),
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
						E('span', { 'class': 'cbi-value-description' }, _(
							'Block IO weight (relative weight), 10-1000. 0 = use default.'
							))
					])
				]),
				// Update button
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, ' '),
					E('div', { 'class': 'cbi-value-field' }, [
						new pui.Button(_('Update Resources'), () => this
							.handleResourceUpdate(), 'save').render()
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
			E('h3', {}, _('Resource Usage')),
			E('div', { 'class': 'cbi-section-node' }, [
				E('table', { 'class': 'table', 'id': 'stats-table' }, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('CPU Usage')),
						E('td', { 'class': 'td', 'id': 'stat-cpu' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('Memory Usage')),
						E('td', { 'class': 'td', 'id': 'stat-memory' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('Memory Limit')),
						E('td', { 'class': 'td', 'id': 'stat-memory-limit' },
							'-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('Memory %')),
						E('td', { 'class': 'td', 'id': 'stat-memory-percent' },
							'-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('Network I/O')),
						E('td', { 'class': 'td', 'id': 'stat-network' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('Block I/O')),
						E('td', { 'class': 'td', 'id': 'stat-blockio' }, '-')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' },
							_('PIDs')),
						E('td', { 'class': 'td', 'id': 'stat-pids' }, '-')
					])
				])
			])
		]);

		// Create process list display
		const processDisplay = E('div', { 'class': 'cbi-section', 'style': 'margin-top: 20px;' }, [
			E('h3', {}, _('Running Processes')),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'id': 'process-list-container' }, [
					E('p', {}, _('Loading process list...'))
				])
			])
		]);

		container.appendChild(statsDisplay);
		container.appendChild(processDisplay);

		// Load stats and process list initially
		this.updateStats();
		this.updateProcessList();

		// Setup auto-refresh using poll.add() - refresh every 3 seconds
		const view = this;
		this.statsPollFn = function() {
			return Promise.all([
				view.updateStats(),
				view.updateProcessList()
			]).catch((err) => {
				console.error('Stats/Process poll error:', err);
			});
		};

		// Add poll for auto-refresh
		poll.add(this.statsPollFn, 3);
	},

	/**
	 * Format network I/O stats for display
	 * @param {Object} networks - Network stats object or pre-formatted string
	 * @returns {string} Formatted network I/O string
	 */
	formatNetworkIO: function(networks) {
		// Already formatted string (NetIO field)
		if (typeof networks === 'string') {
			return networks;
		}

		// Networks object format: { eth0: { rx_bytes: 123, tx_bytes: 456, ... }, ... }
		if (typeof networks === 'object' && networks !== null) {
			const parts = [];
			Object.keys(networks).forEach((iface) => {
				const net = networks[iface];
				if (net && typeof net === 'object') {
					const rx = net.rx_bytes ? utils.formatBytes(net.rx_bytes) : '0B';
					const tx = net.tx_bytes ? utils.formatBytes(net.tx_bytes) : '0B';
					parts.push(`${iface}: ↓ ${rx} / ↑ ${tx}`);
				}
			});
			return parts.length > 0 ? parts.join(', ') : '-';
		}

		return '-';
	},

	/**
	 * Format block I/O stats for display
	 * @param {Object} blkio - Block I/O stats object or pre-formatted string
	 * @returns {string} Formatted block I/O string
	 */
	formatBlockIO: function(blkio) {
		// Already formatted string (BlockIO field)
		if (typeof blkio === 'string') {
			return blkio;
		}

		// Block I/O stats object
		if (typeof blkio === 'object' && blkio !== null) {
			// Try io_service_bytes_recursive first (most common)
			if (blkio.io_service_bytes_recursive && Array.isArray(blkio
					.io_service_bytes_recursive) && blkio.io_service_bytes_recursive.length > 0) {
				let read = 0;
				let write = 0;
				blkio.io_service_bytes_recursive.forEach((entry) => {
					if (entry.op === 'read' || entry.op === 'Read') {
						read += entry.value || 0;
					} else if (entry.op === 'write' || entry.op === 'Write') {
						write += entry.value || 0;
					}
				});
				return `Read: ${utils.formatBytes(read)} / Write: ${utils.formatBytes(write)}`;
			}

			// No data available
			return _('No I/O');
		}

		return '-';
	},

	/**
	 * Format PIDs stats for display
	 * @param {*} pids - PIDs stats (number, string, or object)
	 * @returns {string} Formatted PIDs string
	 */
	formatPIDs: function(pids) {
		// Direct number or string
		if (typeof pids === 'number' || typeof pids === 'string') {
			return String(pids);
		}

		// Object format { current: X, limit: Y }
		if (typeof pids === 'object' && pids !== null) {
			const current = pids.current || pids.Current || 0;
			const limit = pids.limit || pids.Limit;
			if (limit && limit > 0) {
				return `${current} / ${limit}`;
			}
			return String(current);
		}

		return '0';
	},

	/**
	 * Update stats display
	 */
	updateStats: function() {
		return podmanRPC.container.stats(this.containerId).then((result) => {
			// Podman stats API returns different formats:
			// - With stream=false: Single stats object
			// - CLI format: Wrapped in Stats array
			// Try both formats
			let stats = null;
			if (result && result.Stats && result.Stats.length > 0) {
				// Array format (CLI-style)
				stats = result.Stats[0];
			} else if (result && typeof result === 'object') {
				// Direct object format (API)
				stats = result;
			}

			if (!stats) {
				return;
			}

			// CPU Usage - try different field names
			const cpuPercent = stats.CPUPerc || stats.cpu_percent || stats.cpu || '0%';
			const cpuEl = document.getElementById('stat-cpu');
			if (cpuEl) cpuEl.textContent = cpuPercent;

			// Memory Usage - try different field names
			const memUsage = stats.MemUsage || stats.mem_usage ||
				(stats.memory_stats && stats.memory_stats.usage ? utils.formatBytes(stats
					.memory_stats.usage) : '-');
			const memEl = document.getElementById('stat-memory');
			if (memEl) memEl.textContent = memUsage;

			// Memory Limit - try different field names
			const memLimit = stats.MemLimit || stats.mem_limit ||
				(stats.memory_stats && stats.memory_stats.limit ? utils.formatBytes(stats
					.memory_stats.limit) : _('Unlimited'));
			const memLimitEl = document.getElementById('stat-memory-limit');
			if (memLimitEl) memLimitEl.textContent = memLimit;

			// Memory Percent - try different field names
			const memPercent = stats.MemPerc || stats.mem_percent || stats.mem || '0%';
			const memPercentEl = document.getElementById('stat-memory-percent');
			if (memPercentEl) memPercentEl.textContent = memPercent;

			// Network I/O - format nicely
			const netIO = stats.NetIO || stats.net_io || stats.network_io || stats
				.networks;
			const netEl = document.getElementById('stat-network');
			if (netEl) netEl.textContent = this.formatNetworkIO(netIO);

			// Block I/O - format nicely
			const blockIO = stats.BlockIO || stats.block_io || stats.blkio || stats
				.blkio_stats;
			const blockEl = document.getElementById('stat-blockio');
			if (blockEl) blockEl.textContent = this.formatBlockIO(blockIO);

			// PIDs - format nicely
			const pids = stats.PIDs || stats.pids || stats.pids_stats;
			const pidsEl = document.getElementById('stat-pids');
			if (pidsEl) pidsEl.textContent = this.formatPIDs(pids);

		}).catch((err) => {
			console.error('Stats error:', err);
			// Stats failed to load - show error only in console
		});
	},

	/**
	 * Update process list display
	 */
	updateProcessList: function() {
		return podmanRPC.container.top(this.containerId, '').then((result) => {
			const container = document.getElementById('process-list-container');
			if (!container) return;

			// Clear existing content
			while (container.firstChild) {
				container.removeChild(container.firstChild);
			}

			// Check if we have valid process data
			if (!result || !result.Titles || !result.Processes) {
				container.appendChild(E('p', {}, _('No process data available')));
				return;
			}

			const titles = result.Titles || [];
			const processes = result.Processes || [];

			if (titles.length === 0 || processes.length === 0) {
				container.appendChild(E('p', {}, _('No running processes')));
				return;
			}

			// Build table headers from Titles
			const headerRow = E('tr', { 'class': 'tr table-titles' },
				titles.map((title) => E('th', {
					'class': 'th',
					'style': 'font-family: monospace; white-space: nowrap;'
				}, title))
			);

			// Build table rows from Processes
			const processRows = processes.map((proc) => {
				return E('tr', { 'class': 'tr' },
					proc.map((cell, index) => {
						// Apply different styling based on column
						let style = 'font-family: monospace; font-size: 11px; padding: 4px 8px;';

						// Right-align numeric columns (PID, PPID, %CPU)
						if (titles[index] === 'PID' || titles[index] === 'PPID' || titles[index] === '%CPU') {
							style += ' text-align: right;';
						}
						// Truncate long COMMAND values
						else if (titles[index] === 'COMMAND') {
							style += ' max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
						}

						return E('td', {
							'class': 'td',
							'style': style,
							'title': cell || '-'  // Tooltip shows full value
						}, cell || '-');
					})
				);
			});

			// Create process table
			const processTable = E('table', {
				'class': 'table',
				'style': 'font-size: 11px; width: 100%;'
			}, [headerRow].concat(processRows));

			container.appendChild(processTable);

		}).catch((err) => {
			console.error('Process list error:', err);
			const container = document.getElementById('process-list-container');
			if (container) {
				while (container.firstChild) {
					container.removeChild(container.firstChild);
				}
				container.appendChild(E('p', { 'style': 'color: #999;' },
					_('Failed to load process list: %s').format(err.message || _('Unknown error'))));
			}
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
					new pui.Button(_('Refresh'), () => this.refreshLogs())
					.render()
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
	 * Strip Docker stream format headers (8-byte headers before each frame)
	 * Docker/Podman logs use multiplexed stream format:
	 * - Byte 0: Stream type (1=stdout, 2=stderr, 3=stdin)
	 * - Bytes 1-3: Padding
	 * - Bytes 4-7: Frame size (uint32 big-endian)
	 * - Bytes 8+: Actual data
	 * @param {string} text - Text with Docker stream headers
	 * @returns {string} Text without headers
	 */
	stripDockerStreamHeaders: function(text) {
		if (!text || text.length === 0) return text;

		let result = '';
		let pos = 0;

		while (pos < text.length) {
			// Need at least 8 bytes for header
			if (pos + 8 > text.length) {
				// Incomplete header, skip rest
				break;
			}

			// Read frame size from bytes 4-7 (big-endian uint32)
			const size = (text.charCodeAt(pos + 4) << 24) |
				(text.charCodeAt(pos + 5) << 16) |
				(text.charCodeAt(pos + 6) << 8) |
				text.charCodeAt(pos + 7);

			// Skip 8-byte header
			pos += 8;

			// Extract frame data
			if (pos + size <= text.length) {
				result += text.substring(pos, pos + size);
				pos += size;
			} else {
				// Incomplete frame, take what we can
				result += text.substring(pos);
				break;
			}
		}

		return result;
	},

	/**
	 * Strip ANSI escape sequences from log text
	 * @param {string} text - Text with ANSI codes
	 * @returns {string} Clean text
	 */
	stripAnsi: function(text) {
		if (!text) return text;
		// Remove ANSI escape sequences (colors, cursor movement, etc.)
		// eslint-disable-line no-control-regex
		return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g,
			'');
	},

	/**
	 * Refresh logs (non-streaming version for manual refresh)
	 */
	refreshLogs: function() {
		const output = document.getElementById('logs-output');
		if (!output) return;

		// Get the number of lines from input
		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 1000 : 1000;

		// Get last N lines (non-streaming)
		const params = 'stdout=true&stderr=true&tail=' + lines;

		output.textContent = _('Loading logs...');

		podmanRPC.container.logs(this.containerId, params).then((result) => {
			// Backend returns base64-encoded binary data in {data: "..."} object
			let base64Data = '';
			if (result && typeof result === 'object' && result.data) {
				base64Data = result.data;
			} else if (typeof result === 'string') {
				base64Data = result;
			}

			if (!base64Data) {
				output.textContent = _('No logs available');
				return;
			}

			// Decode base64 to binary string
			let binaryText = '';
			try {
				binaryText = atob(base64Data);
			} catch (e) {
				console.error('Base64 decode error:', e);
				output.textContent = _('Failed to decode logs');
				return;
			}

			// Strip Docker stream headers (8-byte headers)
			const withoutHeaders = this.stripDockerStreamHeaders(binaryText);

			// Strip ANSI escape sequences
			const cleanText = this.stripAnsi(withoutHeaders);

			if (cleanText && cleanText.trim().length > 0) {
				output.textContent = cleanText;
			} else {
				output.textContent = _('No logs available');
			}
			output.scrollTop = output.scrollHeight;
		}).catch((err) => {
			console.error('LOG ERROR:', err);
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
			// Start streaming session
			this.startLogStream();
		} else {
			// Stop streaming
			this.stopLogStream();
		}
	},

	/**
	 * Start log streaming session
	 */
	startLogStream: function() {
		const output = document.getElementById('logs-output');
		if (!output) return;

		// Get the number of lines from input
		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 1000 : 1000;

		// Clear output and show loading
		output.textContent = _('Loading logs...');

		// First load existing logs with non-streaming call
		const params = 'stdout=true&stderr=true&tail=' + lines;
		podmanRPC.container.logs(this.containerId, params).then((result) => {
			// Extract base64-encoded log data
			let base64Data = '';
			if (result && typeof result === 'object' && result.data) {
				base64Data = result.data;
			} else if (typeof result === 'string') {
				base64Data = result;
			}

			if (!base64Data) {
				output.textContent = '';
			} else {
				// Decode base64 to binary string
				const binaryText = atob(base64Data);

				// Strip Docker headers and ANSI codes
				const withoutHeaders = this.stripDockerStreamHeaders(binaryText);
				const cleanText = this.stripAnsi(withoutHeaders);

				output.textContent = cleanText || '';
			}
			output.scrollTop = output.scrollHeight;

			// Start streaming for NEW logs
			// NOTE: Don't use tail=0 with follow - it causes curl to exit immediately
			// Just use follow=true to stream new logs as they arrive
			return podmanRPC.container.logsStream(
				this.containerId,
				'stdout=true&stderr=true&follow=true'
			);
		}).then((result) => {
			if (!result || !result.session_id) {
				console.error('Failed to start stream:', result);
				const checkbox = document.getElementById('log-stream-toggle');
				if (checkbox) checkbox.checked = false;
				return;
			}

			// Store session ID and track byte offset in stream file (not displayed text length)
			this.logStreamSessionId = result.session_id;
			this.logStreamFileOffset = 0; // Start reading from beginning of stream file

			// Start polling for logs
			this.pollLogsStatus();
		}).catch((err) => {
			console.error('Stream error:', err);
			output.textContent = _('Failed to start log stream: %s').format(err.message);
			const checkbox = document.getElementById('log-stream-toggle');
			if (checkbox) checkbox.checked = false;
		});
	},

	/**
	 * Stop log streaming session
	 */
	stopLogStream: function() {
		// Store session ID for cleanup before clearing
		const sessionId = this.logStreamSessionId;

		// Clear session ID first to prevent poll function from running again
		this.logStreamSessionId = null;

		// Remove poll function if registered
		if (this.logPollFn) {
			try {
				poll.remove(this.logPollFn);
			} catch (e) {
				// Ignore errors if poll function was already removed
			}
			this.logPollFn = null;
		}

		// Cleanup backend resources (kill curl process, remove temp files)
		if (sessionId) {
			podmanRPC.container.logsStop(sessionId).catch((err) => {
				console.error('Failed to cleanup log stream:', err);
			});
		}
	},

	/**
	 * Poll log stream status using poll.add()
	 *
	 * Uses byte offset tracking to only fetch new data from the stream file.
	 */
	pollLogsStatus: function() {
		const outputEl = document.getElementById('logs-output');
		const view = this;

		// Define poll function and store reference for later removal
		this.logPollFn = function() {
			// Check if session still exists (user may have stopped it)
			if (!view.logStreamSessionId) {
				view.stopLogStream();
				return Promise.resolve();
			}

			// MUST return a Promise
			// Read from current offset to get only NEW data
			return podmanRPC.container.logsStatus(view.logStreamSessionId, view
				.logStreamFileOffset).then((status) => {
				// Check for output
				if (status.output && status.output.length > 0 && outputEl) {
					// Backend returns base64-encoded data - decode it first
					let binaryText = '';
					try {
						binaryText = atob(status.output);
					} catch (e) {
						console.error('Base64 decode error in streaming:', e);
						return;
					}

					// Update file offset BEFORE processing (in case of errors)
					view.logStreamFileOffset += binaryText.length;

					// Strip Docker headers first, then ANSI codes
					const withoutHeaders = view.stripDockerStreamHeaders(binaryText);
					const cleanOutput = view.stripAnsi(withoutHeaders);

					// Append the new content
					if (cleanOutput.length > 0) {
						outputEl.textContent += cleanOutput;
						outputEl.scrollTop = outputEl.scrollHeight;
					}
				}

				// Check for completion
				if (status.complete) {
					view.stopLogStream();

					const checkbox = document.getElementById('log-stream-toggle');
					if (checkbox) checkbox.checked = false;

					if (!status.success && outputEl) {
						outputEl.textContent += '\n\n' + _(
							'Log stream ended with error');
					}
				}
			}).catch((err) => {
				console.error('Poll error:', err);
				view.stopLogStream();

				if (outputEl) {
					outputEl.textContent += '\n\n' + _('Error polling log stream: %s')
						.format(err.message);
				}

				const checkbox = document.getElementById('log-stream-toggle');
				if (checkbox) checkbox.checked = false;
			});
		};

		// Add the poll using stored function reference
		poll.add(this.logPollFn, 1); // Poll every 1 second
	},

	/**
	 * Render the Health tab content
	 */
	renderHealthTab: function() {
		const container = document.getElementById('tab-health-content');
		if (!container) return;

		// Clear existing content
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		const data = this.containerData;
		const health = data.State && data.State.Health;

		if (!health) {
			container.appendChild(E('p', {}, _('No health check configured')));
			return;
		}

		// Health check configuration from Config.Healthcheck
		const healthConfig = data.Config && data.Config.Healthcheck;

		// Build health check information
		const sections = [];

		// Current Status Section
		const status = health.Status || 'none';
		const failingStreak = health.FailingStreak || 0;

		const statusRows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _(
					'Status')),
				E('td', { 'class': 'td' }, [
					E('span', {
						'class': 'badge status-' + status.toLowerCase(),
						'style': 'font-size: 16px;'
					}, status)
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _(
					'Failing Streak')),
				E('td', { 'class': 'td', 'style': failingStreak > 0 ?
							'color: #ff6b6b; font-weight: bold;' : '' },
					failingStreak > 0 ? _('%d consecutive failures').format(
					failingStreak) : _('No failures'))
			])
		];

		sections.push(this.createSection(_('Health Status'), statusRows));

		// Configuration Section
		if (healthConfig) {
			const configRows = [];

			if (healthConfig.Test && healthConfig.Test.length > 0) {
				const testCmd = healthConfig.Test.join(' ');
				configRows.push(this.createInfoRow(_('Test Command'), testCmd));
			}

			if (healthConfig.Interval) {
				configRows.push(this.createInfoRow(_('Interval'), utils.formatDuration(
					healthConfig.Interval)));
			}

			if (healthConfig.Timeout) {
				configRows.push(this.createInfoRow(_('Timeout'), utils.formatDuration(healthConfig
					.Timeout)));
			}

			if (healthConfig.StartPeriod) {
				configRows.push(this.createInfoRow(_('Start Period'), utils.formatDuration(
					healthConfig.StartPeriod)));
			}

			if (healthConfig.StartInterval) {
				configRows.push(this.createInfoRow(_('Start Interval'), utils.formatDuration(
					healthConfig.StartInterval)));
			}

			if (healthConfig.Retries) {
				configRows.push(this.createInfoRow(_('Retries'), String(healthConfig.Retries)));
			}

			if (configRows.length > 0) {
				sections.push(this.createSection(_('Configuration'), configRows));
			}
		}

		// Health Check History
		const log = health.Log || [];
		if (log.length > 0) {
			const historyRows = log.slice(-10).reverse().map((entry) => {
				const exitCode = entry.ExitCode !== undefined ? entry.ExitCode : '-';
				const exitStatus = exitCode === 0 ? _('Success') : _('Failed');
				const exitClass = exitCode === 0 ? 'status-healthy' : 'status-unhealthy';

				// Create output cell with textContent to prevent HTML injection
				const outputText = entry.Output ? entry.Output.trim() : '-';
				const outputCell = E('td', {
					'class': 'td',
					'style': 'font-family: monospace; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
					'title': outputText // Tooltip shows full output on hover
				});
				outputCell.textContent = outputText;

				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, entry.Start ? utils.formatDate(
						entry.Start) : '-'),
					E('td', { 'class': 'td' }, entry.End ? utils.formatDate(entry
						.End) : '-'),
					E('td', { 'class': 'td' }, [
						E('span', { 'class': 'badge ' + exitClass },
							exitStatus),
						' ',
						E('small', {}, '(Exit: ' + exitCode + ')')
					]),
					outputCell
				]);
			});

			sections.push(this.createTableSection(_('Recent Checks (Last 10)'),
				[_('Started'), _('Ended'), _('Result'), _('Output')],
				historyRows
			));
		}

		// Append all sections
		sections.forEach((section) => {
			container.appendChild(section);
		});

		// Add manual health check button
		container.appendChild(E('div', { 'style': 'margin-top: 20px;' }, [
			new pui.Button(_('Run Health Check Now'), () => this.handleHealthCheck(),
				'positive').render()
		]));
	},

	/**
	 * Render the Inspect tab content
	 */
	renderInspectTab: function() {
		const container = document.getElementById('tab-inspect-content');
		if (!container) return;

		const data = this.containerData;

		// Display full JSON inspect data
		const jsonDisplay = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-descr' }, _(
				'Full container inspect data in JSON format. This is the raw data returned from the Podman API.'
			)),
			E('div', { 'class': 'cbi-section-node' }, [
				E('pre', {
					'style': 'background: #f5f5f5; padding: 15px; overflow: auto; max-height: 800px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 12px; line-height: 1.5;'
				}, JSON.stringify(data, null, 2))
			])
		]);

		container.appendChild(jsonDisplay);
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
				new pui.Button(_('Update'), () => this.handleUpdateName(document
					.getElementById(inputId).value), 'apply').render()
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
			E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _(
				'Restart Policy')),
			E('td', { 'class': 'td' }, [
				E('select', {
					'id': selectId,
					'class': 'cbi-input-select',
					'style': 'width: 60%; margin-right: 5px;'
				}, options),
				new pui.Button(_('Update'), () => this.handleUpdateRestartPolicy(
					document.getElementById(selectId).value), 'apply').render()
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
			E('td', { 'class': 'td', 'style': 'width: 33%; font-weight: bold;' }, _(
				'Connect to')),
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

		pui.showSpinningModal(_('Updating Container'), _('Renaming container...'));

		// Podman rename API call
		podmanRPC.container.rename(this.containerId, newName).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to rename container: %s')
					.format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Container renamed successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to rename container: %s').format(err
				.message)), 'error');
		});
	},

	/**
	 * Handle restart policy update
	 * @param {string} policy - New restart policy
	 */
	handleUpdateRestartPolicy: function(policy) {
		pui.showSpinningModal(_('Updating Container'), _('Updating restart policy...'));

		// Podman libpod API uses query parameters for restart policy
		const updateData = {
			RestartPolicy: policy
		};

		// Only add RestartRetries if policy is on-failure
		if (policy === 'on-failure') {
			updateData.RestartRetries = 5;
		}

		podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then((
		result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to update restart policy: %s')
					.format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _(
				'Restart policy updated successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to update restart policy: %s')
				.format(err.message)), 'error');
		});
	},

	/**
	 * Handle network connect
	 * @param {string} networkName - Network name
	 * @param {string} ip - Optional IP address
	 */
	handleNetworkConnect: function(networkName, ip) {
		pui.showSpinningModal(_('Connecting to Network'), _(
		'Connecting container to network...'));

		// Build params according to Podman API NetworkConnectOptions schema
		const params = { container: this.containerId };
		if (ip) {
			params.static_ips = [ip]; // static_ips is an array
		}

		podmanRPC.network.connect(networkName, JSON.stringify(params)).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to connect to network: %s')
					.format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Connected to network successfully')));
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to connect to network: %s').format(
				err.message)), 'error');
		});
	},

	/**
	 * Handle network disconnect
	 * @param {string} networkName - Network name
	 */
	handleNetworkDisconnect: function(networkName) {
		if (!confirm(_('Disconnect from network %s?').format(networkName)))
			return;

		pui.showSpinningModal(_('Disconnecting from Network'), _(
			'Disconnecting container from network...'));

		// Build params according to Podman API DisconnectOptions schema (capital C for Container)
		podmanRPC.network.disconnect(networkName, JSON.stringify({ Container: this.containerId }))
			.then((result) => {
				ui.hideModal();
				if (result && result.error) {
					ui.addNotification(null, E('p', _('Failed to disconnect from network: %s')
						.format(result.error)), 'error');
				} else {
					ui.addNotification(null, E('p', _(
						'Disconnected from network successfully')));
					window.location.reload();
				}
			}).catch((err) => {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed to disconnect from network: %s')
					.format(err.message)), 'error');
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
		const memory = utils.parseMemory(memoryStr, true);
		const memorySwap = memorySwapStr === '-1' ? -1 : utils.parseMemory(memorySwapStr, true);

		// Validate
		if (memory === null && memoryStr) {
			ui.addNotification(null, E('p', _('Invalid memory format. Use: 512m, 1g, etc.')),
				'error');
			return;
		}
		if (memorySwap === null && memorySwapStr && memorySwapStr !== '-1') {
			ui.addNotification(null, E('p', _(
				'Invalid memory swap format. Use: 512m, 1g, -1, etc.')), 'error');
			return;
		}

		// Build update data according to UpdateEntities schema
		const updateData = {};

		// CPU configuration - always include to allow resetting limits
		updateData.cpu = {};

		// CPU Limit: Convert CPUs to quota (quota = CPUs * period)
		// 0 or empty = unlimited (removes limit)
		if (cpuLimit) {
			const period = 100000; // Default period in microseconds
			updateData.cpu.quota = Math.floor(parseFloat(cpuLimit) * period);
			updateData.cpu.period = period;
		} else {
			// Send 0 to remove CPU limit
			updateData.cpu.quota = 0;
			updateData.cpu.period = 0;
		}

		// CPU Shares - 0 = use default
		updateData.cpu.shares = parseInt(cpuShares) || 0;

		// Memory configuration - always include to allow resetting limits
		updateData.memory = {};

		// Memory limit - 0 = unlimited (removes limit)
		updateData.memory.limit = memory > 0 ? memory : 0;

		// Memory swap - 0 = default, -1 = unlimited swap
		if (memorySwap !== 0) {
			updateData.memory.swap = memorySwap;
		} else {
			updateData.memory.swap = 0;
		}

		// Block IO configuration - 0 = use default
		updateData.blockIO = {
			weight: parseInt(blkioWeight) || 0
		};

		pui.showSpinningModal(_('Updating Resources'), _('Updating container resources...'));

		// Call update RPC with body data
		podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then((
		result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to update resources: %s')
					.format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Resources updated successfully')));
				// Store current tab before reload
				session.setLocalData('podman_active_tab', 'resources');
				window.location.reload();
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to update resources: %s').format(err
				.message)), 'error');
		});
	},

	/**
	 * Handle container start action
	 * @param {string} id - Container ID
	 */
	handleStart: function(id) {
		ContainerUtil.startContainers(id).then(() => {
			// reload page only for now
			window.location.reload();
		});
	},

	/**
	 * Handle container stop action
	 * @param {string} id - Container ID
	 */
	handleStop: function(id) {
		ContainerUtil.stopContainers(id).then(() => {
			// reload page only for now
			window.location.reload();
		});
	},

	/**
	 * Handle container restart action
	 * @param {string} id - Container ID
	 */
	handleRestart: function(id) {
		ContainerUtil.restartContainers(id).then(() => {
			// reload page only for now
			window.location.reload();
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

		pui.showSpinningModal(_('Removing Container'), _('Removing container...'));

		podmanRPC.container.remove(id, true).then((result) => {
			ui.hideModal();
			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to remove container: %s')
					.format(result.error)), 'error');
			} else {
				ui.addNotification(null, E('p', _('Container removed successfully')));
				window.location.href = L.url('admin/podman/containers');
			}
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to remove container: %s').format(err
				.message)), 'error');
		});
	},

	/**
	 * Handle manual health check execution
	 */
	handleHealthCheck: function() {
		pui.showSpinningModal(_('Running Health Check'), _('Executing health check...'));

		podmanRPC.container.healthcheck(this.containerId).then((result) => {
			ui.hideModal();

			if (result && result.error) {
				ui.addNotification(null, E('p', _('Health check failed: %s').format(result
					.error)), 'error');
				return;
			}

			// Check health check result
			const status = result.Status || 'unknown';
			const failingStreak = result.FailingStreak || 0;

			// Show result notification
			if (status === 'healthy') {
				pui.successTimeNotification(_('Health check passed'));
			} else if (status === 'unhealthy') {
				pui.warningNotification(_('Health check failed (%d consecutive failures)')
					.format(failingStreak));
			} else {
				pui.infoNotification(_('Health check status: %s').format(status));
			}

			// Re-fetch container data and update health tab
			podmanRPC.container.inspect(this.containerId).then((containerData) => {
				this.containerData = containerData;
				this.renderHealthTab();
			}).catch((err) => {
				console.error('Failed to refresh container data:', err);
			});
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to run health check: %s').format(err
				.message)), 'error');
		});
	}
});
