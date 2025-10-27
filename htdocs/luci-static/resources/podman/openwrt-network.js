'use strict';
'require network';
'require firewall as fwall';
'require uci';

/**
 * @file OpenWrt Network Integration Helper
 * @module podman.openwrt-network
 * @description Provides integration between Podman networks and OpenWrt network/firewall configuration.
 *
 * When Podman creates a network, it needs matching OpenWrt configuration:
 * 1. Bridge device in /etc/config/network
 * 2. Network interface with static IP
 * 3. Firewall zone for the network
 * 4. Firewall rules (e.g., DNS access)
 *
 * This module automates the creation/deletion of these OpenWrt configurations.
 *
 * @usage
 * 'require podman.openwrt-network as openwrtNetwork';
 *
 * // Create OpenWrt integration for a Podman network
 * openwrtNetwork.createIntegration('mynetwork', {
 *     bridgeName: 'podman0',
 *     subnet: '10.129.0.0/24',
 *     gateway: '10.129.0.1'
 * }).then(() => {
 *     console.log('OpenWrt integration created');
 * });
 *
 * // Remove OpenWrt integration
 * openwrtNetwork.removeIntegration('mynetwork', 'podman0').then(() => {
 *     console.log('OpenWrt integration removed');
 * });
 *
 * // Check if integration exists
 * openwrtNetwork.hasIntegration('mynetwork').then((exists) => {
 *     console.log('Integration exists:', exists);
 * });
 */

/**
 * Calculate netmask from CIDR notation
 * @param {string} cidr - CIDR notation (e.g., '10.129.0.0/24')
 * @returns {string} Netmask (e.g., '255.255.255.0')
 */
function cidrToNetmask(cidr) {
	const parts = cidr.split('/');
	if (parts.length !== 2) {
		return '255.255.255.0'; // Default fallback
	}

	const prefix = parseInt(parts[1]);
	return network.prefixToMask(prefix);
}

/**
 * Extract IP address from CIDR notation
 * @param {string} cidr - CIDR notation (e.g., '10.129.0.0/24')
 * @returns {string} IP address without prefix
 */
function cidrToIP(cidr) {
	return cidr.split('/')[0];
}

