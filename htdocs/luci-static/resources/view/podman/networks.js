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

		const section = this.map.section(form.TableSection, 'networks', '', _(
			'Manage Podman %s').format(_('Networks').toLowerCase()));
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'name', new ui.Checkbox(
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
					'style': 'display: none;'
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
		o.cfgformatter = (created) => format.date(new Date(created).getTime() / 1000);

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: () => this.handleCreateNetwork()
		});

		return this.map.render().then((mapRendered) => {
			const viewContainer = E('div', {
				'class': 'podman-view-container'
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
			openwrtNetwork.isIntegrationComplete(name).then((result) => {
				const iconEl = document.getElementById('integration-icon-' +
					name);
				if (iconEl && !result.complete) {
					iconEl.innerHTML = '';
					// Translate missing component names
					const translatedMissing = result.missing.map(item => _(item));
					iconEl.appendChild(E('a', {
						'href': '#',
						'class': 'alert-icon',
						'style': 'color: #f90; text-decoration: none; cursor: pointer;',
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

		if (selected.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format(_('Networks').toLowerCase()));
			return;
		}

		const checkPromises = selected.map((name) =>
			openwrtNetwork.hasIntegration(name).then((exists) => ({
				name: name,
				hasOpenwrt: exists
			})).catch(() => ({
				name: name,
				hasOpenwrt: false
			}))
		);

		Promise.all(checkPromises).then((checks) => {
			const withOpenwrt = checks.filter((c) => c.hasOpenwrt);

			let confirmMsg = _('Are you sure you want to delete %d %s?\n\n%s').format(
				selected.length,
				N_(selected.length, 'Network', 'Networks').toLowerCase(),
				selected.join(', ')
			);

			if (withOpenwrt.length > 0) {
				confirmMsg += '\n\n' +
					_('Note: Some %s have OpenWrt integration that will also be removed.').format(
						N_(selected.length, 'Network', 'Networks').toLowerCase()
					);
			}

			if (!confirm(confirmMsg)) return;

			podmanUI.showSpinningModal(
				_('Deleting %s').format(_('Networks')),
				_('Deleting %d selected %s...').format(
					selected.length,
					N_(selected.length, 'Network', 'Networks').toLowerCase()
				)
			);

			const deletePromises = selected.map((name) => {
				const check = checks.find((c) => c.name === name);
				const bridgeName = name + '0';

				return podmanRPC.network.remove(name, false).then((result) => {
					if (result && result.error) {
						return {
							name: name,
							error: result.error
						};
					}

					if (check && check.hasOpenwrt) {
						return openwrtNetwork.removeIntegration(name,
							bridgeName).then(() => {
							return {
								name: name,
								success: true,
								openwrtRemoved: true
							};
						}).catch((err) => {
							return {
								name: name,
								success: true,
								openwrtError: err.message
							};
						});
					}

					return {
						name: name,
						success: true
					};
				}).catch((err) => {
					return {
						name: name,
						error: err.message
					};
				});
			});

			Promise.all(deletePromises).then((results) => {
				ui.hideModal();

				const errors = results.filter((r) => r.error);
				const openwrtErrors = results.filter((r) => r.openwrtError);

				if (errors.length > 0) {
					podmanUI.errorNotification(_('Failed to delete %d %s')
						.format(errors.length, _('Networks').toLowerCase()));
				} else if (openwrtErrors.length > 0) {
					podmanUI.warningNotification(_(
						'Networks deleted but %d OpenWrt integrations failed to remove'
					).format(openwrtErrors.length));
				} else {
					podmanUI.successTimeNotification(_(
						'Successfully deleted %d %s').format(
						selected.length, _('Networks').toLowerCase()));
				}

				this.handleRefresh(true);
			}).catch((err) => {
				ui.hideModal();
				podmanUI.errorNotification(_('Failed to delete networks: %s')
					.format(err.message));
			});
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
		const form = new podmanForm.Network();
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

		let subnet, gateway;

		if (network.subnets && network.subnets.length > 0) {
			subnet = network.subnets[0].subnet;
			gateway = network.subnets[0].gateway;
		}
		else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
			subnet = network.IPAM.Config[0].Subnet;
			gateway = network.IPAM.Config[0].Gateway;
		}

		if (!subnet || !gateway) {
			podmanUI.errorNotification(_(
				'Cannot setup OpenWrt integration: Network "%s" does not have subnet and gateway configured'
			).format(name));
			return;
		}

		const bridgeName = name + '0';

		// Check what's missing
		openwrtNetwork.isIntegrationComplete(name).then((status) => {
			const missingItems = [];
			const existingItems = [];

			// Build lists
			if (status.details.hasDevice) {
				existingItems.push(_('Bridge device'));
			} else {
				missingItems.push(_('Bridge device'));
			}

			if (status.details.hasInterface) {
				existingItems.push(_('Network interface'));
			} else {
				missingItems.push(_('Network interface'));
			}

			if (status.details.hasDnsmasqExclusion) {
				existingItems.push(_('dnsmasq exclusion'));
			} else {
				missingItems.push(_('dnsmasq exclusion'));
			}

			const modalContent = [
				E('p', {}, _('Setup OpenWrt integration for network "%s"?').format(name)),
				E('p', {}, [
					E('strong', {}, _('Network: %s').format(name)), E('br'),
					_('Subnet: %s').format(subnet), E('br'),
					_('Gateway: %s').format(gateway), E('br'),
					_('Bridge: %s').format(bridgeName)
				])
			];

			// Show existing components (if any)
			if (existingItems.length > 0) {
				modalContent.push(
					E('p', { 'style': 'margin-top: 15px;' }, [
						E('strong', { 'style': 'color: #28a745;' }, '✓ ' + _('Already configured:'))
					]),
					E('ul', { 'style': 'margin: 5px 0;' },
						existingItems.map(item => E('li', {}, item))
					)
				);
			}

			// Show missing components
			if (missingItems.length > 0) {
				modalContent.push(
					E('p', { 'style': 'margin-top: 15px;' }, [
						E('strong', { 'style': 'color: #f90;' }, '⚠ ' + _('Will be added:'))
					]),
					E('ul', { 'style': 'margin: 5px 0;' },
						missingItems.map(item => E('li', {}, item))
					)
				);
			}

			modalContent.push(
				new podmanUI.ModalButtons({
					confirmText: _('Setup'),
					onConfirm: () => {
						ui.hideModal();
						this.executeSetupIntegration(name, bridgeName, subnet, gateway);
					}
				}).render()
			);

			ui.showModal(_('Setup OpenWrt Integration'), modalContent);
		});
	},

	/**
	 * Execute OpenWrt integration creation or repair
	 * @param {string} name - Network name
	 * @param {string} bridgeName - Bridge name
	 * @param {string} subnet - Network subnet
	 * @param {string} gateway - Gateway IP
	 */
	executeSetupIntegration: function (name, bridgeName, subnet, gateway) {
		podmanUI.showSpinningModal(_('Setting up Integration'), _(
			'Setting up OpenWrt integration...'));

		// Check if network has any existing integration
		openwrtNetwork.isIntegrationComplete(name).then((status) => {
			// If any component exists, use repair (selective)
			// If nothing exists, use create (full integration)
			const hasAnyComponent = status.details.hasInterface || status.details.hasDevice;

			if (hasAnyComponent) {
				// Use repair - only add missing components
				return openwrtNetwork.repairIntegration(name, {
					bridgeName: bridgeName,
					subnet: subnet,
					gateway: gateway
				});
			} else {
				// Use create - full integration with firewall zone
				return openwrtNetwork.createIntegration(name, {
					bridgeName: bridgeName,
					subnet: subnet,
					gateway: gateway,
					zoneName: 'podman'
				});
			}
		}).then(() => {
			ui.hideModal();
			podmanUI.successTimeNotification(_(
					'OpenWrt integration for network "%s" created successfully')
				.format(name));

			const iconEl = document.getElementById('integration-icon-' + name);
			if (iconEl) {
				iconEl.style.display = 'none';
				iconEl.innerHTML = '';
			}
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to setup OpenWrt integration: %s')
				.format(err.message));
		});
	}
});
