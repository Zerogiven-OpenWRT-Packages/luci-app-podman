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
'require podman.form as pform';
'require podman.format as format';
'require podman.openwrt-network as openwrtNetwork';

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
				error: err.message || _('Failed to load container data')
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
			ui.addTimeLimitedNotification(null, E('p', data.error || _('Container not found')),
				5000, 'warning');
			window.location.href = L.url('admin/podman/containers');
			return E('div', {}, _('Redirecting to containers list...'));
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

		const header = E('div', {
			'style': 'margin-bottom: 20px;'
		}, [
			E('h2', {}, [
				_('Container: %s').format(name),
				' ',
				E('span', {
					'class': 'badge status-' + status.toLowerCase(),
					'style': 'font-size: 14px; vertical-align: middle;'
				}, status)
			]),
			E('div', {
				'style': 'margin-top: 10px;'
			}, [
				this.createActionButtons(this.containerId, name, status === 'running')
			])
		]);

		// Check if we should restore a specific tab
		const savedTab = session.getLocalData('podman_active_tab');
		if (savedTab) {
			session.setLocalData('podman_active_tab', null);
		}

		// Build tabs using pui.Tabs helper
		const tabs = new pui.Tabs(savedTab || 'info');
		tabs
			.addTab('info', _('Info'), 'tab-info-content')
			.addTab('resources', _('Resources'), 'tab-resources-content')
			.addTab('stats', _('Stats'), E('div', {
				'id': 'tab-stats-content'
			}, [
				E('p', {}, _('Loading stats...'))
			]))
			.addTab('logs', _('Logs'), E('div', {
				'id': 'tab-logs-content'
			}, [
				E('p', {}, _('Loading logs...'))
			]))
			.addTab('health', _('Health'), E('div', {
				'id': 'tab-health-content'
			}, [
				E('p', {}, _('Loading health check data...'))
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
	 * Render Info tab with container details and configuration
	 */
	renderInfoTab: async function () {
		const container = document.getElementById('tab-info-content');
		if (!container) return;

		const data = this.containerData;
		const config = data.Config || {};
		const hostConfig = data.HostConfig || {};
		const networkSettings = data.NetworkSettings || {};

		// Build info sections
		const sections = [];
		const status = data.State ? data.State.Status : 'unknown';

		// Basic Information - using pui.Table
		const basicTable = new pui.Table();

		// Name (editable)
		const inputId = 'edit-name';
		basicTable.addRow([{
				inner: _('Name'),
				options: {
					'style': 'width: 33%; font-weight: bold;'
				}
			},
			{
				inner: [
					E('input', {
						'type': 'text',
						'id': inputId,
						'class': 'cbi-input-text',
						'value': data.Name ? data.Name.replace(/^\//, '') : '-',
						'style': 'width: 60%; margin-right: 5px;'
					}),
					new pui.Button(_('Update'), () => this.handleUpdateName(document
						.getElementById(inputId).value), 'apply').render()
				]
			}
		]);

		// Standard info rows
		basicTable
			.addRow([{
					inner: _('ID'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: data.Id ? data.Id.substring(0, 64) : '-'
				}
			])
			.addRow([{
					inner: _('Image'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: config.Image || '-'
				}
			])
			.addRow([{
					inner: _('Status'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: data.State ? data.State.Status : '-'
				}
			])
			.addRow([{
					inner: _('Created'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: data.Created ? format.date(data.Created) : '-'
				}
			])
			.addRow([{
					inner: _('Started'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: data.State && data.State.StartedAt ? format.date(data.State
						.StartedAt) : '-'
				}
			]);

		// Restart policy (editable)
		const selectId = 'edit-restart-policy';
		const policies = {
			'no': _('No'),
			'always': _('Always'),
			'on-failure': _('On Failure'),
			'unless-stopped': _('Unless Stopped')
		};
		const currentPolicy = hostConfig.RestartPolicy ? hostConfig.RestartPolicy.Name || 'no' :
			'no';
		const policyOptions = Object.keys(policies).map((key) => {
			return E('option', {
				'value': key,
				'selected': key === currentPolicy ? 'selected' : null
			}, policies[key]);
		});

		basicTable.addRow([{
				inner: _('Restart Policy'),
				options: {
					'style': 'width: 33%; font-weight: bold;'
				}
			},
			{
				inner: [
					E('select', {
						'id': selectId,
						'class': 'cbi-input-select',
						'style': 'width: 60%; margin-right: 5px;'
					}, policyOptions),
					new pui.Button(_('Update'), () => this.handleUpdateRestartPolicy(
						document.getElementById(selectId).value), 'apply').render()
				]
			}
		]);

		// Auto-update status
		const autoUpdateLabel = config.Labels && config.Labels['io.containers.autoupdate'];
		basicTable.addRow([{
				inner: _('Auto-Update'),
				options: {
					'style': 'width: 33%; font-weight: bold;'
				}
			},
			{
				inner: autoUpdateLabel || _('Disabled')
			}
		]);

		// Init Script status (loaded asynchronously)
		const initScriptCell = E('span', {
			'style': 'color: #999;'
		}, '...');
		const containerName = data.Name ? data.Name.replace(/^\//, '') : null;

		// Check if container has a restart policy set
		const hasRestartPolicy = hostConfig.RestartPolicy &&
			hostConfig.RestartPolicy.Name &&
			hostConfig.RestartPolicy.Name !== '' &&
			hostConfig.RestartPolicy.Name !== 'no';

		if (containerName) {
			podmanRPC.initScript.status(containerName).then((status) => {
				const buttons = [];

				if (status.exists && status.enabled) {
					// Init script exists and enabled
					initScriptCell.innerHTML = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #5cb85c; margin-right: 10px;'
					}, '✓ ' + _('Enabled')));

					buttons.push(new pui.Button(_('Show'), () => this
						.handleShowInitScript(containerName), 'neutral').render());
					buttons.push(' ');
					buttons.push(new pui.Button(_('Disable'), () => this
							.handleToggleInitScript(containerName, false), 'negative')
						.render());
				} else if (status.exists && !status.enabled) {
					// Init script exists but disabled
					initScriptCell.innerHTML = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #999; margin-right: 10px;'
					}, '○ ' + _('Disabled')));

					buttons.push(new pui.Button(_('Show'), () => this
						.handleShowInitScript(containerName), 'neutral').render());
					buttons.push(' ');
					buttons.push(new pui.Button(_('Enable'), () => this
							.handleToggleInitScript(containerName, true), 'positive')
						.render());
				} else if (hasRestartPolicy) {
					// No init script but has restart policy - show warning with Generate button
					initScriptCell.innerHTML = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #f0ad4e; margin-right: 10px;',
						'title': _('Restart policy set but no init script')
					}, '⚠️ ' + _('Not configured')));

					buttons.push(new pui.Button(_('Generate'), () => this
							.handleGenerateInitScript(containerName), 'positive')
						.render());
				} else {
					// No init script and no restart policy - show helper text
					initScriptCell.innerHTML = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #999;',
						'title': _(
							'Set a restart policy to enable auto-start')
					}, '— ' + _('Not available (no restart policy)')));
				}

				buttons.forEach((btn) => {
					if (typeof btn === 'string') {
						initScriptCell.appendChild(document.createTextNode(btn));
					} else {
						initScriptCell.appendChild(btn);
					}
				});
			}).catch((err) => {
				initScriptCell.textContent = '✗ ' + _('Error');
				initScriptCell.style.color = '#d9534f';
				initScriptCell.title = err.message;
			});
		} else {
			initScriptCell.textContent = '—';
		}

		basicTable.addRow([{
				inner: _('Init Script'),
				options: {
					'style': 'width: 33%; font-weight: bold;'
				}
			},
			{
				inner: initScriptCell
			}
		]);

		// Health status if exists
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
				healthDetails.push(E('span', {
					'style': 'color: #ff6b6b;'
				}, _(' (%d consecutive failures)').format(failingStreak)));
			}

			// Add last check time if available
			if (lastCheck && lastCheck.End) {
				healthDetails.push(E('br'));
				healthDetails.push(E('small', {
					'style': 'color: #666;'
				}, _('Last check: %s').format(format.date(lastCheck.End))));
			}

			// Add manual health check button if container is running
			if (status === 'running') {
				healthDetails.push(' ');
				healthDetails.push(new pui.Button(_('Run Check'), () => this.handleHealthCheck(),
					'positive').render());
			}

			basicTable.addRow([{
					inner: _('Health'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: healthDetails,
					options: {
						'style': 'word-break: break-word;'
					}
				}
			]);
		}

		const basicSection = new pui.Section({
			'style': 'margin-bottom: 20px;'
		});
		basicSection.addNode(_('Basic Information'), '', basicTable.render());
		sections.push(basicSection.render());

		// Configuration - using pui.Table
		const cmd = config.Cmd ? config.Cmd.join(' ') : '-';
		const entrypoint = config.Entrypoint ? config.Entrypoint.join(' ') : '-';

		const configTable = new pui.Table();
		configTable
			.addRow([{
					inner: _('Command'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: cmd,
					options: {
						'style': 'word-break: break-word;'
					}
				}
			])
			.addRow([{
					inner: _('Entrypoint'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: entrypoint,
					options: {
						'style': 'word-break: break-word;'
					}
				}
			])
			.addRow([{
					inner: _('Working Directory'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: config.WorkingDir || '-'
				}
			])
			.addRow([{
					inner: _('User'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: config.User || '-'
				}
			])
			.addRow([{
					inner: _('Hostname'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: config.Hostname || '-'
				}
			])
			.addRow([{
					inner: _('Privileged'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: hostConfig.Privileged ? _('Yes') : _('No')
				}
			])
			.addRow([{
					inner: _('TTY'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: config.Tty ? _('Yes') : _('No')
				}
			])
			.addRow([{
					inner: _('Interactive'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: config.OpenStdin ? _('Yes') : _('No')
				}
			]);

		const configSection = new pui.Section({
			'style': 'margin-bottom: 20px;'
		});
		configSection.addNode(_('Configuration'), '', configTable.render());
		sections.push(configSection.render());

		// Network - using pui.Table
		const networkTable = new pui.Table();

		// Network mode
		networkTable.addInfoRow(_('Network Mode'), hostConfig.NetworkMode || 'default');

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
				const tooltip = (() => {
					const parts = [];
					if (net.IPAddress) parts.push(`IPv4: ${net.IPAddress}`);
					if (net.GlobalIPv6Address) parts.push(
						`IPv6: ${net.GlobalIPv6Address}`);
					else parts.push('IPv6: disabled');
					if (net.Gateway) parts.push(`Gateway: ${net.Gateway}`);
					if (net.MacAddress) parts.push(`MAC: ${net.MacAddress}`);
					if (net.NetworkID) parts.push(
						`Network ID: ${net.NetworkID.substring(0, 12)}`);
					return parts.join('\n');
				})();

				networkTable.addRow([{
						inner: netName,
						options: {
							'style': 'width: 33%; font-weight: bold; cursor: help;',
							'title': tooltip
						}
					},
					{
						inner: [
							net.IPAddress || '-',
							' ',
							E('span', {
								'style': 'margin-left: 10px;'
							}, [
								new pui.Button(_('Disconnect'), () => this
									.handleNetworkDisconnect(netName),
									'remove').render()
							])
						]
					}
				]);
			});
		}

		// Only show legacy IP Address row if no user networks are displayed
		// (avoids duplicate IP display when networks are shown with their IPs)
		if (networkSettings.IPAddress && userNetworks.length === 0) {
			networkTable.addInfoRow(_('IP Address'), networkSettings.IPAddress);
		}

		// Add connect to network option (inline instead of helper method)
		const networkSelectId = 'connect-network-select';
		const ipInputId = 'connect-network-ip';

		const networkOptions = [E('option', {
			'value': ''
		}, _('-- Select Network --'))];

		if (this.networksData && Array.isArray(this.networksData)) {
			this.networksData.forEach(function (net) {
				const name = net.Name || net.name;
				if (name && name !== 'none' && name !== 'host') {
					networkOptions.push(E('option', {
						'value': name
					}, name));
				}
			});
		}

		networkTable.addRow([{
				inner: _('Connect to'),
				options: {
					'style': 'width: 33%; font-weight: bold;'
				}
			},
			{
				inner: [
					E('select', {
						'id': networkSelectId,
						'class': 'cbi-input-select',
						'style': 'width: 40%; margin-right: 5px;'
					}, networkOptions),
					E('input', {
						'type': 'text',
						'id': ipInputId,
						'class': 'cbi-input-text',
						'placeholder': _('IP (optional)'),
						'style': 'width: 30%; margin-right: 5px;'
					}),
					new pui.Button(_('Connect'), () => {
						const netName = document.getElementById(networkSelectId)
							.value;
						const ip = document.getElementById(ipInputId).value;
						if (netName) {
							this.handleNetworkConnect(netName, ip);
						}
					}, 'positive').render()
				]
			}
		]);

		// Ports - smart detection based on network type
		// For OpenWrt-integrated networks: show container IP + exposed ports
		// For standard networks: show host IP + port mappings
		await this.renderPorts(networkTable, config, hostConfig, networkSettings);

		// Links - display as single row with line breaks
		const links = [];
		if (hostConfig.Links && hostConfig.Links.length > 0) {
			hostConfig.Links.forEach(function (link) {
				links.push(link);
			});
		}

		if (links.length > 0) {
			networkTable.addInfoRow(_('Links'), links.join('<br>'));
		}

		// Render Network section using pui.Section
		const networkSection = new pui.Section({
			'style': 'margin-bottom: 20px;'
		});
		networkSection.addNode(_('Network'), '', networkTable.render());
		sections.push(networkSection.render());

		// Environment Variables
		if (config.Env && config.Env.length > 0) {
			const envTable = new pui.Table();
			envTable
				.addHeader(_('Variable'))
				.addHeader(_('Value'));

			// const envRows = config.Env.map(function (env) {
			config.Env.forEach(function (env) {
				const parts = env.split('=');
				const varName = parts[0];
				const varValue = parts.slice(1).join('=');

				// Create censored value display (bullet points)
				const censoredValue = '••••••••';

				envTable.addRow([{
						inner: varName,
						options: {
							'style': 'font-family: monospace; word-break: break-all;'
						}
					},
					{
						inner: censoredValue,
						options: {
							'style': 'font-family: monospace; word-break: break-all; cursor: pointer; user-select: none;',
							'title': _('Click to reveal/hide value'),
							'data-revealed': 'false',
							'data-value': varValue,
							'click': function () {
								const isRevealed = this.getAttribute(
									'data-revealed') === 'true';
								if (isRevealed) {
									// Hide value
									this.textContent = censoredValue;
									this.setAttribute('data-revealed',
										'false');

									return;
								}

								// Reveal value
								this.textContent = this.getAttribute(
									'data-value');
								this.setAttribute('data-revealed', 'true');
							}
						}
					},
				]);
			});

			const envSection = new pui.Section({
				'style': 'margin-bottom: 20px;'
			});
			envSection.addNode(_('Environment Variables'), '', envTable.render());

			sections.push(envSection.render());
		}

		if (data.Mounts && data.Mounts.length > 0) {
			const mountsTable = new pui.Table();
			mountsTable
				.addHeader(_('Type'))
				.addHeader(_('Source'))
				.addHeader(_('Destination'))
				.addHeader(_('Mode'));

			data.Mounts.forEach(function (mount) {
				mountsTable.addRow([{
						inner: mount.Type || '-'
					},
					{
						inner: utils.truncate(mount.Source || '-', 50),
						options: {
							'title': mount.Source || '-'
						}
					},
					{
						inner: utils.truncate(mount.Destination || '-', 50),
						options: {
							'title': mount.Destination || '-'
						}
					},
					{
						inner: mount.RW ? 'rw' : 'ro'
					}
				]);
			});

			const mountsSection = new pui.Section({
				'style': 'margin-bottom: 20px;'
			});
			mountsSection.addNode(_('Mounts'), '', mountsTable.render());
			sections.push(mountsSection.render());
		}

		// Append all sections
		sections.forEach(function (section) {
			container.appendChild(section);
		});
	},

	/**
	 * Render Resources tab with CPU, memory, and I/O limit configuration
	 */
	renderResourcesTab: function () {
		const container = document.getElementById('tab-resources-content');
		if (!container) return;

		// Use FormResourceEditor from form.js instead of manual form building
		const editor = new pform.ResourceEditor();
		editor.render(this.containerId, this.containerData).then((renderedForm) => {
			// Add description above the form
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
		const container = document.getElementById('tab-stats-content');
		if (!container) return;

		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		const statsTable = new pui.Table();
		statsTable
			.addRow([{
					inner: _('CPU Usage'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-cpu'
					}
				}
			])
			.addRow([{
					inner: _('Memory Usage'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-memory'
					}
				}
			])
			.addRow([{
					inner: _('Memory Limit'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-memory-limit'
					}
				}
			])
			.addRow([{
					inner: _('Memory %'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-memory-percent'
					}
				}
			])
			.addRow([{
					inner: _('Network I/O'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-network'
					}
				}
			])
			.addRow([{
					inner: _('Block I/O'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-blockio'
					}
				}
			])
			.addRow([{
					inner: _('PIDs'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: '-',
					options: {
						'id': 'stat-pids'
					}
				}
			]);

		const statsSection = new pui.Section();
		statsSection.addNode(_('Resource Usage'), '', statsTable.render());

		const statsDisplay = statsSection.render();

		const processSection = new pui.Section({
			'style': 'margin-top: 20px;'
		});
		processSection.addNode(_('Running Processes'), '', E('div', {
			'id': 'process-list-container'
		}, [
			E('p', {}, _('Loading process list...'))
		]));

		container.appendChild(statsDisplay);
		container.appendChild(processSection.render());

		// Only poll stats/processes if container is running
		const isRunning = this.containerData.State && this.containerData.State.Running;

		if (isRunning) {
			this.updateStats();
			this.updateProcessList();

			const view = this;
			this.statsPollFn = function () {
				return Promise.all([
					view.updateStats(),
					view.updateProcessList()
				]).catch((err) => {
					console.error('Stats/Process poll error:', err);
				});
			};

			poll.add(this.statsPollFn, 3);
		} else {
			// Show message that container is not running
			const cpuEl = document.getElementById('stat-cpu');
			const memEl = document.getElementById('stat-memory');
			const memLimitEl = document.getElementById('stat-memory-limit');
			const memPercentEl = document.getElementById('stat-memory-percent');
			const netEl = document.getElementById('stat-network');
			const blockEl = document.getElementById('stat-blockio');
			const pidsEl = document.getElementById('stat-pids');

			if (cpuEl) cpuEl.textContent = _('Container not running');
			if (memEl) memEl.textContent = '-';
			if (memLimitEl) memLimitEl.textContent = '-';
			if (memPercentEl) memPercentEl.textContent = '-';
			if (netEl) netEl.textContent = '-';
			if (blockEl) blockEl.textContent = '-';
			if (pidsEl) pidsEl.textContent = '-';

			const processContainer = document.getElementById('process-list-container');
			if (processContainer) {
				processContainer.innerHTML = '';
				processContainer.appendChild(E('p', {
						'style': 'color: #999;'
					},
					_('Container must be running to view processes')));
			}
		}
	},

	/**
	 * Update stats display with current resource usage
	 */
	updateStats: function () {
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
				(stats.memory_stats && stats.memory_stats.usage ? format.bytes(stats
					.memory_stats.usage) : '-');
			const memEl = document.getElementById('stat-memory');
			if (memEl) memEl.textContent = memUsage;

			// Memory Limit - try different field names
			const memLimit = stats.MemLimit || stats.mem_limit ||
				(stats.memory_stats && stats.memory_stats.limit ? format.bytes(stats
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
			if (netEl) netEl.textContent = format.networkIO(netIO);

			// Block I/O - format nicely
			const blockIO = stats.BlockIO || stats.block_io || stats.blkio || stats
				.blkio_stats;
			const blockEl = document.getElementById('stat-blockio');
			if (blockEl) blockEl.textContent = format.blockIO(blockIO);

			// PIDs - format nicely
			const pids = stats.PIDs || stats.pids || stats.pids_stats;
			const pidsEl = document.getElementById('stat-pids');
			if (pidsEl) pidsEl.textContent = format.pids(pids);

		}).catch((err) => {
			console.error('Stats error:', err);
			// Stats failed to load - show error only in console
		});
	},

	/**
	 * Update process list with running processes
	 */
	updateProcessList: function () {
		return podmanRPC.container.top(this.containerId, '').then((result) => {
			const container = document.getElementById('process-list-container');
			if (!container) return;

			while (container.firstChild) {
				container.removeChild(container.firstChild);
			}

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

			const processTable = new pui.Table({
				'style': 'font-size: 11px; width: 100%;'
			});

			titles.forEach((title) => {
				processTable.addHeader(title, {
					'style': 'font-family: monospace; white-space: nowrap;'
				});
			});


			processes.forEach((proc) => {
				const cells = proc.map((cell, index) => {
					let style =
						'font-family: monospace; font-size: 11px; padding: 4px 8px;';
					let displayValue = cell || '-';

					if (titles[index] === 'PID' || titles[index] ===
						'PPID' || titles[index] === '%CPU') {
						style += ' text-align: right;';
					} else if (titles[index] === 'ELAPSED') {
						displayValue = format.elapsedTime(cell);
					} else if (titles[index] === 'COMMAND') {
						style +=
							' max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
					}

					return {
						inner: displayValue,
						options: {
							'style': style,
							'title': cell || '-'
						}
					};
				});

				processTable.addRow(cells);
			});

			container.appendChild(processTable.render());

		}).catch((err) => {
			console.error('Process list error:', err);
			const container = document.getElementById('process-list-container');
			if (container) {
				while (container.firstChild) {
					container.removeChild(container.firstChild);
				}
				container.appendChild(E('p', {
						'style': 'color: #999;'
					},
					_('Failed to load process list: %s').format(err.message || _(
						'Unknown error'))));
			}
		});
	},

	/**
	 * Render Logs tab with streaming and non-streaming log viewer
	 */
	renderLogsTab: function () {
		const container = document.getElementById('tab-logs-content');
		if (!container) return;

		// Clear existing content
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		// Create logs display
		const logsDisplay = E('div', {
			'class': 'cbi-section'
		}, [
			E('div', {
				'class': 'cbi-section-node'
			}, [
				// Controls
				E('div', {
					'style': 'margin-bottom: 10px;'
				}, [
					E('label', {
						'style': 'margin-right: 15px;'
					}, [
						E('input', {
							'type': 'checkbox',
							'id': 'log-stream-toggle',
							'style': 'margin-right: 5px;',
							'change': (ev) => this.toggleLogStream(ev)
						}),
						_('Live Stream')
					]),
					E('label', {
						'style': 'margin-right: 15px;'
					}, [
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
	stripDockerStreamHeaders: function (text) {
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
	stripAnsi: function (text) {
		if (!text) return text;
		// Remove ANSI escape sequences (colors, cursor movement, etc.)
		// eslint-disable-line no-control-regex
		return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g,
			'');
	},

	/**
	 * Refresh logs manually (non-streaming, fetch last N lines)
	 */
	refreshLogs: function () {
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
	clearLogs: function () {
		const output = document.getElementById('logs-output');
		if (output) {
			output.textContent = '';
		}
	},

	/**
	 * Toggle log streaming on/off
	 * @param {Event} ev - Change event from checkbox
	 */
	toggleLogStream: function (ev) {
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
	 * Start log streaming session with backend
	 */
	startLogStream: function () {
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
	 * Stop log streaming and cleanup backend resources
	 */
	stopLogStream: function () {
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
	 * Poll log stream status and append new log data using byte offset tracking
	 */
	pollLogsStatus: function () {
		const outputEl = document.getElementById('logs-output');
		const view = this;

		// Define poll function and store reference for later removal
		this.logPollFn = function () {
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
	 * Render Health tab with health check status, history, and configuration (read-only)
	 */
	renderHealthTab: function () {
		const container = document.getElementById('tab-health-content');
		if (!container) return;

		// Clear existing content
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		const data = this.containerData;
		const health = data.State && data.State.Health;
		const healthConfig = data.Config && data.Config.Healthcheck;

		// Build health check information sections
		const sections = [];

		// Health Check Configuration Section (read-only)
		if (healthConfig && healthConfig.Test && healthConfig.Test.length > 0) {
			const configTable = new pui.Table();

			const testCmd = healthConfig.Test.join(' ');
			configTable.addInfoRow(_('Test Command'), E('code', {
				'style': 'font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 3px;'
			}, testCmd));

			if (healthConfig.Interval) {
				configTable.addInfoRow(_('Interval'), format.duration(healthConfig.Interval));
			}

			if (healthConfig.Timeout) {
				configTable.addInfoRow(_('Timeout'), format.duration(healthConfig.Timeout));
			}

			if (healthConfig.StartPeriod) {
				configTable.addInfoRow(_('Start Period'), format.duration(healthConfig
					.StartPeriod));
			}

			if (healthConfig.Retries) {
				configTable.addInfoRow(_('Retries'), String(healthConfig.Retries));
			}

			const configSection = new pui.Section({
				'style': 'margin-bottom: 20px;'
			});
			configSection.addNode(_('Health Check Configuration'),
				E('div', {
						'style': 'font-size: 0.9em; color: #666; margin-top: 5px;'
					},
					_(
						'Health check configuration is set at container creation and cannot be modified. To change it, you must recreate the container.')
					),
				configTable.render());
			sections.push(configSection.render());
		} else {
			// No health check configured
			const noHealthSection = new pui.Section({
				'style': 'margin-bottom: 20px;'
			});
			noHealthSection.addNode(_('Health Check Configuration'),
				_(
					'No health check configured. To add a health check, you must recreate the container with health check parameters.'),
				E('div'));
			sections.push(noHealthSection.render());
		}

		// Current Status Section (only if health check exists)
		if (health) {
			const status = health.Status || 'none';
			const failingStreak = health.FailingStreak || 0;

			const statusTable = new pui.Table();
			statusTable.addRow([{
					inner: _('Status'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: E('span', {
						'class': 'badge status-' + status.toLowerCase(),
						'style': 'font-size: 16px;'
					}, status)
				}
			]);

			statusTable.addRow([{
					inner: _('Failing Streak'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: failingStreak > 0 ? _('%d consecutive failures').format(
						failingStreak) : _('No failures'),
					options: {
						'style': failingStreak > 0 ?
							'color: #ff6b6b; font-weight: bold;' : ''
					}
				}
			]);

			const statusSection = new pui.Section({
				'style': 'margin-bottom: 20px;'
			});
			statusSection.addNode(_('Health Status'), '', statusTable.render());
			sections.push(statusSection.render());
		}

		// History Section (only if health check exists and has log)
		if (health && health.Log && health.Log.length > 0) {
			const log = health.Log;
			const historyTable = new pui.Table();
			historyTable
				.addHeader(_('Started'))
				.addHeader(_('Ended'))
				.addHeader(_('Result'))
				.addHeader(_('Output'));

			log.slice(-10).reverse().forEach((entry) => {
				const exitCode = entry.ExitCode !== undefined ? entry.ExitCode : '-';
				const exitStatus = exitCode === 0 ? _('Success') : _('Failed');
				const exitClass = exitCode === 0 ? 'status-healthy' : 'status-unhealthy';
				const outputText = entry.Output ? entry.Output.trim() : '-';

				// Create span with textContent to properly escape HTML
				const outputSpan = E('span', {});
				outputSpan.textContent = outputText;

				const resultBadge = E('span', {}, [
					E('span', {
						'class': 'badge ' + exitClass
					}, exitStatus),
					' ',
					E('small', {}, '(Exit: ' + exitCode + ')')
				]);

				historyTable.addRow([{
						inner: entry.Start ? format.date(entry.Start) : '-'
					},
					{
						inner: entry.End ? format.date(entry.End) : '-'
					},
					{
						inner: resultBadge
					},
					{
						inner: outputSpan,
						options: {
							'style': 'font-family: monospace; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
							'title': outputText
						}
					}
				]);
			});

			const historySection = new pui.Section({
				'style': 'margin-bottom: 20px;'
			});
			historySection.addNode(_('Recent Checks (Last 10)'), '', historyTable.render());
			sections.push(historySection.render());
		}

		// Append all sections
		sections.forEach((section) => {
			container.appendChild(section);
		});

		// Add manual health check button (only if health check is configured)
		if (health) {
			container.appendChild(E('div', {
				'style': 'margin-top: 20px;'
			}, [
				new pui.Button(_('Run Health Check Now'), () => this
					.handleHealthCheck(),
					'positive').render()
			]));
		}
	},

	/**
	 * Render Inspect tab with full JSON container data
	 */
	renderInspectTab: function () {
		const container = document.getElementById('tab-inspect-content');
		if (!container) return;

		const data = this.containerData;

		const jsonSection = new pui.Section();
		jsonSection.addNode(
			'',
			_(
				'Full container inspect data in JSON format. This is the raw data returned from the Podman API.'),
			E('pre', {
				'style': 'background: #f5f5f5; padding: 15px; overflow: auto; max-height: 800px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 12px; line-height: 1.5;'
			}, JSON.stringify(data, null, 2))
		);

		container.appendChild(jsonSection.render());
	},

	/**
	 * Handle name update
	 * @param {string} newName - New container name
	 */
	handleUpdateName: function (newName) {
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
	 * Handle restart policy update with init script auto-sync
	 * @param {string} policy - New restart policy
	 */
	handleUpdateRestartPolicy: function (policy) {
		pui.showSpinningModal(_('Updating Container'), _('Updating restart policy...'));

		const containerName = this.containerData.Name ? this.containerData.Name.replace(/^\//,
			'') : null;
		const hasRestartPolicy = policy && policy !== '' && policy !== 'no';

		// Podman libpod API uses query parameters for restart policy
		const updateData = {
			RestartPolicy: policy
		};

		// Only add RestartRetries if policy is on-failure
		if (policy === 'on-failure') {
			updateData.RestartRetries = 5;
		}

		// Step 1: Update restart policy
		podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then((
			result) => {
			if (result && result.error) {
				throw new Error(result.error);
			}

			// Step 2: Auto-sync init script based on restart policy
			if (!containerName) {
				// No container name, skip init script sync
				return Promise.resolve();
			}

			// Check current init script status
			return podmanRPC.initScript.status(containerName).then((status) => {
				if (hasRestartPolicy && !status.exists) {
					// Restart policy set but no init script → Generate and enable
					return podmanRPC.initScript.generate(containerName)
						.then((genResult) => {
							if (genResult && genResult.success) {
								return podmanRPC.initScript.setEnabled(
									containerName, true);
							}
							// Generation failed, but policy update succeeded - just log warning
							console.warn(
								'Failed to auto-generate init script:',
								genResult.error);
							return Promise.resolve();
						})
						.catch((err) => {
							// Auto-generation failed, but policy update succeeded - just log warning
							console.warn(
								'Failed to auto-generate init script:',
								err.message);
							return Promise.resolve();
						});
				} else if (!hasRestartPolicy && status.exists) {
					// Restart policy removed and init script exists → Remove it
					return podmanRPC.initScript.remove(containerName)
						.catch((err) => {
							// Auto-removal failed, but policy update succeeded - just log warning
							console.warn('Failed to auto-remove init script:',
								err.message);
							return Promise.resolve();
						});
				}

				// No action needed
				return Promise.resolve();
			});
		}).then(() => {
			ui.hideModal();
			pui.successTimeNotification(_('Restart policy updated successfully'));
			window.location.reload();
		}).catch((err) => {
			ui.hideModal();
			pui.errorNotification(_('Failed to update restart policy: %s')
				.format(err.message));
		});
	},

	/**
	 * Handle network connect
	 * @param {string} networkName - Network name
	 * @param {string} ip - Optional IP address
	 */
	handleNetworkConnect: function (networkName, ip) {
		pui.showSpinningModal(_('Connecting to Network'), _(
			'Connecting container to network...'));

		// Build params according to Podman API NetworkConnectOptions schema
		const params = {
			container: this.containerId
		};
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
	handleNetworkDisconnect: function (networkName) {
		if (!confirm(_('Disconnect from network %s?').format(networkName)))
			return;

		pui.showSpinningModal(_('Disconnecting from Network'), _(
			'Disconnecting container from network...'));

		// Build params according to Podman API DisconnectOptions schema (capital C for Container)
		podmanRPC.network.disconnect(networkName, JSON.stringify({
				Container: this.containerId
			}))
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
	 * Render ports with smart detection based on network type
	 * @param {Object} networkTable - Table to add port row to
	 * @param {Object} config - Container config
	 * @param {Object} hostConfig - Container host config
	 * @param {Object} networkSettings - Container network settings
	 */
	renderPorts: async function (networkTable, config, hostConfig, networkSettings) {
		const portElements = [];

		// Get primary network name and check for OpenWrt integration
		const networks = networkSettings.Networks || {};
		const networkNames = Object.keys(networks);
		const primaryNetwork = networkNames.length > 0 ? networkNames[0] : null;

		let useContainerIp = false;
		let containerIp = null;

		if (primaryNetwork) {
			// Check if network has OpenWrt integration
			const hasIntegration = await openwrtNetwork.hasIntegration(primaryNetwork).catch(() =>
				false);

			if (hasIntegration) {
				useContainerIp = true;
				containerIp = networks[primaryNetwork].IPAddress;
			}
		}

		// Extract all ports (both mapped and exposed) from NetworkSettings.Ports
		const extractedPorts = utils.extractPorts(networkSettings.Ports);

		if (useContainerIp && containerIp) {
			// OpenWrt-integrated network: Show container IP + port
			extractedPorts.forEach((port) => {
				const isTcp = port.protocol === 'tcp';
				const urlProtocol = port.containerPort === '443' ? 'https' : 'http';

				if (isTcp) {
					const url = `${urlProtocol}://${containerIp}:${port.containerPort}`;
					const linkText = `${containerIp}:${port.containerPort}`;
					portElements.push(E('a', {
						href: url,
						target: '_blank',
						style: 'text-decoration: underline; color: #0066cc;',
						title: _(
							'Direct access to container on OpenWrt-integrated network'
							)
					}, linkText));
				} else {
					portElements.push(E('span', {},
						`${containerIp}:${port.containerPort}/${port.protocol}`));
				}
			});
		} else {
			// Standard network: Show port mappings for mapped, just port for exposed
			extractedPorts.forEach((port) => {
				if (port.isMapped) {
					// Mapped port with host binding
					const hostIp = port.hostIp || '0.0.0.0';
					const linkIp = (hostIp === '0.0.0.0' || hostIp === '::') ?
						window.location.hostname :
						hostIp;
					const urlProtocol = port.hostPort === '443' ? 'https' : 'http';
					const isTcp = port.protocol === 'tcp';

					if (isTcp) {
						const url = `${urlProtocol}://${linkIp}:${port.hostPort}`;
						const linkText =
							`${hostIp}:${port.hostPort} → ${port.containerPort}/${port.protocol}`;
						portElements.push(E('a', {
							href: url,
							target: '_blank',
							style: 'text-decoration: underline; color: #0066cc;',
							title: _('Access via host port mapping')
						}, linkText));
					} else {
						portElements.push(E('span', {},
							`${hostIp}:${port.hostPort} → ${port.containerPort}/${port.protocol}`
							));
					}
				} else {
					// Exposed port without host mapping
					portElements.push(E('span', {
						style: 'color: #666;'
					}, `${port.containerPort}/${port.protocol} (exposed)`));
				}
			});
		}

		if (portElements.length > 0) {
			const portsContainer = E('div', {});
			portElements.forEach((portEl, idx) => {
				if (idx > 0) {
					portsContainer.appendChild(E('br'));
				}
				portsContainer.appendChild(portEl);
			});

			// Label based on network type
			const label = useContainerIp ? _('Exposed Ports') : _('Port Mappings');
			networkTable.addInfoRow(label, portsContainer);
		}
	},

	/**
	 * Handle container start action
	 * @param {string} id - Container ID
	 */
	handleStart: function (id) {
		ContainerUtil.startContainers(id).then(() => {
			// reload page only for now
			window.location.reload();
		});
	},

	/**
	 * Handle container stop action
	 * @param {string} id - Container ID
	 */
	handleStop: function (id) {
		ContainerUtil.stopContainers(id).then(() => {
			// reload page only for now
			window.location.reload();
		});
	},

	/**
	 * Handle container restart action
	 * @param {string} id - Container ID
	 */
	handleRestart: function (id) {
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
	handleRemove: function (id, name) {
		if (!confirm(_('Are you sure you want to remove container %s?').format(name)))
			return;

		ContainerUtil.removeContainers(id).then(() => {
			window.location.href = L.url('admin/podman/containers');
		});
	},

	/**
	 * Handle manual health check execution
	 */
	handleHealthCheck: function () {
		ContainerUtil.healthCheckContainers(this.containerId).then(() => {
			// Re-fetch container data and update health tab
			podmanRPC.container.inspect(this.containerId).then((containerData) => {
				this.containerData = containerData;
				this.renderHealthTab();
			}).catch((err) => {
				console.error('Failed to refresh container data:', err);
			});
		});
	},

	/**
	 * Handle generate init script for container
	 * @param {string} containerName - Container name
	 */
	handleGenerateInitScript: function (containerName) {
		pui.showSpinningModal(_('Generating Init Script'),
			_('Creating auto-start configuration for %s').format(containerName));

		podmanRPC.initScript.generate(containerName).then((result) => {
			if (result && result.success) {
				return podmanRPC.initScript.setEnabled(containerName, true);
			} else {
				throw new Error(result.error || _('Failed to generate init script'));
			}
		}).then((result) => {
			ui.hideModal();
			if (result && result.success) {
				pui.successTimeNotification(
					_('Init script created and enabled for %s').format(containerName));
				// Refresh the info tab to show updated status
				this.renderInfoTab();
			} else {
				throw new Error(result.error || _('Failed to enable init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			pui.errorNotification(
				_('Failed to setup auto-start: %s').format(err.message));
		});
	},

	/**
	 * Handle show init script content
	 * @param {string} containerName - Container name
	 */
	handleShowInitScript: function (containerName) {
		pui.showSpinningModal(_('Loading Init Script'),
			_('Fetching script for %s').format(containerName));

		podmanRPC.initScript.show(containerName).then((result) => {
			ui.hideModal();
			if (result && result.content) {
				// Show script content in a modal
				const content = E('div', {}, [
					E('h3', {}, _('Init Script: %s').format(containerName)),
					E('pre', {
						'style': 'background: #f5f5f5; padding: 15px; overflow: auto; max-height: 600px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 12px; line-height: 1.5;'
					}, result.content.replace(/\\n/g, '\n'))
				]);

				ui.showModal(_('Init Script'), [
					content,
					E('div', {
						'class': 'right',
						'style': 'margin-top: 15px;'
					}, [
						new pui.Button(_('Close'), ui.hideModal, 'neutral')
						.render()
					])
				]);
			} else {
				throw new Error(result.error || _('Failed to load init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			pui.errorNotification(_('Failed to load init script: %s').format(err
			.message));
		});
	},

	/**
	 * Handle enable/disable init script
	 * @param {string} containerName - Container name
	 * @param {boolean} enabled - Enable or disable
	 */
	handleToggleInitScript: function (containerName, enabled) {
		const action = enabled ? _('Enabling') : _('Disabling');
		pui.showSpinningModal(_('Updating Init Script'),
			_('%s auto-start for %s').format(action, containerName));

		podmanRPC.initScript.setEnabled(containerName, enabled).then((result) => {
			ui.hideModal();
			if (result && result.success) {
				const msg = enabled ?
					_('Init script enabled for %s').format(containerName) :
					_('Init script disabled for %s').format(containerName);
				pui.successTimeNotification(msg);
				// Refresh the info tab to show updated status
				this.renderInfoTab();
			} else {
				throw new Error(result.error || _('Failed to update init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			pui.errorNotification(_('Failed to update init script: %s').format(err
				.message));
		});
	}
});
