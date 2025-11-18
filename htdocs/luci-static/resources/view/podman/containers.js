'use strict';

'require view';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.format as format';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';
'require podman.container-util as ContainerUtil';
'require ui';

/**
 * Container management view with create, start, stop, health check, and delete operations
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load container data (all containers including stopped)
	 * Enriches list data with full inspect data to access HostConfig.RestartPolicy
	 * @returns {Promise<Object>} Container data or error
	 */
	load: async () => {
		return podmanRPC.container.list('all=true')
			.then(async (containers) => {
				if (!containers || containers.length === 0) {
					return { containers: [] };
				}

				// Fetch full inspect data for each container to get RestartPolicy and NetworkSettings
				const inspectPromises = containers.map((container) =>
					podmanRPC.container.inspect(container.Id)
						.then((inspectData) => {
							// Merge inspect data (especially HostConfig and NetworkSettings) into list data
							return Object.assign({}, container, {
								HostConfig: inspectData.HostConfig,
								NetworkSettings: inspectData.NetworkSettings
							});
						})
						.catch(() => {
							// If inspect fails, return original list data
							return container;
						})
				);

				const enrichedContainers = await Promise.all(inspectPromises);

				return {
					containers: enrichedContainers
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed to load containers')
				};
			});
	},

	/**
	 * Render containers view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function(data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		this.listHelper = new List.Util({
			itemName: 'container',
			rpc: podmanRPC.container,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Containers'));

		const section = this.map.section(form.TableSection, 'containers', '', _(
			'Manage Podman containers'));
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'ID', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		o = section.option(podmanForm.field.DataDummyValue, 'Names', _('Name'));

		o = section.option(form.DummyValue, 'Id', _('Id'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const containerId = container.Id;

			// Build tooltip with IPs and ports
			const tooltipParts = [];

			// Add network IPs
			if (container.NetworkSettings && container.NetworkSettings.Networks) {
				const networks = container.NetworkSettings.Networks;
				const ips = [];
				Object.keys(networks).forEach((netName) => {
					const net = networks[netName];
					if (net.IPAddress) {
						ips.push(`${netName}: ${net.IPAddress}`);
					}
				});
				if (ips.length > 0) {
					tooltipParts.push('IPs: ' + ips.join(', '));
				}
			}

			// Add port mappings
			if (container.NetworkSettings && container.NetworkSettings.Ports) {
				const ports = container.NetworkSettings.Ports;
				const portMappings = [];
				Object.keys(ports).forEach((containerPort) => {
					const bindings = ports[containerPort];
					if (bindings && bindings.length > 0) {
						bindings.forEach((binding) => {
							const hostPort = binding.HostPort;
							const portNum = containerPort.split('/')[0];
							portMappings.push(`${hostPort}→${portNum}`);
						});
					}
				});
				if (portMappings.length > 0) {
					tooltipParts.push('Ports: ' + portMappings.join(', '));
				}
			}

			const tooltip = tooltipParts.length > 0 ? tooltipParts.join(' | ') : '';

			return E('a', {
				href: L.url('admin/podman/container', containerId),
				title: tooltip
			}, utils.truncate(containerId, 10));
		};

		o = section.option(podmanForm.field.DataDummyValue, 'Image', _('Image'));
		o = section.option(podmanForm.field.DataDummyValue, 'State', _('Status'));
		o = section.option(form.DummyValue, 'Health', _('Health'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const health = container.State && container.State.Health;

			if (!health) {
				return E('span', {
					'style': 'color: #999;'
				}, '—');
			}

			const status = health.Status || 'starting';
			const badgeClass = 'badge status-' + status.toLowerCase();

			return E('span', {
				'class': badgeClass
			}, status);
		};
		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = format.date;

		o = section.option(form.DummyValue, 'InitScript', _('Auto-start'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const containerName = container.Names && container.Names[0] ? container.Names[0] : null;

			if (!containerName) {
				return E('span', { 'style': 'color: #999;' }, '—');
			}

			// Check init script status asynchronously
			const statusCell = E('span', { 'style': 'color: #999;' }, '...');

			podmanRPC.initScript.status(containerName).then((status) => {
				const hasRestartPolicy = container.HostConfig && container.HostConfig.RestartPolicy &&
					container.HostConfig.RestartPolicy.Name &&
					container.HostConfig.RestartPolicy.Name !== '' &&
					container.HostConfig.RestartPolicy.Name !== 'no';

				if (status.exists && status.enabled) {
					// Init script exists and enabled
					statusCell.textContent = '✓';
					statusCell.style.color = '#5cb85c';
					statusCell.title = _('Init script enabled');
				} else if (hasRestartPolicy && !status.exists) {
					// Has restart policy but no init script - show warning
					statusCell.innerHTML = '⚠️';
					statusCell.style.color = '#f0ad4e';
					statusCell.style.cursor = 'pointer';
					statusCell.title = _('Restart policy set but no init script. Click to generate.');
					statusCell.addEventListener('click', (ev) => {
						ev.preventDefault();
						this.handleGenerateInitScript(containerName);
					});
				} else if (status.exists && !status.enabled) {
					// Init script exists but disabled
					statusCell.textContent = '○';
					statusCell.style.color = '#999';
					statusCell.title = _('Init script disabled');
				} else {
					// No init script, no restart policy
					statusCell.textContent = '—';
					statusCell.style.color = '#999';
					statusCell.title = _('No auto-start configured');
				}
			}).catch((err) => {
				statusCell.textContent = '✗';
				statusCell.style.color = '#d9534f';
				statusCell.title = _('Error checking status: %s').format(err.message);
			});

			return statusCell;
		};

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleRemove(),
			onRefresh: () => this.refreshTable(false),
			onCreate: undefined,
			customButtons: [{
					text: '&#9658;',
					handler: () => this.handleStart(),
					cssClass: 'positive',
					tooltip: _('Start selected containers')
				},
				{
					text: '&#9724;',
					handler: () => this.handleStop(),
					cssClass: 'negative',
					tooltip: _('Stop selected containers')
				},
				{
					text: '&#10010;',
					handler: () => this.handleBulkHealthCheck(),
					cssClass: 'apply',
					tooltip: _('Run health checks on selected containers')
				}
			]
		});

		const createButton = new podmanUI.MultiButton({}, 'add')
			.addItem(_('Create Container'), () => this.handleCreateContainer())
			.addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
			.addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
			.render();

		toolbar.prependButton(createButton);

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
	 * Refresh table data
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	refreshTable: function (clearSelections) {
		return this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Get selected container IDs
	 * @returns {Array<string>} Array of container IDs
	 */
	getSelectedContainerIds: function () {
		return this.listHelper.getSelected((container) => container.Id);
	},

	/**
	 * Show create container form
	 */
	handleCreateContainer: function () {
		const form = new podmanForm.Container();
		form.submit = () => this.refreshTable(false);
		form.render();
	},

	/**
	 * Show import from docker run command dialog
	 */
	handleImportFromRunCommand: function () {
		const form = new podmanForm.Container();
		form.submit = () => this.refreshTable(false);
		form.showImportFromRunCommand();
	},

	/**
	 * Show import from compose file dialog (not implemented)
	 */
	handleImportFromCompose: function() {
	},

	/**
	 * Start selected containers
	 */
	handleStart: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.startContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Stop selected containers
	 */
	handleStop: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.stopContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Remove selected containers
	 */
	handleRemove: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.removeContainers(selected).then(() => {
			this.refreshTable(true);
		});
	},

	/**
	 * Run health checks on selected containers
	 */
	handleBulkHealthCheck: function () {
		const selected = this.getSelectedContainerIds();

		// Filter to only containers with health checks configured
		const containersWithHealth = selected.filter((id) => {
			const container = this.listHelper.data.containers.find((c) => c.Id === id);
			return container && container.State && container.State.Health;
		});

		if (containersWithHealth.length === 0) {
			podmanUI.warningTimeNotification(_(
				'No selected containers have health checks configured'));
			return;
		}

		ContainerUtil.healthCheckContainers(containersWithHealth).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Generate init script for container with restart policy
	 * @param {string} containerName - Container name
	 */
	handleGenerateInitScript: function (containerName) {
		podmanUI.showSpinningModal(_('Generating init script...'),
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
				this.refreshTable(false);
			} else {
				throw new Error(result.error || _('Failed to enable init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(
				_('Failed to setup auto-start: %s').format(err.message));
		});
	}
});
