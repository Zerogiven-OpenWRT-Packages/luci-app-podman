'use strict';

'require baseclass';

/**
 * IPv6 utility module for automatic ULA (Unique Local Address) generation
 * Provides helpers to derive IPv6 subnets from IPv4 networks for dual-stack configurations
 */
return baseclass.extend({
	/**
	 * Derive a ULA IPv6 subnet and gateway from an IPv4 subnet
	 *
	 * This function generates a deterministic IPv6 ULA subnet based on the IPv4 subnet,
	 * using the 3rd and 4th octets as the IPv6 subnet ID. This creates a consistent
	 * mapping between IPv4 and IPv6 networks.
	 *
	 * @param {string} ipv4 - IPv4 subnet in CIDR notation (e.g., "192.168.20.0/24")
	 * @param {string} ula_prefix - OpenWrt ULA prefix (e.g., "fd52:425:78eb::/48" or "fd52:425::/48")
	 * @returns {Object} IPv6 configuration
	 * @returns {string} return.ipv6subnet - Generated IPv6 subnet in CIDR notation (e.g., "fd52:425:0:1400::/64")
	 * @returns {string} return.ipv6gateway - Generated IPv6 gateway address (e.g., "fd52:425:0:1400::1")
	 *
	 * @example
	 * // With full /48 ULA prefix
	 * deriveUlaFromIpv4("192.168.20.0/24", "fd52:425:78eb::/48")
	 * // Returns: { ipv6subnet: "fd52:425:78eb:1400::/64", ipv6gateway: "fd52:425:78eb:1400::1" }
	 *
	 * @example
	 * // With shorter /32 ULA prefix (will be padded)
	 * deriveUlaFromIpv4("10.89.5.0/24", "fd52:425::/48")
	 * // Returns: { ipv6subnet: "fd52:425:0:5905::/64", ipv6gateway: "fd52:425:0:5905::1" }
	 *
	 * @example
	 * // Edge case with minimal prefix
	 * deriveUlaFromIpv4("172.16.0.1/16", "::/48")
	 * // Returns: { ipv6subnet: "0:0:0:1::/64", ipv6gateway: "0:0:0:1::1" }
	 */
	deriveUlaFromIpv4: function (ipv4, ula_prefix) {
		const ipv4Address = ipv4.split('/')[0];
		const octets = ipv4Address.split('.').map(Number);
		const octet3 = octets[2];
		const octet4 = octets[3];
		const subnetIdHex = ((octet3 << 8) | octet4).toString(16).padStart(4, '0');
		const ulaAddress = ula_prefix.split('/')[0];
		const ulaParts = ulaAddress.split('::');

		let ulaBase = ulaParts[0];
		let hextets = ulaBase.split(':');

		if (hextets.length === 1 && hextets[0] === "") {
			hextets = [];
		}

		while (hextets.length < 3) {
			hextets.push('0');
		}

		const ulaNetworkBase = hextets.slice(0, 3).join(':');
		const ipv6SubnetAddress = `${ulaNetworkBase}:${subnetIdHex}::`;

		return {
			ipv6subnet: `${ipv6SubnetAddress}/64`,
			ipv6gateway: `${ipv6SubnetAddress}1`,
		};
	}
});
