'use strict';

'require view';
'require form';
'require ui';

'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.format as format';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';
'require podman.container-util as ContainerUtil';

utils.addPodmanCss().addCss('view/podman/containers.css');

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
	 * Returns basic list data only - inspect data loaded on-demand for performance
	 * @returns {Promise<Object>} Container data or error
	 */
	load: async () => {
		return podmanRPC.container.list('all=true')
			.then((containers) => {
				if (!containers || containers.length === 0) {
					return {
						containers: []
					};
				}

				// Sort containers alphabetically by name
				containers.sort((a, b) => {
					const nameA = (a.Names && a.Names[0] ? a.Names[0] : '')
						.toLowerCase();
					const nameB = (b.Names && b.Names[0] ? b.Names[0] : '')
						.toLowerCase();
					return nameA.localeCompare(nameB);
				});

				return {
					containers: containers
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed')
				};
			});
	},

	/**
	 * Render containers view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function (data) {
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

		const section = this.map.section(
			form.TableSection,
			'containers',
			'',
			_('Manage Podman %s').format(_('Containers').toLowerCase())
		);
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'ID', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		o = section.option(podmanForm.field.DataDummyValue, 'Names', _('Name'));

		o = section.option(form.DummyValue, 'Id', _('Id').toUpperCase());
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const containerId = container.Id;
			const containerName = container.Names && container.Names[0] ? container.Names[0] :
				'';

			return E('a', {
				href: L.url('admin/podman/container', containerId),
				title: containerName || containerId,
				'data-container-id': containerId
			}, utils.truncate(containerId, 10));
		};

		o = section.option(podmanForm.field.DataDummyValue, 'Image', _('Image'));
		o = section.option(podmanForm.field.DataDummyValue, 'State', _('Status'));
		o.cfgformatter = (state) => _(state);
		o = section.option(form.DummyValue, 'Health', _('Health'));
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const status = container.Status;

			if (!status || !['healthy', 'unhealthy', 'starting'].includes(status
				.toLowerCase())) {
				return E('span', {
					'class': 'text-muted'
				}, '—');
			}

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
			const containerName = container.Names && container.Names[0] ? container.Names[0] :
				null;

			return E('span', {
				'class': 'autostart-status autostart-disabled',
				'data-container-id': container.Id,
				'data-container-name': containerName
			}, '...');
		};

		o = section.option(podmanForm.field.ContainerMobileActionsValue, 'Action', '');
		o.name = 'mobile-actions';
		o.cfgvalue = (sectionId) => {
			const container = this.map.data.data[sectionId];
			const isRunning = container.State === 'running';

			const buttons = [];

			if (isRunning) {
				buttons.push({
					text: '&#9724;',
					handler: () => this.handleStop(),
					cssClass: 'negative',
					tooltip: _('Stop selected %s').format(_('Containers').toLowerCase())
				});
			} else {
				buttons.push({
					text: '&#9658;',
					handler: () => this.handleStart(),
					cssClass: 'positive',
					tooltip: _('Start selected %s').format(_('Containers').toLowerCase())
				});
			}

			buttons.push({
				text: '&#8635;',
				handler: () => this.handleRestart(),
				cssClass: '',
				tooltip: _('Restart selected %s').format(_('Containers').toLowerCase())
			});

			const toolbar = this.listHelper.createToolbar({
				onDelete: undefined,
				onRefresh: undefined,
				onCreate: undefined,
				customButtons: buttons,
			});

			return E('span', {
				'style': 'padding-top: 1rem',
				'class': 'hide-not-mobile',
			}, toolbar.container);
		};

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleRemove(),
			onRefresh: () => this.refreshTable(false),
			onCreate: undefined,
			customButtons: [
				{
					text: '&#9658;',
					handler: () => this.handleStart(),
					cssClass: 'positive',
					tooltip: _('Start selected %s').format(_('Containers').toLowerCase())
				},
				{
					text: '&#9724;',
					handler: () => this.handleStop(),
					cssClass: 'negative',
					tooltip: _('Stop selected %s').format(_('Containers').toLowerCase())
				},
				{
					text: '&#8635;',
					handler: () => this.handleRestart(),
					cssClass: '',
					tooltip: _('Restart selected %s').format(_('Containers').toLowerCase())
				},
				{
					text: '&#10010;',
					handler: () => this.handleBulkHealthCheck(),
					cssClass: 'apply',
					tooltip: _('Run health checks on selected containers')
				}
			],
		});

		const createButton = new podmanUI.MultiButton({}, 'add')
			.addItem(_('Create %s').format(_('Container')), () => this.handleCreateContainer())
			.addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
			// .addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
			.render();

		toolbar.prependButton(createButton);

		return this.map.render().then((mapRendered) => {
			const viewContainer = E('div', {
				'class': 'podman-view-list'
			});

			viewContainer.appendChild(toolbar.container);
			viewContainer.appendChild(mapRendered);

			this.listHelper.setupSelectAll(mapRendered);

			// Fetch detailed container data asynchronously (non-blocking)
			this.fetchContainerDetails(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Refresh table data
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	refreshTable: function (clearSelections) {
		return this.listHelper.refreshTable(clearSelections).then(() => {
			// Re-fetch container details (inspect data, init script status) after table refresh
			const container = document.querySelector('.podman-view-list');
			if (container) {
				this.fetchContainerDetails(container);
			}
		});
	},

	/**
	 * Fetch detailed container data and update DOM after table render
	 * Calls one Promise.all per container to fetch inspect + init script status
	 * @param {Element} mapRendered - Rendered table element
	 */
	fetchContainerDetails: function (mapRendered) {
		const containers = this.map.data.data;

		// Loop through all containers
		Object.keys(containers).forEach((sectionId) => {
			const container = containers[sectionId];
			if (!container || !container.Id) return;

			const containerId = container.Id;
			const containerName = container.Names && container.Names[0] ? container.Names[
				0] : null;

			// Find DOM elements for this container using data attributes
			const idLink = mapRendered.querySelector(
				`a[data-container-id="${containerId}"]`);
			const autoStartCell = mapRendered.querySelector(
				`.autostart-status[data-container-id="${containerId}"]`);

			// Skip if no autostart cell (container has no name)
			if (!containerName || !autoStartCell) {
				return;
			}

			// Fetch inspect data and init script status in parallel (ONE Promise.all per container)
			Promise.all([
				podmanRPC.container.inspect(containerId),
				podmanRPC.initScript.status(containerName)
			]).then(([inspectData, initStatus]) => {
				// Update ID column tooltip with network details
				if (idLink && inspectData.NetworkSettings) {
					const tooltipParts = [];

					// Add network IPs
					if (inspectData.NetworkSettings.Networks) {
						const networks = inspectData.NetworkSettings.Networks;
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

					// Add ports (both mapped and exposed)
					if (inspectData.NetworkSettings.Ports) {
						const extractedPorts = utils.extractPorts(inspectData
							.NetworkSettings.Ports);
						const portStrings = [];
						extractedPorts.forEach((port) => {
							if (port.isMapped) {
								portStrings.push(
									`${port.hostPort}→${port.containerPort}`
									);
							} else {
								portStrings.push(
									`${port.containerPort}/${port.protocol}`
									);
							}
						});
						if (portStrings.length > 0) {
							tooltipParts.push('Ports: ' + portStrings.join(', '));
						}
					}

					idLink.title = containerName || containerId;
					if (tooltipParts.length > 0) {
						idLink.title = tooltipParts.join(' | ');
					}
				}

				// Update Auto-start column status
				if (autoStartCell) {
					const hasRestartPolicy = inspectData.HostConfig &&
						inspectData.HostConfig.RestartPolicy &&
						inspectData.HostConfig.RestartPolicy.Name &&
						inspectData.HostConfig.RestartPolicy.Name !== '' &&
						inspectData.HostConfig.RestartPolicy.Name !== 'no';

					autoStartCell.textContent = '—';
					autoStartCell.className = 'autostart-status autostart-disabled';
					autoStartCell.title = _('No auto-start configured');

					if (initStatus.exists && initStatus.enabled) {
						// Init script exists and enabled
						autoStartCell.textContent = '✓';
						autoStartCell.className = 'autostart-status autostart-enabled';
						autoStartCell.title = _('Init script enabled for %s').format(containerName);
					} else if (hasRestartPolicy && !initStatus.exists) {
						// Has restart policy but no init script - show warning
						autoStartCell.textContent = '⚠';
						autoStartCell.className = 'autostart-status autostart-warning';
						autoStartCell.title = _(
							'Restart policy set but no init script. Click to generate.'
							);
						autoStartCell.addEventListener('click', (ev) => {
							ev.preventDefault();
							this.handleGenerateInitScript(containerName);
						});
					} else if (initStatus.exists && !initStatus.enabled) {
						// Init script exists but disabled
						autoStartCell.textContent = '○';
						autoStartCell.className = 'autostart-status autostart-disabled';
						autoStartCell.title = _('Init script disabled for %s').format(containerName);
					}
				}
			}).catch((err) => {
				// On error, show error state in auto-start column
				if (autoStartCell) {
					autoStartCell.textContent = '✗';
					autoStartCell.className = 'autostart-status autostart-error';
					autoStartCell.title = _('Error loading details: %s').format(
						err.message);
				}
			});
		});
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
		const form = new podmanForm.Container.init();
		form.submit = () => this.refreshTable(false);
		form.render();
	},

	/**
	 * Show import from docker run command dialog
	 */
	handleImportFromRunCommand: function () {
		const form = new podmanForm.Container.init();
		form.submit = () => this.refreshTable(false);
		form.showImportFromRunCommand();
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
	 * Restart selected containers
	 */
	handleRestart: function () {
		const selected = this.getSelectedContainerIds();

		ContainerUtil.restartContainers(selected).then(() => {
			this.refreshTable(false);
		});
	},

	/**
	 * Remove selected containers with init script cleanup
	 */
	handleRemove: function () {
		const selected = this.getSelectedContainerIds();

		if (selected.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format('Containers'));
			return;
		}

		const confirmDelete = this.listHelper._buildConfirmDeleteMessage(selected, null, {formatItemName: (id) => utils.truncate(id, 12)});
		if (!confirm(confirmDelete))
			return;

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
			podmanUI.warningTimeNotification(
				_('No selected containers have health checks configured')
			);
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
		podmanUI.showSpinningModal(
			_('Generating Init Script'),
			_('Creating auto-start configuration for %s').format(containerName)
		);

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
					_('Init script created and enabled for %s').format(containerName)
				);
				this.refreshTable(false);
			} else {
				throw new Error(result.error || _('Failed to enable init script'));
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(
				_('Failed to setup auto-start: %s').format(err.message)
			);
		});
	}
});
