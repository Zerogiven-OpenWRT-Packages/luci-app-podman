'use strict';

'require network';
'require uci';

/**
 * OpenWrt network/firewall integration for Podman networks.
 *
 * Automates OpenWrt configuration when Podman creates networks:
 * - Bridge device (/etc/config/network)
 * - Network interface with static IP
 * - Shared 'podman' firewall zone with DNS access rule
 *
 * All Podman networks share a single firewall zone for simplified management.
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
	 * Creates bridge device, network interface with static IP, and adds to shared
	 * 'podman' firewall zone. If this is the first Podman network, creates the zone
	 * and DNS access rule.
	 *
	 * @param {string} networkName - Podman network name
	 * @param {Object} options - Network configuration
	 * @param {string} options.bridgeName - Bridge name (e.g., 'podman0')
	 * @param {string} options.subnet - Subnet CIDR (e.g., '10.129.0.0/24')
	 * @param {string} options.gateway - Gateway IP (e.g., '10.129.0.1')
	 * @param {string} [options.ipv6subnet] - Optional IPv6 subnet
	 * @param {string} [options.ipv6gateway] - Optional IPv6 gateway
	 * @returns {Promise<void>} Resolves when complete
	 */
	createIntegration: async function (networkName, options) {
		const bridgeName = options.bridgeName;
		const gateway = options.gateway;
		const prefix = cidrToPrefix(options.subnet);
		const netmask = network.prefixToMask(prefix);
		const ZONE_NAME = 'podman';

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

			// Create or update shared 'podman' firewall zone
			const existingZone = uci.sections('firewall', 'zone').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === ZONE_NAME;
			});

			if (!existingZone) {
				// First Podman network: create zone and DNS rule
				const zoneId = uci.add('firewall', 'zone', 'podman_zone');
				uci.set('firewall', zoneId, 'name', ZONE_NAME);
				uci.set('firewall', zoneId, 'input', 'DROP');
				uci.set('firewall', zoneId, 'output', 'ACCEPT');
				uci.set('firewall', zoneId, 'forward', 'REJECT');
				uci.set('firewall', zoneId, 'network', [networkName]);

				const ruleId = uci.add('firewall', 'rule', 'podman_dns');
				uci.set('firewall', ruleId, 'name', 'Allow-Podman-DNS');
				uci.set('firewall', ruleId, 'src', ZONE_NAME);
				uci.set('firewall', ruleId, 'dest_port', '53');
				uci.set('firewall', ruleId, 'target', 'ACCEPT');
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
	 * Removes network from shared zone. If last network in zone, removes zone and
	 * DNS rule. Removes network interface and bridge device (if unused).
	 *
	 * @param {string} networkName - Podman network name
	 * @param {string} bridgeName - Bridge name
	 * @returns {Promise<void>} Resolves when complete
	 */
	removeIntegration: function (networkName, bridgeName) {
		const ZONE_NAME = 'podman';

		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// Remove network from shared 'podman' zone
			const zone = uci.sections('firewall', 'zone').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === ZONE_NAME;
			});

			if (zone) {
				const zoneSection = zone['.name'];
				const currentNetworks = uci.get('firewall', zoneSection, 'network');

				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				networkList = networkList.filter((n) => n !== networkName);

				if (networkList.length > 0) {
					uci.set('firewall', zoneSection, 'network', networkList);
				} else {
					// Last network: remove zone and DNS rule
					uci.remove('firewall', zoneSection);

					const dnsRule = uci.sections('firewall', 'rule').find((s) => {
						return uci.get('firewall', s['.name'], 'name') ===
							'Allow-Podman-DNS';
					});
					if (dnsRule) {
						uci.remove('firewall', dnsRule['.name']);
					}
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
		const ZONE_NAME = 'podman';
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

			const zone = uci.sections('firewall', 'zone').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === ZONE_NAME;
			});

			if (!zone) {
				missing.push('zone');
			} else {
				const currentNetworks = uci.get('firewall', zone['.name'], 'network');
				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				if (!networkList.includes(networkName)) {
					missing.push('zone_membership');
				}
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
