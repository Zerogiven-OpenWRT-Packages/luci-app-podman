'use strict';

'require baseclass';
'require network';
'require uci';

/**
 * OpenWrt network/firewall integration for Podman networks.
 *
 * Automates OpenWrt configuration when Podman creates networks:
 * - Bridge device (/etc/config/network)
 * - Network interface with static IP
 * - Per-network or shared firewall zones with DNS access rules
 *
 * Supports both isolated (podman_<network>) and shared (podman) zones.
 * Layer 2 isolation is provided by separate bridge devices.
 */

/**
 * Extract IP from CIDR notation.
 * @param {string} cidr - CIDR (e.g., '10.129.0.0/24')
 * @returns {string} IP address
 */
function cidrToIP(cidr) {
	return cidr.split('/')[0];
}

/**
 * Extract prefix from CIDR notation.
 * @param {string} cidr - CIDR (e.g., '10.129.0.0/24')
 * @returns {number} Prefix length
 */
function cidrToPrefix(cidr) {
	const parts = cidr.split('/');
	return parts.length === 2 ? parseInt(parts[1]) : 24;
}

/**
 * Check if driver needs a bridge device.
 * @param {string} driver - Network driver (bridge, macvlan, ipvlan)
 * @returns {boolean} True if bridge is needed
 */
function needsBridge(driver) {
	return !driver || driver === 'bridge';
}

