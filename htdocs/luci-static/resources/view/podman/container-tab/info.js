'use strict';

'require baseclass';
'require ui';

'require podman.ui as podmanUI';
'require podman.format as format';
'require podman.rpc as podmanRPC';
'require podman.openwrt-network as openwrtNetwork';
'require podman.utils as utils';

return baseclass.extend({
	containerId: 0,
	containerData: {},
	networksData: [],

	render: async function (content, id, data, networks) {
		this.containerId = id;
		this.containerData = data;
		this.networksData = networks || [];

		const config = data.Config || {};
		const hostConfig = data.HostConfig || {};
		const networkSettings = data.NetworkSettings || {};
		const status = data.State ? data.State.Status : 'unknown';

		// Build info sections
		const sections = [];

		sections.push((await this.basicSection(status, config, hostConfig)).render());
		sections.push((await this.configSection(config, hostConfig)).render());
		sections.push((await this.networkSection(config, hostConfig, networkSettings)).render());

		if (config.Env && config.Env.length > 0) {
			sections.push((await this.envSection(config.Env)).render());
		}

		if (data.Mounts && data.Mounts.length > 0) {
			sections.push((await this.mountsSection(data.Mounts)).render());
		}

		// Append all sections
		sections.forEach(function (section) {
			content.appendChild(section);
		});
	},

	basicSection: async function (status, config, hostConfig) {
		// Basic Information - using podmanUI.Table
		const data = this.containerData;
		const basicTable = new podmanUI.Table({ 'class': 'table table-list' });

		// Name (editable)
		const inputId = 'edit-name';
		basicTable.addRow([
			{ inner: _('Name') },
			{
				inner: [
					E('input', {
						'type': 'text',
						'id': inputId,
						'class': 'cbi-input-text edit-container-name',
						'value': data.Name ? data.Name.replace(/^\//, '') : '-',
					}),
					new podmanUI.Button(
						_('Update'),
						() => this.handleUpdateName(
							document.getElementById(inputId).value
						),
						'apply'
					).render()
				]
			}
		]);

		// Standard info rows
		basicTable
			.addRow([
				{ inner: _('Id').toUpperCase() },
				{
					inner: data.Id ? data.Id.substring(0, 64) : '-'
				}
			])
			.addRow([
				{ inner: _('Image') },
				{
					inner: config.Image || '-'
				}
			])
			.addRow([
				{ inner: _('Status') },
				{ inner: data.State ? _(data.State.Status) : '-' }
			])
			.addRow([
				{ inner: _('Created') },
				{
					inner: data.Created ? format.date(data.Created) : '-'
				}
			])
			.addRow([
				{ inner: _('Started') },
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

		basicTable.addRow([
			{ inner: _('Restart Policy') },
			{
				inner: [
					E('select', {
						'id': selectId,
						'class': 'cbi-input-select',
						'style': 'width: 60%; margin-right: 5px;'
					}, policyOptions),
					new podmanUI.Button(_('Update'), () => this.handleUpdateRestartPolicy(
						document.getElementById(selectId).value), 'apply').render()
				]
			}
		]);

		// Auto-update status
		const autoUpdateLabel = config.Labels && config.Labels['io.containers.autoupdate'];
		basicTable.addRow([
			{ inner: _('Auto-Update') },
			{
				inner: autoUpdateLabel || _('Disabled')
			}
		]);

		// Init Script status (loaded asynchronously)
		const initScriptCell = E('span', { 'class': 'loading-gray' }, '...');
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
					initScriptCell.textContent = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #5cb85c; margin-right: 10px;'
					}, '✓ ' + _('Enabled')));

					buttons.push(new podmanUI.Button(_('Show'), () => this
						.handleShowInitScript(containerName), 'neutral').render());
					buttons.push(' ');
					buttons.push(new podmanUI.Button(_('Disable'), () => this
							.handleToggleInitScript(containerName, false), 'negative')
						.render());
				} else if (status.exists && !status.enabled) {
					// Init script exists but disabled
					initScriptCell.textContent = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #999; margin-right: 10px;'
					}, '○ ' + _('Disabled')));

					buttons.push(new podmanUI.Button(_('Show'), () => this
						.handleShowInitScript(containerName), 'neutral').render());
					buttons.push(' ');
					buttons.push(new podmanUI.Button(_('Enable'), () => this
							.handleToggleInitScript(containerName, true), 'positive')
						.render());
				} else if (hasRestartPolicy) {
					// No init script but has restart policy - show warning with Generate button
					initScriptCell.textContent = '';
					initScriptCell.appendChild(E('span', {
						'style': 'color: #f0ad4e; margin-right: 10px;',
						'title': _('Restart policy set but no init script')
					}, '⚠️ ' + _('Not configured')));

					buttons.push(new podmanUI.Button(_('Generate'), () => this
							.handleGenerateInitScript(containerName), 'positive')
						.render());
				} else {
					// No init script and no restart policy - show helper text
					initScriptCell.textContent = '';
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

		basicTable.addRow([
			{ inner: _('Init Script') },
			{ inner: initScriptCell }
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
				}, ' (' + _('%d consecutive failures').format(failingStreak) + ')'));
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
				healthDetails.push(new podmanUI.Button(_('Run Check'), () => this.handleHealthCheck(),
					'positive').render());
			}

			basicTable.addRow([
				{ inner: _('Health') },
				{
					inner: healthDetails,
					options: {
						'style': 'word-break: break-word;'
					}
				}
			]);
		}

		const basicSection = new podmanUI.Section({
			'style': 'margin-bottom: 20px;'
		});
		basicSection.addNode(_('Basic Information'), '', basicTable.render());

		return basicSection;
	},

	configSection: async function (config, hostConfig) {
		const cmd = config.Cmd ? config.Cmd.join(' ') : '-';
		const entrypoint = config.Entrypoint ? config.Entrypoint.join(' ') : '-';

		const configTable = new podmanUI.Table({ 'class': 'table table-list' });
		configTable
			.addRow([
				{ inner: _('Command') },
				{
					inner: cmd,
					options: { 'style': 'word-break: break-word;' }
				}
			])
			.addRow([
				{ inner: _('Entrypoint') },
				{
					inner: entrypoint,
					options: { 'style': 'word-break: break-word;' }
				}
			])
			.addRow([
				{ inner: _('Working Directory') },
				{ inner: config.WorkingDir || '-' }
			])
			.addRow([
				{ inner: _('User') },
				{ inner: config.User || '-' }
			])
			.addRow([
				{ inner: _('Hostname') },
				{ inner: config.Hostname || '-' }
			])
			.addRow([
				{ inner: _('Privileged') },
				{ inner: hostConfig.Privileged ? _('Yes') : _('No') }
			])
			.addRow([
				{ inner: _('TTY') },
				{ inner: config.Tty ? _('Yes') : _('No') }
			])
			.addRow([
				{ inner: _('Interactive') },
				{ inner: config.OpenStdin ? _('Yes') : _('No') }
			]);

		const configSection = new podmanUI.Section({
			'class': 'cbi-section section-container-info',
		});
		configSection.addNode(_('Configuration'), '', configTable.render());

		return configSection;
	},

	networkSection: async function (config, hostConfig, networkSettings) {
		// Network - using podmanUI.Table
		const networkTable = new podmanUI.Table({ 'class': 'table table-list' });

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
							'style': 'cursor: help;',
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
								new podmanUI.Button(_('Disconnect'), () => this
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
		}, _('-- Select %s --').format(_('Network')))];

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

		networkTable.addRow([
			{ inner: _('Connect to') },
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
					new podmanUI.Button(_('Connect'), () => {
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

		// Render Network section using podmanUI.Section
		const networkSection = new podmanUI.Section({
			'class': 'cbi-section section-container-info',
		});
		networkSection.addNode(_('Network'), '', networkTable.render());

		return networkSection;
	},

	envSection: async function (envs) {
		const envTable = new podmanUI.Table({ class: 'table table-env-vars' });
		envTable
			.addHeader(_('Variable'))
			.addHeader(_('Value'));

		envs.forEach(function (env) {
			const parts = env.split('=');
			const varName = parts[0];
			const varValue = parts.slice(1).join('=');

			// Create censored value display (bullet points)
			const censoredValue = '••••••••';

			envTable.addRow([
				{ inner: varName },
				{
					inner: censoredValue,
					options: {
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

		const envSection = new podmanUI.Section({
			'class': 'cbi-section section-container-info',
		});
		envSection.addNode(_('Environment Variables'), '', envTable.render());

		return envSection;
	},

	mountsSection: async function (mounts) {
		const mountsTable = new podmanUI.Table();
		mountsTable
			.addHeader(_('Type'))
			.addHeader(_('Source'))
			.addHeader(_('Destination'))
			.addHeader(_('Mode'));

		mounts.forEach(function (mount) {
			mountsTable.addRow([
				{ inner: mount.Type || '-' },
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
				{ inner: mount.RW ? 'rw' : 'ro' }
			]);
		});

		const mountsSection = new podmanUI.Section({
			'class': 'cbi-section section-container-info',
		});
		mountsSection.addNode(_('Mounts'), '', mountsTable.render());

		return mountsSection;
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
	 * Handle name update
	 * @param {string} newName - New container name
	 */
	handleUpdateName: function (newName) {
		if (!newName || newName === this.containerData.Name.replace(/^\//, '')) {
			return;
		}

		podmanUI.showSpinningModal(_('Updating Container'), _('Renaming container...'));

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
		podmanUI.showSpinningModal(_('Updating Container'), _('Updating restart policy...'));

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
			podmanUI.successTimeNotification(_('Restart policy updated successfully'));
			window.location.reload();
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to update restart policy: %s')
				.format(err.message));
		});
	},

	/**
	 * Handle network connect
	 * @param {string} networkName - Network name
	 * @param {string} ip - Optional IP address
	 */
	handleNetworkConnect: function (networkName, ip) {
		podmanUI.showSpinningModal(_('Connecting to Network'), _(
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

		podmanUI.showSpinningModal(_('Disconnecting from Network'), _(
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
	 * Handle generate init script for container
	 * @param {string} containerName - Container name
	 */
	handleGenerateInitScript: function (containerName) {
		podmanUI.showSpinningModal(_('Generating Init Script'),
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
				podmanUI.successTimeNotification(
					_('Init script created and enabled for %s').format(containerName));
				// Refresh the info tab to show updated status
				this.renderInfoTab();
			} else {
				throw new Error(result.error || _('Failed to enable init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(
				_('Failed to setup auto-start: %s').format(err.message));
		});
	},

	/**
	 * Handle show init script content
	 * @param {string} containerName - Container name
	 */
	handleShowInitScript: function (containerName) {
		podmanUI.showSpinningModal(
			_('Loading Init Script'),
			_('Fetching script'),
		);

		podmanRPC.initScript.show(containerName).then((result) => {
			ui.hideModal();
			if (result && result.content) {
				// Show script content in a modal
				const content = E('div', {}, [
					E(
						'pre',
						{ 'class': 'code-area' },
						result.content.replace(/\\n/g, '\n')
					)
				]);

				ui.showModal(_('Init Script'), [
					content,
					E('div', {
						'class': 'right modal-buttons',
					}, [
						new podmanUI.Button(_('Close'), ui.hideModal, 'neutral')
						.render()
					])
				]);
			} else {
				throw new Error(result.error || _('Failed to load init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(`${_('Failed to load init script')}: ${err.message}`);
		});
	},

	/**
	 * Handle enable/disable init script
	 * @param {string} containerName - Container name
	 * @param {boolean} enabled - Enable or disable
	 */
	handleToggleInitScript: function (containerName, enabled) {
		const action = enabled ? _('Enabling') : _('Disabling');
		podmanUI.showSpinningModal(_('Updating Init Script'),
			_('%s auto-start for %s').format(action, containerName));

		podmanRPC.initScript.setEnabled(containerName, enabled).then((result) => {
			ui.hideModal();
			if (result && result.success) {
				const msg = enabled ?
					_('Init script enabled for %s').format(containerName) :
					_('Init script disabled for %s').format(containerName);
				podmanUI.successTimeNotification(msg);
				// Refresh the info tab to show updated status
				this.renderInfoTab();
			} else {
				throw new Error(result.error || _('Failed to update init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(`${_('Failed to update init script')}: ${err.message}`);
		});
	}
});
