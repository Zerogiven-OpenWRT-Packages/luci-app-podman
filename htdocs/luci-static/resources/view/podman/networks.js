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
'require podman.openwrt-network as openwrtNetwork';

utils.addPodmanCss();

/**
 * Network management view with create, inspect, delete, and OpenWrt integration setup
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load network data
	 * @returns {Promise<Object>} Network data or error
	 */
	load: async () => {
		return podmanRPC.network.list()
			.then((networks) => {
				return {
					networks: networks || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed')
				};
			});
	},

	/**
	 * Render networks view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function(data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		this.listHelper = new List.Util({
			itemName: 'network',
			rpc: podmanRPC.network,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Networks'));

		const section = this.map.section(
			form.TableSection,
			'networks',
			'',
			_('Manage Podman %s').format(_('Networks'))
		);
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'ID', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		o = section.option(form.DummyValue, 'Name', _('Name'));
		o.cfgvalue = (sectionId) => {
			const network = this.map.data.data[sectionId];
			const name = network.name || network.Name || _('Unknown');

			return E('span', {}, [
				E('a', {
					href: '#',
					click: (ev) => {
						ev.preventDefault();
						this.handleInspect(name);
					}
				}, E('strong', {}, name)),
				' ',
				E('span', {
					'id': 'integration-icon-' + name,
					'class': 'hidden'
				})
			]);
		};

		o = section.option(podmanForm.field.DataDummyValue, 'Driver', _('Driver'));

		o = section.option(form.DummyValue, 'Subnet', _('Subnet'));
		o.cfgvalue = (sectionId) => {
			const network = this.map.data.data[sectionId];
			if (network.subnets && network.subnets.length > 0) {
				return network.subnets[0].subnet || _('N/A');
			}
			else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
				return network.IPAM.Config[0].Subnet || _('N/A');
			}
			return _('N/A');
		};

		o = section.option(form.DummyValue, 'Gateway', _('Gateway'));
		o.cfgvalue = (sectionId) => {
			const network = this.map.data.data[sectionId];
			if (network.subnets && network.subnets.length > 0) {
				return network.subnets[0].gateway || _('N/A');
			}
			else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
				return network.IPAM.Config[0].Gateway || _('N/A');
			}
			return _('N/A');
		};

		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = format.date;

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateNetwork()
		});

		return this.map.render().then((mapRendered) => {
			const viewContainer = E('div', {
				'class': 'podman-view-list'
			});

			viewContainer.appendChild(toolbar.container);
			viewContainer.appendChild(mapRendered);
			this.listHelper.setupSelectAll(mapRendered);

			this.checkIntegrationStatus();

			return viewContainer;
		});
	},

	/**
	 * Check OpenWrt integration status and display alert icons for incomplete setups
	 */
	checkIntegrationStatus: function () {
		const networks = this.listHelper.getDataArray();
		(networks || []).forEach((network) => {
			const name = network.name || network.Name;
			const driver = openwrtNetwork.getDriver(network);
			openwrtNetwork.isIntegrationComplete(name, driver).then((result) => {
				const iconEl = document.getElementById('integration-icon-' +
					name);
				if (iconEl && !result.complete) {
					iconEl.textContent = '';
					// Translate missing component names
					const translatedMissing = result.missing.map(item => _(item));
					iconEl.appendChild(E('a', {
						'href': '#',
						'class': 'alert-link',
						'title': _(
							'OpenWrt integration incomplete. Click to setup. Missing: %s'
						).format(translatedMissing.join(', ')),
						'click': (ev) => {
							ev.preventDefault();
							ev.stopPropagation();
							this.handleSetupIntegration(network);
						}
					}, '⚠'));
					iconEl.style.display = 'inline';
				}
			}).catch(() => {});
		});
	},

	/**
	 * Get selected networks
	 * @returns {Array<string>} Array of network names
	 */
	getSelectedNetworks: function () {
		return this.listHelper.getSelected((network) => network.name || network.Name);
	},

	/**
	 * Delete selected networks and remove OpenWrt integration if present
	 */
	handleDeleteSelected: function () {
		const selected = this.getSelectedNetworks();

		// Build lookup map: name -> network object
		const networkMap = {};
		const networks = this.listHelper.getDataArray();
		networks.forEach((net) => {
			const name = net.name || net.Name;
			networkMap[name] = net;
		});

		this.listHelper.bulkDelete({
			selected: selected,
			formatItemName: (name) => name,
			sequentialCleanup: true,  // UCI operations must run sequentially
			preDeleteCheck: (networks) => {
				const checkPromises = networks.map((name) => {
					const network = networkMap[name];
					const driver = openwrtNetwork.getDriver(network);
					const deviceName = openwrtNetwork.getDevice(network, name);

					return openwrtNetwork.hasIntegration(name).then((exists) => ({
						name: name,
						hasOpenwrt: exists,
						driver: driver,
						deviceName: deviceName
					})).catch(() => ({
						name: name,
						hasOpenwrt: false,
						driver: driver,
						deviceName: deviceName
					}));
				});
				return Promise.all(checkPromises);
			},
			confirmMessage: (networks, checkResults) => {
				const withOpenwrt = checkResults.filter((c) => c.hasOpenwrt);
				if (withOpenwrt.length > 0) {
					return _('Note: %d %s have OpenWrt integration that will also be removed.').format(
						withOpenwrt.length,
						utils._n(withOpenwrt.length, _('Network'), _('Networks')).toLowerCase()
					);
				}
				return null;
			},
			deletePromiseFn: (name) => podmanRPC.network.remove(name, false),
			afterDeleteEach: (name, checkResult) => {
				if (checkResult && checkResult.hasOpenwrt) {
					return openwrtNetwork.removeIntegration(
						name,
						checkResult.deviceName,
						checkResult.driver
					).catch((err) => {
						// Return error object with network name for better error messages
						return { error: err.message, networkName: name };
					});
				}
				return Promise.resolve();
			},
			cleanupErrorMessage: (cleanupErrors) => {
				// cleanupErrors = [{item, cleanupError, ...}, ...]
				const failedNames = cleanupErrors.map((e) => e.item).join(', ');
				const errorDetails = cleanupErrors.map((e) => e.cleanupError).filter(Boolean).join('; ');
				if (errorDetails) {
					return _('Networks deleted but OpenWrt integration removal failed for: %s (%s)').format(
						failedNames, errorDetails);
				}
				return _('Networks deleted but OpenWrt integration removal failed for: %s').format(failedNames);
			},
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Refresh network list and recheck integration status
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	handleRefresh: function (clearSelections) {
		this.listHelper.refreshTable(clearSelections).then(() => {
			this.checkIntegrationStatus();
		});
	},

	/**
	 * Show create network form
	 */
	handleCreateNetwork: function () {
		const form = new podmanForm.Network.init();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Show network inspect modal
	 * @param {string} name - Network name
	 */
	handleInspect: function (name) {
		this.listHelper.showInspect(name);
	},

	/**
	 * Show setup dialog for OpenWrt integration
	 * @param {Object} network - Network object
	 */
	handleSetupIntegration: function (network) {
		const name = network.name || network.Name;
		const driver = openwrtNetwork.getDriver(network);

		let subnet, gateway, ipv6subnet, ipv6gateway;

		// Extract IPv4 and IPv6 from subnets array
		if (network.subnets && network.subnets.length > 0) {
			for (const s of network.subnets) {
				if (s.subnet && s.subnet.includes(':')) {
					// IPv6
					ipv6subnet = s.subnet;
					ipv6gateway = s.gateway;
				} else if (s.subnet) {
					// IPv4
					subnet = s.subnet;
					gateway = s.gateway;
				}
			}
		}
		// Fallback to IPAM format (Docker compatibility)
		else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
			for (const c of network.IPAM.Config) {
				const sub = c.Subnet || c.subnet;
				const gw = c.Gateway || c.gateway;
				if (sub && sub.includes(':')) {
					ipv6subnet = sub;
					ipv6gateway = gw;
				} else if (sub) {
					subnet = sub;
					gateway = gw;
				}
			}
		}

		if (!subnet || !gateway) {
			podmanUI.errorNotification(_(
				'Cannot setup OpenWrt integration: Network "%s" does not have subnet and gateway configured'
			).format(name));
			return;
		}

		const deviceName = openwrtNetwork.getDevice(network, name);
		const deviceLabel = driver === 'bridge' ? _('Bridge') : _('Parent Interface');

		// Check what's missing
		openwrtNetwork.isIntegrationComplete(name, driver).then((status) => {
			const missingItems = [];
			const existingItems = [];

			// Build lists - only show bridge-specific items for bridge networks
			if (driver === 'bridge') {
				if (status.details.hasDevice) {
					existingItems.push(_('Bridge device'));
				} else {
					missingItems.push(_('Bridge device'));
				}

				// Only show dnsmasq status if dnsmasq is installed
				if (status.details.dnsmasqInstalled) {
					if (status.details.hasDnsmasqExclusion) {
						existingItems.push(_('dnsmasq exclusion'));
					} else {
						missingItems.push(_('dnsmasq exclusion'));
					}
				}
			}

			if (status.details.hasInterface) {
				existingItems.push(_('Network interface'));
			} else {
				missingItems.push(_('Network interface'));
			}

			const networkInfo = [
				E('strong', {}, _('Network: %s').format(name)), E('br'),
				_('Driver: %s').format(driver), E('br'),
				_('Subnet: %s').format(subnet), E('br'),
				_('Gateway: %s').format(gateway)
			];
			if (ipv6subnet) {
				networkInfo.push(E('br'), _('IPv6 Subnet: %s').format(ipv6subnet));
			}
			if (ipv6gateway) {
				networkInfo.push(E('br'), _('IPv6 Gateway: %s').format(ipv6gateway));
			}
			networkInfo.push(E('br'), deviceLabel + ': ' + deviceName);

			const modalContent = [
				E('p', {}, _('Setup OpenWrt integration for network "%s"?').format(name)),
				E('p', {}, networkInfo)
			];

			// Show existing components (if any)
			if (existingItems.length > 0) {
				modalContent.push(
					E('p', { 'class': 'mt-md' }, [
						E('strong', { 'class': 'text-success' }, '✓ ' + _('Already configured:'))
					]),
					E('ul', {},
						existingItems.map(item => E('li', {}, item))
					)
				);
			}

			// Show missing components
			if (missingItems.length > 0) {
				modalContent.push(
					E('p', { 'class': 'mt-md' }, [
						E('strong', { 'class': 'text-warning' }, '⚠ ' + _('Will be added:'))
					]),
					E('ul', {},
						missingItems.map(item => E('li', {}, item))
					)
				);
			}

			modalContent.push(
				new podmanUI.ModalButtons({
					confirmText: _('Setup'),
					onConfirm: () => {
						ui.hideModal();
						this.executeSetupIntegration(name, driver, deviceName, subnet, gateway, ipv6subnet, ipv6gateway);
					}
				}).render()
			);

			ui.showModal(_('Setup OpenWrt Integration'), modalContent);
		});
	},

	/**
	 * Execute OpenWrt integration creation or repair
	 * @param {string} name - Network name
	 * @param {string} driver - Network driver
	 * @param {string} deviceName - Device name (bridge or parent)
	 * @param {string} subnet - Network subnet
	 * @param {string} gateway - Gateway IP
	 * @param {string} [ipv6subnet] - IPv6 subnet (optional)
	 * @param {string} [ipv6gateway] - IPv6 gateway (optional)
	 */
	executeSetupIntegration: function (name, driver, deviceName, subnet, gateway, ipv6subnet, ipv6gateway) {
		podmanUI.showSpinningModal(_('Setting up Integration'), _(
			'Setting up OpenWrt integration...'));

		// Check if network has any existing integration
		openwrtNetwork.isIntegrationComplete(name, driver).then((status) => {
			// If any component exists, use repair (selective)
			// If nothing exists, use create (full integration)
			const hasAnyComponent = status.details.hasInterface || status.details.hasDevice;

			const options = {
				driver: driver,
				subnet: subnet,
				gateway: gateway
			};

			// Add IPv6 if available
			if (ipv6subnet) {
				options.ipv6subnet = ipv6subnet;
			}
			if (ipv6gateway) {
				options.ipv6gateway = ipv6gateway;
			}

			// Set device based on driver
			if (driver === 'bridge') {
				options.bridgeName = deviceName;
			} else {
				options.parent = deviceName;
			}

			if (hasAnyComponent) {
				// Use repair - only add missing components
				return openwrtNetwork.repairIntegration(name, options);
			} else {
				// Use create - full integration with firewall zone
				options.zoneName = 'podman';
				return openwrtNetwork.createIntegration(name, options);
			}
		}).then(() => {
			ui.hideModal();
			podmanUI.successTimeNotification(_(
					'OpenWrt integration for network "%s" created successfully')
				.format(name));

			const iconEl = document.getElementById('integration-icon-' + name);
			if (iconEl) {
				iconEl.style.display = 'none';
				iconEl.textContent = '';
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to setup OpenWrt integration: %s')
				.format(err.message));
		});
	}
});