return baseclass.extend({
	/**
	 * Extract driver from Podman network object.
	 * @param {Object} network - Network object from Podman API
	 * @returns {string} Driver type (bridge, macvlan, ipvlan)
	 */
	getDriver: function (network) {
		return network.driver || network.Driver || 'bridge';
	},

	/**
	 * Extract device name based on driver.
	 * @param {Object} network - Network object from Podman API
	 * @param {string} name - Network name
	 * @returns {string} Device name (bridge name or parent interface)
	 */
	getDevice: function (network, name) {
		const driver = this.getDriver(network);

		if (driver === 'bridge') {
			return network.network_interface || (name + '0');
		}

		if (network.options && network.options.parent) {
			return network.options.parent;
		}
		return network.network_interface || (name + '0');
	},

	/**
	 * Create OpenWrt integration for Podman network.
	 *
	 * Creates network interface with static IP, and adds to firewall zone.
	 * For bridge driver: Creates bridge device and configures dnsmasq exclusion.
	 * For macvlan/ipvlan: Uses parent interface directly, no bridge needed.
	 * If zoneName is '_create_new_', creates zone named 'podman_<networkName>'.
	 * If zoneName is existing, adds network to that zone's network list.
	 *
	 * @param {string} networkName - Podman network name
	 * @param {Object} options - Network configuration
	 * @param {string} [options.driver] - Network driver (bridge, macvlan, ipvlan) - defaults to 'bridge'
	 * @param {string} [options.bridgeName] - Bridge name (required for bridge driver)
	 * @param {string} [options.parent] - Parent interface (required for macvlan/ipvlan)
	 * @param {string} options.subnet - Subnet CIDR (e.g., '10.129.0.0/24')
	 * @param {string} options.gateway - Gateway IP (e.g., '10.129.0.1')
	 * @param {string} [options.ipv6subnet] - Optional IPv6 subnet
	 * @param {string} [options.ipv6gateway] - Optional IPv6 gateway
	 * @param {string} [options.zoneName] - Zone name or '_create_new_' (default: '_create_new_')
	 * @returns {Promise<void>} Resolves when complete
	 */
	createIntegration: async function (networkName, options) {
		const driver = options.driver || 'bridge';
		const deviceName = needsBridge(driver) ? options.bridgeName : options.parent;
		const gateway = options.gateway;
		const prefix = cidrToPrefix(options.subnet);
		const netmask = network.prefixToMask(prefix);
		const requestedZone = options.zoneName || '_create_new_';
		const ZONE_NAME = requestedZone === '_create_new_' ? 'podman_' + networkName :
			requestedZone;

		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// Create bridge device ONLY for bridge networks
			if (needsBridge(driver)) {
				const existingDevice = uci.get('network', deviceName);
				if (!existingDevice) {
					uci.add('network', 'device', deviceName);
					uci.set('network', deviceName, 'type', 'bridge');
					uci.set('network', deviceName, 'name', deviceName);
					uci.set('network', deviceName, 'bridge_empty', '1');
					uci.set('network', deviceName, 'ipv6', '0');

					if (options.ipv6subnet) {
						uci.set('network', deviceName, 'ipv6', '1');
						uci.set('network', deviceName, 'ip6assign', '64');
					}
				}
			}

			// Create network interface (for ALL drivers)
			const existingInterface = uci.get('network', networkName);
			if (!existingInterface) {
				uci.add('network', 'interface', networkName);
				uci.set('network', networkName, 'proto', 'static');
				uci.set('network', networkName, 'device', deviceName);
				uci.set('network', networkName, 'ipaddr', gateway);
				uci.set('network', networkName, 'netmask', netmask);

				if (options.ipv6subnet && options.ipv6gateway) {
					uci.set('network', networkName, 'ip6addr', options.ipv6gateway +
						'/64');
				}
			}

			// Create or update firewall zone
			const existingZone = uci.sections('firewall', 'zone').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === ZONE_NAME;
			});

			if (!existingZone) {
				// Zone doesn't exist: create new zone with safe defaults
				const zoneId = uci.add('firewall', 'zone');
				uci.set('firewall', zoneId, 'name', ZONE_NAME);
				uci.set('firewall', zoneId, 'input', 'DROP');
				uci.set('firewall', zoneId, 'output', 'ACCEPT');
				uci.set('firewall', zoneId, 'forward', 'REJECT');
				uci.set('firewall', zoneId, 'network', [networkName]);
			} else {
				// Zone exists: add network to zone's network list
				const zoneSection = existingZone['.name'];
				const currentNetworks = uci.get('firewall', zoneSection, 'network');

				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				if (!networkList.includes(networkName)) {
					networkList.push(networkName);
					uci.set('firewall', zoneSection, 'network', networkList);
				}
			}

			// Ensure DNS rule exists for this zone
			const dnsRuleName = 'Allow-' + ZONE_NAME + '-DNS';
			const existingDnsRule = uci.sections('firewall', 'rule').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === dnsRuleName;
			});

			if (!existingDnsRule) {
				const ruleId = uci.add('firewall', 'rule');
				uci.set('firewall', ruleId, 'name', dnsRuleName);
				uci.set('firewall', ruleId, 'src', ZONE_NAME);
				uci.set('firewall', ruleId, 'dest_port', '53');
				uci.set('firewall', ruleId, 'target', 'ACCEPT');
			}

			return uci.save();
		}).then(() => {
			return uci.apply(true);
		}).then(() => {
			return network.flushCache();
		}).then(() => {
			// Configure dnsmasq ONLY for bridge networks
			if (needsBridge(driver)) {
				return this._configureDnsmasq(networkName, true);
			}
		});
	},

	/**
	 * Remove OpenWrt integration for Podman network.
	 *
	 * Removes network from its zone. If zone is empty AND starts with 'podman',
	 * removes zone and its DNS rule. Removes network interface and bridge device (if unused).
	 * For macvlan/ipvlan: Only removes interface and zone membership (no bridge cleanup).
	 *
	 * @param {string} networkName - Podman network name
	 * @param {string} deviceName - Device name (bridge name or parent interface)
	 * @param {string} [driver] - Network driver (bridge, macvlan, ipvlan) - defaults to 'bridge'
	 * @returns {Promise<void>} Resolves when complete
	 */
	removeIntegration: async function (networkName, deviceName, driver) {
		driver = driver || 'bridge';
		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// Find which zone this network belongs to
			const zones = uci.sections('firewall', 'zone');
			let networkZone = null;
			let zoneName = null;

			for (const zone of zones) {
				const zoneSection = zone['.name'];
				const currentNetworks = uci.get('firewall', zoneSection, 'network');

				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				if (networkList.includes(networkName)) {
					networkZone = zoneSection;
					zoneName = uci.get('firewall', zoneSection, 'name');
					break;
				}
			}

			if (networkZone) {
				const currentNetworks = uci.get('firewall', networkZone, 'network');
				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				networkList = networkList.filter((n) => n !== networkName);

				if (networkList.length > 0) {
					// Zone has other networks: just remove this network
					uci.set('firewall', networkZone, 'network', networkList);
				} else if (zoneName && zoneName.startsWith('podman')) {
					// Last network in podman* zone: remove zone and DNS rule
					uci.remove('firewall', networkZone);

					const dnsRuleName = 'Allow-' + zoneName + '-DNS';
					const dnsRule = uci.sections('firewall', 'rule').find((s) => {
						return uci.get('firewall', s['.name'], 'name') ===
							dnsRuleName;
					});
					if (dnsRule) {
						uci.remove('firewall', dnsRule['.name']);
					}
				} else {
					// Non-podman zone: just remove network from list
					uci.set('firewall', networkZone, 'network', networkList);
				}
			}

			// Remove network interface
			const iface = uci.get('network', networkName);
			if (iface) {
				uci.remove('network', networkName);
			}

			// Remove bridge device ONLY for bridge networks and if not used by others
			let shouldRemoveBridge = false;
			if (needsBridge(driver)) {
				const otherInterfaces = uci.sections('network', 'interface').filter((
					s) => {
					return uci.get('network', s['.name'], 'device') ===
						deviceName &&
						s['.name'] !== networkName;
				});

				shouldRemoveBridge = otherInterfaces.length === 0;

				if (shouldRemoveBridge) {
					const device = uci.get('network', deviceName);
					if (device) {
						uci.remove('network', deviceName);
					}
				}
			}

			return {
				shouldRemoveBridge: shouldRemoveBridge
			};
		}).then((result) => {
			return uci.save().then(() => result);
		}).then((result) => {
			return uci.apply(true).then(() => result);
		}).then((result) => {
			return network.flushCache().then(() => result);
		}).then((result) => {
			// Remove dnsmasq exclusion ONLY for bridge networks if bridge was deleted
			if (needsBridge(driver) && result.shouldRemoveBridge) {
				return this._configureDnsmasq(networkName, false);
			}
		});
	},

	/**
	 * Check if integration exists for network.
	 *
	 * @param {string} networkName - Podman network name
	 * @returns {Promise<boolean>} True if interface exists
	 */
	hasIntegration: async function (networkName) {
		return uci.load('network').then(() => {
			const iface = uci.get('network', networkName);
			return !!iface;
		}).catch(() => {
			return false;
		});
	},

	/**
	 * Check if integration is complete (all components exist).
	 *
	 * Verifies interface, and for bridge networks also checks device and dnsmasq exclusion.
	 * Does NOT check firewall zones (user's choice).
	 *
	 * @param {string} networkName - Podman network name
	 * @param {string} [driver] - Network driver (bridge, macvlan, ipvlan) - defaults to 'bridge'
	 * @returns {Promise<Object>} {complete: boolean, missing: string[], details: object}
	 */
	isIntegrationComplete: async function (networkName, driver) {
		driver = driver || 'bridge';
		const missing = [];
		const details = {
			hasInterface: false,
			hasDevice: false,
			hasDnsmasqExclusion: false,
			driver: driver
		};

		return Promise.all([
			uci.load('network'),
			uci.load('dhcp')
		]).then(() => {
			// Check interface
			const iface = uci.get('network', networkName);
			if (!iface) {
				missing.push('interface');
			} else {
				details.hasInterface = true;
			}

			// Check device
			const deviceName = uci.get('network', networkName, 'device');
			if (deviceName) {
				if (needsBridge(driver)) {
					// For bridge networks: Check bridge device exists
					const device = uci.get('network', deviceName);
					if (!device) {
						missing.push('device');
					} else {
						const deviceType = uci.get('network', deviceName, 'type');
						if (deviceType !== 'bridge') {
							missing.push('device'); // Device exists but not a bridge
						} else {
							details.hasDevice = true;

							// Check dnsmasq exclusion (only for bridge networks)
							const dnsmasqSections = uci.sections('dhcp', 'dnsmasq');
							if (dnsmasqSections.length > 0) {
								const mainSection = dnsmasqSections[0]['.name'];
								const notinterfaces = uci.get('dhcp', mainSection,
									'notinterface');

								let isExcluded = false;
								if (Array.isArray(notinterfaces)) {
									isExcluded = notinterfaces.includes(networkName);
								} else if (notinterfaces) {
									isExcluded = notinterfaces === networkName;
								}

								if (isExcluded) {
									details.hasDnsmasqExclusion = true;
								} else {
									missing.push('dnsmasq');
								}
							} else {
								// dnsmasq not configured - this is OK
								details.hasDnsmasqExclusion = true;
							}
						}
					}
				} else {
					// For macvlan/ipvlan: Device name is parent interface
					// We can't easily verify if parent is a real physical interface,
					// so assume if deviceName is set, it's OK
					details.hasDevice = true;
					details.hasDnsmasqExclusion =
						true; // Not applicable for macvlan/ipvlan
				}
			} else {
				missing.push('device');
			}

			return {
				complete: missing.length === 0,
				missing: missing,
				details: details
			};
		}).catch(() => {
			return {
				complete: false,
				missing: ['unknown'],
				details: details
			};
		});
	},

	/**
	 * Get integration details for network.
	 *
	 * @param {string} networkName - Podman network name
	 * @returns {Promise<Object|null>} {networkName, deviceName, gateway, netmask, proto} or null
	 */
	getIntegration: async function (networkName) {
		return uci.load('network').then(() => {
			const iface = uci.get('network', networkName);
			if (!iface) {
				return null;
			}

			return {
				networkName: networkName,
				deviceName: uci.get('network', networkName, 'device'),
				gateway: uci.get('network', networkName, 'ipaddr'),
				netmask: uci.get('network', networkName, 'netmask'),
				proto: uci.get('network', networkName, 'proto')
			};
		}).catch(() => {
			return null;
		});
	},

	/**
	 * List existing podman* firewall zones.
	 *
	 * Returns zones whose names start with 'podman' (e.g., 'podman', 'podman_frontend', 'podman-iot').
	 *
	 * @returns {Promise<Array<string>>} Array of zone names
	 */
	listPodmanZones: async function () {
		return uci.load('firewall').then(() => {
			const zones = uci.sections('firewall', 'zone');
			const podmanZones = [];

			zones.forEach((zone) => {
				const zoneName = uci.get('firewall', zone['.name'], 'name');
				if (zoneName && zoneName.startsWith('podman')) {
					podmanZones.push(zoneName);
				}
			});

			return podmanZones;
		}).catch(() => {
			return [];
		});
	},

	/**
	 * Validate network configuration before creating integration.
	 *
	 * Checks required fields, CIDR/IP format, and conflicts with existing interfaces.
	 *
	 * @param {string} networkName - Network name
	 * @param {Object} options - Network configuration
	 * @returns {Promise<Object>} {valid: boolean, errors: string[]}
	 */
	validateIntegration: async function (networkName, options) {
		const driver = options.driver || 'bridge';
		const errors = [];

		if (!networkName || !networkName.trim()) {
			errors.push(_('Network name is required'));
		}

		// Validate based on driver
		if (needsBridge(driver)) {
			if (!options.bridgeName || !options.bridgeName.trim()) {
				errors.push(_('Bridge name is required'));
			}
		} else {
			if (!options.parent || !options.parent.trim()) {
				errors.push(_('Parent interface is required for macvlan/ipvlan networks'));
			}
		}

		if (!options.subnet || !options.subnet.trim()) {
			errors.push(_('Subnet is required'));
		}
		if (!options.gateway || !options.gateway.trim()) {
			errors.push(_('Gateway is required'));
		}

		if (options.subnet && !options.subnet.match(/^\d+\.\d+\.\d+\.\d+\/\d+$/)) {
			errors.push(_('Subnet must be in CIDR notation (e.g., 10.129.0.0/24)'));
		}

		if (options.gateway && !options.gateway.match(/^\d+\.\d+\.\d+\.\d+$/)) {
			errors.push(_('Gateway must be a valid IP address'));
		}

		if (errors.length > 0) {
			return Promise.resolve({
				valid: false,
				errors: errors
			});
		}

		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			const existingInterface = uci.get('network', networkName);
			if (existingInterface) {
				const existingProto = uci.get('network', networkName, 'proto');
				// Only warn if it's not already a static interface (might be existing integration)
				if (existingProto !== 'static') {
					errors.push(_('Network interface "%s" already exists with proto "%s"')
						.format(networkName, existingProto));
				}
			}

			// Check device conflicts only for bridge networks
			if (needsBridge(driver) && options.bridgeName) {
				const otherInterfaces = uci.sections('network', 'interface').filter((
					s) => {
					return uci.get('network', s['.name'], 'device') === options
						.bridgeName &&
						s['.name'] !== networkName;
				});

				if (otherInterfaces.length > 0) {
					errors.push(_('Bridge "%s" is already used by interface "%s"').format(
						options.bridgeName,
						otherInterfaces[0]['.name']
					));
				}
			}

			return {
				valid: errors.length === 0,
				errors: errors
			};
		}).catch((err) => {
			errors.push(_('Failed to validate: %s').format(err.message));
			return {
				valid: false,
				errors: errors
			};
		});
	},

	/**
	 * Repair OpenWrt integration by adding only missing components.
	 *
	 * Does NOT touch existing configurations. Only adds what's missing.
	 * Does NOT manage firewall zones (user's responsibility).
	 *
	 * @param {string} networkName - Podman network name
	 * @param {Object} options - Network configuration
	 * @param {string} [options.driver] - Network driver (bridge, macvlan, ipvlan) - defaults to 'bridge'
	 * @param {string} [options.bridgeName] - Bridge name (required for bridge networks)
	 * @param {string} [options.parent] - Parent interface (required for macvlan/ipvlan)
	 * @param {string} [options.subnet] - Subnet CIDR (only needed if creating interface)
	 * @param {string} [options.gateway] - Gateway IP (only needed if creating interface)
	 * @returns {Promise<Object>} {added: string[], skipped: string[]}
	 */
	repairIntegration: async function (networkName, options) {
		const driver = options.driver || 'bridge';
		const deviceName = needsBridge(driver) ? options.bridgeName : options.parent;
		const added = [];
		const skipped = [];

		// Check what's missing
		const status = await this.isIntegrationComplete(networkName, driver);

		if (status.complete) {
			return {
				added: [],
				skipped: ['complete'],
				details: status.details
			};
		}

		return Promise.all([
			uci.load('network'),
			uci.load('dhcp')
		]).then(() => {
			// Repair device ONLY for bridge networks if missing
			if (!status.details.hasDevice && needsBridge(driver)) {
				const existingDevice = uci.get('network', deviceName);
				if (!existingDevice) {
					uci.add('network', 'device', deviceName);
					uci.set('network', deviceName, 'type', 'bridge');
					uci.set('network', deviceName, 'name', deviceName);
					uci.set('network', deviceName, 'bridge_empty', '1');
					uci.set('network', deviceName, 'ipv6', '0');
					added.push('device');
				} else {
					skipped.push('device');
				}
			} else {
				skipped.push('device');
			}

			// Repair interface if missing
			if (!status.details.hasInterface) {
				const existingInterface = uci.get('network', networkName);
				if (!existingInterface) {
					const gateway = options.gateway;
					const prefix = cidrToPrefix(options.subnet);
					const netmask = network.prefixToMask(prefix);

					uci.add('network', 'interface', networkName);
					uci.set('network', networkName, 'proto', 'static');
					uci.set('network', networkName, 'device', deviceName);
					uci.set('network', networkName, 'ipaddr', gateway);
					uci.set('network', networkName, 'netmask', netmask);
					added.push('interface');
				} else {
					skipped.push('interface');
				}
			} else {
				skipped.push('interface');
			}

			// No changes
			if (added.length <= 0) {
				return;
			}
			return uci.save();
		}).then(() => {
			if (added.length <= 0) {
				return;
			}
			return uci.apply(true);
		}).then(() => {
			if (added.length <= 0) {
				return;
			}
			return network.flushCache();
		}).then(() => {
			// Repair dnsmasq ONLY for bridge networks if missing
			if (!status.details.hasDnsmasqExclusion && needsBridge(driver)) {
				return this._configureDnsmasq(networkName, true).then(() => {
					added.push('dnsmasq');
				});
			}
			skipped.push('dnsmasq');
		}).then(() => {
			return {
				added: added,
				skipped: skipped,
				details: status.details
			};
		});
	},

	/**
	 * Configure dnsmasq to exclude (or include) an interface.
	 *
	 * Prevents dnsmasq from binding to port 53 on Podman bridges, allowing
	 * Podman's aardvark-dns service to handle container DNS resolution.
	 *
	 * @param {string} interfaceName - UCI interface name (e.g., 'podman')
	 * @param {boolean} enable - true to exclude, false to remove exclusion
	 * @returns {Promise<void>}
	 */
	_configureDnsmasq: async function (interfaceName, enable) {
		return uci.load('dhcp').then(() => {
			// Get main dnsmasq config section
			const dnsmasqSections = uci.sections('dhcp', 'dnsmasq');

			// Skip if dnsmasq is not configured (e.g., router uses odhcpd only)
			if (dnsmasqSections.length === 0) {
				console.log('dnsmasq not configured, skipping exclusion setup');
				return {
					skip: true
				};
			}

			let mainSection = dnsmasqSections[0]['.name'];

			// Get current notinterface list
			let notinterfaces = uci.get('dhcp', mainSection, 'notinterface');
			let notinterfaceList = [];

			if (Array.isArray(notinterfaces)) {
				notinterfaceList = notinterfaces;
			} else if (notinterfaces) {
				notinterfaceList = [notinterfaces];
			}

			if (enable) {
				// Add to exclusion list if not present
				if (!notinterfaceList.includes(interfaceName)) {
					notinterfaceList.push(interfaceName);
					uci.set('dhcp', mainSection, 'notinterface', notinterfaceList);
				}
			} else {
				// Remove from exclusion list
				const filtered = notinterfaceList.filter(iface => iface !==
					interfaceName);
				if (filtered.length > 0) {
					uci.set('dhcp', mainSection, 'notinterface', filtered);
				} else {
					// Remove option entirely if list is empty
					uci.unset('dhcp', mainSection, 'notinterface');
				}
			}

			return {
				skip: false
			};
		}).then((result) => {
			if (result.skip) {
				return result;
			}
			return uci.save().then(() => result);
		}).then((result) => {
			if (result.skip) {
				return result;
			}
			return uci.apply(true);
		});
	},

	/**
	 * Check if interface is excluded from dnsmasq.
	 *
	 * @param {string} interfaceName - UCI interface name (e.g., 'podman')
	 * @returns {Promise<boolean>}
	 */
	_isDnsmasqExcluded: async function (interfaceName) {
		return uci.load('dhcp').then(() => {
			const dnsmasqSections = uci.sections('dhcp', 'dnsmasq');
			if (dnsmasqSections.length === 0) {
				return false;
			}

			const mainSection = dnsmasqSections[0]['.name'];
			const notinterfaces = uci.get('dhcp', mainSection, 'notinterface');

			if (Array.isArray(notinterfaces)) {
				return notinterfaces.includes(interfaceName);
			} else if (notinterfaces) {
				return notinterfaces === interfaceName;
			}

			return false;
		}).catch(() => {
			return false;
		});
	}
});