return L.Class.extend({
	/**
	 * Create OpenWrt network integration for a Podman network.
	 * Uses a shared 'podman' firewall zone for all Podman networks.
	 * This creates:
	 * - Bridge device
	 * - Network interface with static IP
	 * - Adds interface to shared 'podman' firewall zone
	 * - Creates zone + DNS rule if this is the first Podman network
	 *
	 * @param {string} networkName - Name of the Podman network
	 * @param {Object} options - Network configuration options
	 * @param {string} options.bridgeName - Name of the bridge interface (e.g., 'podman0')
	 * @param {string} options.subnet - Network subnet in CIDR notation (e.g., '10.129.0.0/24')
	 * @param {string} options.gateway - Gateway IP address (e.g., '10.129.0.1')
	 * @returns {Promise<void>} Resolves when integration is created
	 *
	 * @example
	 * createIntegration('mynetwork', {
	 *     bridgeName: 'podman0',
	 *     subnet: '10.129.0.0/24',
	 *     gateway: '10.129.0.1'
	 * }).then(() => {
	 *     console.log('Integration created successfully');
	 * }).catch((err) => {
	 *     console.error('Failed to create integration:', err);
	 * });
	 */
	createIntegration: async function(networkName, options) {
		const bridgeName = options.bridgeName;
		const gateway = options.gateway;
		const netmask = cidrToNetmask(options.subnet);
		const ZONE_NAME = 'podman';

		// Load required UCI configurations
		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// 1. Create bridge device
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

			// 2. Create network interface
			const existingInterface = uci.get('network', networkName);
			if (!existingInterface) {
				uci.add('network', 'interface', networkName);
				uci.set('network', networkName, 'proto', 'static');
				uci.set('network', networkName, 'device', bridgeName);
				uci.set('network', networkName, 'ipaddr', gateway);
				uci.set('network', networkName, 'netmask', netmask);

				if (options.ipv6subnet && options.ipv6gateway) {
					uci.set('network', networkName, 'ip6addr', options.ipv6gateway + '/64');
				}
			}

			// 3. Check if shared 'podman' zone exists
			const existingZone = uci.sections('firewall', 'zone').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === ZONE_NAME;
			});

			if (!existingZone) {
				// Create shared zone for first Podman network
				const zoneId = uci.add('firewall', 'zone', 'podman_zone');
				uci.set('firewall', zoneId, 'name', ZONE_NAME);
				uci.set('firewall', zoneId, 'input', 'DROP');
				uci.set('firewall', zoneId, 'output', 'ACCEPT');
				uci.set('firewall', zoneId, 'forward', 'REJECT');
				uci.set('firewall', zoneId, 'network', [networkName]);

				// Create DNS rule for the zone (only once)
				const ruleId = uci.add('firewall', 'rule', 'podman_dns');
				uci.set('firewall', ruleId, 'name', 'Allow-Podman-DNS');
				uci.set('firewall', ruleId, 'src', ZONE_NAME);
				uci.set('firewall', ruleId, 'dest_port', '53');
				uci.set('firewall', ruleId, 'target', 'ACCEPT');
			} else {
				// Zone exists, add this network to the zone's network list
				const zoneSection = existingZone['.name'];
				const currentNetworks = uci.get('firewall', zoneSection, 'network');

				// Convert to array if it's a string
				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				// Add network if not already in list
				if (!networkList.includes(networkName)) {
					networkList.push(networkName);
					uci.set('firewall', zoneSection, 'network', networkList);
				}
			}

			// Save and apply changes
			return uci.save();
		}).then(() => {
			// Apply with timeout (allows rollback if something goes wrong)
			return uci.apply(90);
		}).then(() => {
			// Flush network cache to reload state
			return network.flushCache();
		});
	},

	/**
	 * Remove OpenWrt network integration for a Podman network.
	 * Removes the network from the shared 'podman' zone.
	 * If this is the last network in the zone, removes the zone and DNS rule.
	 * This removes:
	 * - Network from firewall zone's network list
	 * - Firewall zone + DNS rule (if last network)
	 * - Network interface
	 * - Bridge device (if not used by other interfaces)
	 *
	 * @param {string} networkName - Name of the Podman network
	 * @param {string} bridgeName - Name of the bridge interface
	 * @returns {Promise<void>} Resolves when integration is removed
	 *
	 * @example
	 * removeIntegration('mynetwork', 'podman0').then(() => {
	 *     console.log('Integration removed successfully');
	 * }).catch((err) => {
	 *     console.error('Failed to remove integration:', err);
	 * });
	 */
	removeIntegration: function(networkName, bridgeName) {
		const ZONE_NAME = 'podman';

		// Load required UCI configurations
		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// 1. Find the shared 'podman' zone
			const zone = uci.sections('firewall', 'zone').find((s) => {
				return uci.get('firewall', s['.name'], 'name') === ZONE_NAME;
			});

			if (zone) {
				const zoneSection = zone['.name'];
				const currentNetworks = uci.get('firewall', zoneSection, 'network');

				// Convert to array if it's a string
				let networkList = [];
				if (Array.isArray(currentNetworks)) {
					networkList = currentNetworks;
				} else if (currentNetworks) {
					networkList = [currentNetworks];
				}

				// Remove this network from the list
				networkList = networkList.filter((n) => n !== networkName);

				if (networkList.length > 0) {
					// Other networks still exist, update the list
					uci.set('firewall', zoneSection, 'network', networkList);
				} else {
					// This was the last network, remove zone and DNS rule
					uci.remove('firewall', zoneSection);

					// Remove DNS rule
					const dnsRule = uci.sections('firewall', 'rule').find((s) => {
						return uci.get('firewall', s['.name'], 'name') === 'Allow-Podman-DNS';
					});
					if (dnsRule) {
						uci.remove('firewall', dnsRule['.name']);
					}
				}
			}

			// 2. Remove network interface
			const iface = uci.get('network', networkName);
			if (iface) {
				uci.remove('network', networkName);
			}

			// 3. Remove bridge device (only if not used by other interfaces)
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

			// Save and apply changes
			return uci.save();
		}).then(() => {
			// Apply with timeout
			return uci.apply(90);
		}).then(() => {
			// Flush network cache
			return network.flushCache();
		});
	},

	/**
	 * Check if OpenWrt integration exists for a network.
	 * Checks for network interface existence.
	 *
	 * @param {string} networkName - Name of the Podman network
	 * @returns {Promise<boolean>} Resolves to true if integration exists
	 *
	 * @example
	 * hasIntegration('mynetwork').then((exists) => {
	 *     if (exists) {
	 *         console.log('OpenWrt integration is active');
	 *     } else {
	 *         console.log('No OpenWrt integration');
	 *     }
	 * });
	 */
	hasIntegration: function(networkName) {
		return uci.load('network').then(() => {
			const iface = uci.get('network', networkName);
			return !!iface;
		}).catch(() => {
			return false;
		});
	},

	/**
	 * Check if OpenWrt integration is complete (all components exist).
	 * Verifies: device, interface, and firewall zone membership.
	 *
	 * @param {string} networkName - Name of the Podman network
	 * @returns {Promise<Object>} Resolves to {complete: boolean, missing: Array<string>}
	 *
	 * @example
	 * isIntegrationComplete('mynetwork').then((result) => {
	 *     if (result.complete) {
	 *         console.log('Integration is complete');
	 *     } else {
	 *         console.log('Missing components:', result.missing);
	 *     }
	 * });
	 */
	isIntegrationComplete: function(networkName) {
		const ZONE_NAME = 'podman';
		const missing = [];

		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// Check network interface
			const iface = uci.get('network', networkName);
			if (!iface) {
				missing.push('interface');
				return { complete: false, missing: missing };
			}

			// Get bridge name from interface
			const bridgeName = uci.get('network', networkName, 'device');

			// Check bridge device
			if (bridgeName) {
				const device = uci.get('network', bridgeName);
				if (!device) {
					missing.push('device');
				}
			} else {
				missing.push('device');
			}

			// Check if network is in 'podman' zone
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

			return { complete: missing.length === 0, missing: missing };
		}).catch(() => {
			return { complete: false, missing: ['unknown'] };
		});
	},

	/**
	 * Get integration details for a network.
	 *
	 * @param {string} networkName - Name of the Podman network
	 * @returns {Promise<Object|null>} Integration details or null if not found
	 *
	 * @example
	 * getIntegration('mynetwork').then((details) => {
	 *     if (details) {
	 *         console.log('Bridge:', details.bridgeName);
	 *         console.log('Gateway:', details.gateway);
	 *         console.log('Netmask:', details.netmask);
	 *     }
	 * });
	 */
	getIntegration: async function(networkName) {
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
	 * @param {string} networkName - Name of the network
	 * @param {Object} options - Network options
	 * @returns {Promise<Object>} Validation result {valid: boolean, errors: Array<string>}
	 *
	 * @example
	 * validateIntegration('mynetwork', {
	 *     bridgeName: 'podman0',
	 *     subnet: '10.129.0.0/24',
	 *     gateway: '10.129.0.1'
	 * }).then((result) => {
	 *     if (!result.valid) {
	 *         console.error('Validation errors:', result.errors);
	 *     }
	 * });
	 */
	validateIntegration: async function(networkName, options) {
		const errors = [];

		// Check required fields
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

		// Validate CIDR format
		if (options.subnet && !options.subnet.match(/^\d+\.\d+\.\d+\.\d+\/\d+$/)) {
			errors.push(_('Subnet must be in CIDR notation (e.g., 10.129.0.0/24)'));
		}

		// Validate IP address format
		if (options.gateway && !options.gateway.match(/^\d+\.\d+\.\d+\.\d+$/)) {
			errors.push(_('Gateway must be a valid IP address'));
		}

		if (errors.length > 0) {
			return Promise.resolve({ valid: false, errors: errors });
		}

		// Check for conflicts with existing configurations
		return Promise.all([
			uci.load('network'),
			uci.load('firewall')
		]).then(() => {
			// Check if network interface already exists
			const existingInterface = uci.get('network', networkName);
			if (existingInterface) {
				const existingProto = uci.get('network', networkName, 'proto');
				// Only warn if it's not already a static interface (might be existing integration)
				if (existingProto !== 'static') {
					errors.push(_('Network interface "%s" already exists with proto "%s"').format(networkName, existingProto));
				}
			}

			// Check if bridge is already used by another interface
			const otherInterfaces = uci.sections('network', 'interface').filter((s) => {
				return uci.get('network', s['.name'], 'device') === options.bridgeName &&
				       s['.name'] !== networkName;
			});

			if (otherInterfaces.length > 0) {
				errors.push(_('Bridge "%s" is already used by interface "%s"').format(
					options.bridgeName,
					otherInterfaces[0]['.name']
				));
			}

			return { valid: errors.length === 0, errors: errors };
		}).catch((err) => {
			errors.push(_('Failed to validate: %s').format(err.message));
			return { valid: false, errors: errors };
		});
	}
});
