'use strict';

'require baseclass';
'require form';
'require ui';
'require uci';
'require network';

'require podman.openwrt-network as openwrtNetwork';
'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';
'require podman.ipv6 as ipv6';

/**
 * Check if a device is a valid parent interface for macvlan/ipvlan
 * @param {LuCI.network.Device} device - Network device
 * @returns {boolean} True if valid parent
 */
function isValidParentDevice(device) {
	const type = device.getType();
	const name = device.getName();

	if (!['ethernet', 'bridge', 'vlan'].includes(type) ||
		name === 'lo' ||
		name.match(/^(podman|cni-|docker|veth)/)) {
		return false;
	}

	return true;
}

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormNetwork',
		map: null,

		/**
		 * Render the network creation form
		 * @returns {Promise<HTMLElement>} Rendered form element
		 */
		render: async function () {
			// Create data as instance property (not prototype)
			this.data = {
				network: {
					name: null,
					driver: 'bridge',
					subnet: null,
					gateway: null,
					ip_range: null,
					ipv6: '0',
					internal: '0',
					labels: null,
					setup_openwrt: '1',
					firewall_zone: '_create_new_'
				}
			};

			// Load existing podman zones and network devices before rendering form
			return Promise.all([
				openwrtNetwork.listPodmanZones().catch(() => []),
				network.getDevices().catch(() => [])
			]).then(([zones, devices]) => {
				this.existingZones = zones;
				// Filter to valid parent interfaces
				this.parentDevices = devices.filter(isValidParentDevice);
				return this.showFormModal();
			});
		},

		/**
		 * Display the network creation form modal
		 * @returns {Promise<HTMLElement>} Rendered form element
		 */
		showFormModal: function () {
			this.map = new form.JSONMap(this.data, _('Create %s').format(_('Network')), '');
			const section = this.map.section(form.NamedSection, 'network', 'network');

			let field;
			field = section.option(form.Value, 'name', _('Network Name'));
			field.placeholder = 'my-network';
			field.datatype = 'maxlength(253)';
			field.description = _('Name for the network');
			field.rmempty = false;

			field = section.option(form.ListValue, 'driver', _('Driver'));
			field.value('bridge', 'bridge');
			field.value('macvlan', 'macvlan');
			field.value('ipvlan', 'ipvlan');
			field.description = _('Network driver');

			field = section.option(form.ListValue, 'parent', _('Parent Interface'));
			field.depends('driver', 'macvlan');
			field.depends('driver', 'ipvlan');
			field.description = _('Existing physical interface to use as parent. Required for macvlan/ipvlan networks.');
			// Populate with available parent interfaces
			if (this.parentDevices && this.parentDevices.length > 0) {
				this.parentDevices.forEach((device) => {
					const name = device.getName();
					field.value(name, name + ' (' + device.getType() + ')');
				});
			} else {
				field.value('', _('No suitable interfaces found'));
			}

			field = section.option(form.Value, 'subnet', _('IPv4 Subnet (CIDR)'));
			field.placeholder = '10.89.0.0/24';
			field.datatype = 'cidr4';
			field.description = _('IPv4 subnet in CIDR notation');
			field.rmempty = false;

			field = section.option(form.Value, 'gateway', _('IPv4 Gateway'));
			field.placeholder = '10.89.0.1';
			field.optional = true;
			field.datatype = 'ip4addr';
			field.description = _('IPv4 gateway address');

			field = section.option(form.Value, 'ip_range', _('IP Range (CIDR)'));
			field.placeholder = '10.89.0.0/28';
			field.optional = true;
			field.datatype = 'cidr4';
			field.description = _('Allocate container IP from this range');

			field = section.option(form.Flag, 'ipv6', _('Enable IPv6'));
			field.description = _('Enable IPv6 networking');

			field = section.option(form.Flag, 'internal', _('Internal Network'));
			field.description = _('Restrict external access to the network');

			field = section.option(form.Flag, 'setup_openwrt', _('Setup OpenWrt Integration'));
			field.description = _(
				'Automatically configure OpenWrt network interface, bridge, and firewall zone. <strong>Highly recommended</strong> for proper container networking on OpenWrt.'
			);

			field = section.option(form.Value, 'bridge_name', _('Bridge Interface Name'));
			field.placeholder = _('Leave empty to auto-generate');
			field.optional = true;
			field.datatype = 'netdevname';
			field.depends({ 'setup_openwrt': '1', 'driver': 'bridge' });
			field.description = _(
				'Name of the bridge interface (e.g., podman0, mynet0). Leave empty to use: &lt;network-name&gt;0. Note: If the generated name conflicts with an existing interface, OpenWrt will auto-increment it.'
			);

			field = section.option(form.ListValue, 'firewall_zone', _('Firewall Zone'));
			field.value('_create_new_', _('Create new zone (will be named: podman_<network-name>)'));
			// Add existing podman* zones
			if (this.existingZones && this.existingZones.length > 0) {
				this.existingZones.forEach((zoneName) => {
					field.value(zoneName, zoneName);
				});
			}
			field.depends('setup_openwrt', '1');
			field.description = _(
				'Choose firewall zone for this network. New zones use safe defaults: input DROP, output ACCEPT, forward REJECT. ' +
				'You can customize zone policies later in Firewall settings.'
			);

			field = section.option(form.TextValue, 'labels', _('Labels'));
			field.placeholder = 'key1=value1\nkey2=value2';
			field.rows = 3;
			field.optional = true;
			field.description = _('Labels in key=value format, one per line');

			this.map.render().then((formElement) => {
				ui.showModal('', [
					formElement,
					new podmanUI.ModalButtons({
						confirmText: _('Create %s').format('').trim(),
						onConfirm: () => this.handleCreate(),
						onCancel: () => ui.hideModal()
					}).render()
				]);

				requestAnimationFrame(() => {
					const nameInput = document.querySelector('input[name="name"]');
					if (nameInput) nameInput.focus();
				});
			});
		},

		/**
		 * Parse form data, create Podman network, and optionally setup OpenWrt integration
		 */
		handleCreate: function () {
			const ulaPrefix = uci.get('network', 'globals', 'ula_prefix');
			this.map.save().then(() => {
				const podnetwork = this.map.data.data.network;
				const setupOpenwrt = podnetwork.setup_openwrt === '1';
				const driver = podnetwork.driver || 'bridge';
				const bridgeName = podnetwork.bridge_name || (podnetwork.name + '0');

				// Validate parent for macvlan/ipvlan
				if (driver === 'macvlan' || driver === 'ipvlan') {
					if (!podnetwork.parent) {
						podmanUI.errorNotification(_(
							'Parent interface is required for macvlan/ipvlan networks'));
						return;
					}
					if (podnetwork.parent === '') {
						podmanUI.errorNotification(_(
							'No suitable parent interfaces available on this system'));
						return;
					}
				}

				if (setupOpenwrt && !podnetwork.subnet) {
					podmanUI.errorNotification(_(
						'OpenWrt integration requires subnet to be specified'));
					return;
				}

			// Auto-generate gateway: increment last octet by 1 (e.g., 10.89.0.0 → 10.89.0.1)
				if (!podnetwork.gateway && podnetwork.subnet) {
					const regex = new RegExp('(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.)(\\d{1,3})',
						'gm')
					podnetwork.gateway = podnetwork.subnet.replace(regex, (m, g1, g2) => g1 +
						(Number(g2) + 1)).replace(/\/\d+$/, '');
				}

				const payload = {
					name: podnetwork.name,
					driver: driver
				};

				// Set network_interface based on driver
				if (driver === 'bridge') {
					payload.network_interface = bridgeName;
				} else if (driver === 'macvlan' || driver === 'ipvlan') {
					// For macvlan/ipvlan, network_interface is the parent interface
					payload.network_interface = podnetwork.parent;
				}

			if (podnetwork.subnet) {
					payload.subnets = [{
						subnet: podnetwork.subnet
					}];
					if (podnetwork.gateway) payload.subnets[0].gateway = podnetwork.gateway;
					if (podnetwork.ip_range) payload.subnets[0].lease_range = {
						start_ip: '',
						end_ip: ''
					};
				}

				payload.ipv6_enabled = false;
				if (podnetwork.ipv6 === '1') {
					const ipv6obj = ipv6.deriveUlaFromIpv4(podnetwork.subnet, ulaPrefix);

					podnetwork.ipv6subnet = ipv6obj.ipv6subnet;
					podnetwork.ipv6gateway = ipv6obj.ipv6gateway;

					payload.ipv6_enabled = true;

					if (podnetwork.subnet) {
						payload.subnets.push({
							subnet: ipv6obj.ipv6subnet
						});
						if (podnetwork.gateway) payload.subnets[1].gateway = ipv6obj
							.ipv6gateway;
					}
				}

				payload.internal = podnetwork.internal === '1';
				if (podnetwork.labels) {
					payload.labels = {};
					podnetwork.labels.split('\n').forEach((line) => {
						const parts = line.split('=');
						if (parts.length >= 2) {
							const key = parts[0].trim();
							const value = parts.slice(1).join('=').trim();
							if (key) payload.labels[key] = value;
						}
					});
				}

				ui.hideModal();
				podmanUI.showSpinningModal(_('Creating %s').format(_('Network')), _('Creating %s...').format(_('Network').toLowerCase()));

				podmanRPC.network.create(JSON.stringify(payload)).then((result) => {
					if (result && result.error) {
						ui.hideModal();
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Network').toLowerCase(), result.error));
						return Promise.reject(new Error(
							'Podman network creation failed'));
					}
					if (result && result.message && result.response >= 400) {
						ui.hideModal();
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Network').toLowerCase(), result.message));
						return Promise.reject(new Error(
							'Podman network creation failed'));
					}
					if (result && result.cause) {
						ui.hideModal();
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Network').toLowerCase(), result.cause));
						return Promise.reject(new Error(
							'Podman network creation failed'));
					}

					if (setupOpenwrt) {
						ui.hideModal();
						podmanUI.showSpinningModal(_('Creating %s').format(_('Network')), _(
							'Setting up OpenWrt integration...'));

						const openwrtOptions = {
							driver: driver,
							subnet: podnetwork.subnet,
							gateway: podnetwork.gateway,
							ipv6subnet: podnetwork.ipv6subnet || null,
							ipv6gateway: podnetwork.ipv6gateway || null,
							zoneName: podnetwork.firewall_zone || '_create_new_'
						};

						// Set device name based on driver
						if (driver === 'bridge') {
							openwrtOptions.bridgeName = bridgeName;
						} else {
							openwrtOptions.parent = podnetwork.parent;
						}

						return openwrtNetwork.createIntegration(podnetwork.name, openwrtOptions).then(() => {
							return {
								podmanCreated: true,
								openwrtCreated: true
							};
						}).catch((err) => {
							return {
								podmanCreated: true,
								openwrtCreated: false,
								openwrtError: err.message
							};
						});
					} else {
						return {
							podmanCreated: true,
							openwrtCreated: false
						};
					}
				}).then((status) => {
					ui.hideModal();

					if (status.podmanCreated && status.openwrtCreated) {
						podmanUI.successTimeNotification(_(
							'Network and OpenWrt integration created successfully'
						));
					} else if (status.podmanCreated && !status.openwrtCreated &&
						status.openwrtError) {
						podmanUI.warningNotification(_(
							'Network created but OpenWrt integration failed: %s. You may need to configure OpenWrt manually.'
						).format(status.openwrtError));
					} else if (status.podmanCreated) {
						podmanUI.successTimeNotification(_(
							'%s created successfully').format(_('Network')));
					}

					this.submit();
				}).catch((err) => {
					ui.hideModal();
					if (err.message !== 'Podman network creation failed') {
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Network').toLowerCase(), err.message));
					}
				});
			}).catch(() => { });
		},

		submit: () => { },
	})
});
