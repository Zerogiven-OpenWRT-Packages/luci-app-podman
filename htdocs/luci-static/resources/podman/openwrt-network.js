'use strict';

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

return L.Class.extend({
	/**
	 * Create OpenWrt integration for Podman network.
	 *
	 * Creates bridge device, network interface with static IP, and adds to firewall zone.
	 * If zoneName is '_create_new_', creates zone named 'podman_<networkName>'.
	 * If zoneName is existing, adds network to that zone's network list.
	 *
	 * @param {string} networkName - Podman network name
	 * @param {Object} options - Network configuration
	 * @param {string} options.bridgeName - Bridge name (e.g., 'podman0')
	 * @param {string} options.subnet - Subnet CIDR (e.g., '10.129.0.0/24')
	 * @param {string} options.gateway - Gateway IP (e.g., '10.129.0.1')
	 * @param {string} [options.ipv6subnet] - Optional IPv6 subnet
	 * @param {string} [options.ipv6gateway] - Optional IPv6 gateway
	 * @param {string} [options.zoneName] - Zone name or '_create_new_' (default: '_create_new_')
	 * @returns {Promise<void>} Resolves when complete
	 */
	createIntegration: async function (networkName, options) {
		const bridgeName = options.bridgeName;
		const gateway = options.gateway;
		const prefix = cidrToPrefix(options.subnet);
		const netmask = network.prefixToMask(prefix);
		const requestedZone = options.zoneName || '_create_new_';
		const ZONE_NAME = requestedZone === '_create_new_' ? 'podman_' + networkName : requestedZone;

		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// Create bridge device if not exists
			const existingDevice = uci.get('network', bridgeName);
			if (!existingDevice) {
				uci.add('network', 'device', bridgeName);
				uci.set('network', bridgeName, 'type', 'bridge');
				uci.set('network', bridgeName, 'name', bridgeName);
				uci.set('network', bridgeName, 'bridge_empty', '1');
				uci.set('network', bridgeName, 'ipv6', '0');

				if (options.ipv6subnet) {
					uci.set('network', bridgeName, 'ipv6', '1');
					uci.set('network', bridgeName, 'ip6assign', '64');
				}
			}

			// Create network interface if not exists
			const existingInterface = uci.get('network', networkName);
			if (!existingInterface) {
				uci.add('network', 'interface', networkName);
				uci.set('network', networkName, 'proto', 'static');
				uci.set('network', networkName, 'device', bridgeName);
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
			return uci.apply(90);
		}).then(() => {
			return network.flushCache();
		});
	},

	/**
	 * Remove OpenWrt integration for Podman network.
	 *
	 * Removes network from its zone. If zone is empty AND starts with 'podman',
	 * removes zone and its DNS rule. Removes network interface and bridge device (if unused).
	 *
	 * @param {string} networkName - Podman network name
	 * @param {string} bridgeName - Bridge name
	 * @returns {Promise<void>} Resolves when complete
	 */
	removeIntegration: function (networkName, bridgeName) {
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
						return uci.get('firewall', s['.name'], 'name') === dnsRuleName;
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

			// Remove bridge device if not used by other interfaces
			const otherInterfaces = uci.sections('network', 'interface').filter((s) => {
				return uci.get('network', s['.name'], 'device') === bridgeName &&
					s['.name'] !== networkName;
			});

			if (otherInterfaces.length === 0) {
				const device = uci.get('network', bridgeName);
				if (device) {
					uci.remove('network', bridgeName);
				}
			}

			return uci.save();
		}).then(() => {
			return uci.apply(90);
		}).then(() => {
			return network.flushCache();
		});
	},

	/**
	 * Check if integration exists for network.
	 *
	 * @param {string} networkName - Podman network name
	 * @returns {Promise<boolean>} True if interface exists
	 */
	hasIntegration: function (networkName) {
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
	 * Verifies device, interface, and zone membership.
	 *
	 * @param {string} networkName - Podman network name
	 * @returns {Promise<Object>} {complete: boolean, missing: string[]}
	 */
	isIntegrationComplete: function (networkName) {
		const missing = [];

		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			const iface = uci.get('network', networkName);
			if (!iface) {
				missing.push('interface');
				return {
					complete: false,
					missing: missing
				};
			}

			const bridgeName = uci.get('network', networkName, 'device');

			if (bridgeName) {
				const device = uci.get('network', bridgeName);
				if (!device) {
					missing.push('device');
				}
			} else {
				missing.push('device');
			}

			// Find zone that contains this network
			const zones = uci.sections('firewall', 'zone');
			let foundInZone = false;

			for (const zone of zones) {
				const zoneName = uci.get('firewall', zone['.name'], 'name');
				if (!zoneName || !zoneName.startsWith('podman')) {
					continue;
				}

				const currentNetworks = uci.get('firewall', zone['.name'], 'network');
				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				if (networkList.includes(networkName)) {
					foundInZone = true;
					break;
				}
			}

			if (!foundInZone) {
				missing.push('zone_membership');
			}

			return {
				complete: missing.length === 0,
				missing: missing
			};
		}).catch(() => {
			return {
				complete: false,
				missing: ['unknown']
			};
		});
	},

	/**
	 * Get integration details for network.
	 *
	 * @param {string} networkName - Podman network name
	 * @returns {Promise<Object|null>} {networkName, bridgeName, gateway, netmask, proto} or null
	 */
	getIntegration: async function (networkName) {
		return uci.load('network').then(() => {
			const iface = uci.get('network', networkName);
			if (!iface) {
				return null;
			}

			return {
				networkName: networkName,
				bridgeName: uci.get('network', networkName, 'device'),
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
	listPodmanZones: function () {
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
		const errors = [];

		if (!networkName || !networkName.trim()) {
			errors.push(_('Network name is required'));
		}
		if (!options.bridgeName || !options.bridgeName.trim()) {
			errors.push(_('Bridge name is required'));
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

			const otherInterfaces = uci.sections('network', 'interface').filter((s) => {
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
	}
});
