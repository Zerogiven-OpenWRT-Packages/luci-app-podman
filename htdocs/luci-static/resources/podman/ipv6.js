'use strict';

'require baseclass';

/**
 * IPv6 ULA (Unique Local Address) utilities.
 * Derives IPv6 subnets from IPv4 networks for dual-stack container configurations.
 */
return baseclass.extend({
	/**
	 * Derive ULA IPv6 subnet and gateway from IPv4 subnet.
	 * Uses IPv4 octets 3-4 as subnet ID for consistent IPv4/IPv6 mapping.
	 * @param {string} ipv4 - IPv4 subnet in CIDR (e.g., "192.168.20.0/24")
	 * @param {string} ula_prefix - ULA prefix (e.g., "fd52:425:78eb::/48")
	 * @returns {{ipv6subnet: string, ipv6gateway: string}} IPv6 config with subnet/gateway
	 */
	deriveUlaFromIpv4: function (ipv4, ula_prefix) {
		const ipv4Address = ipv4.split('/')[0];
		const octets = ipv4Address.split('.').map(Number);
		const subnetIdHex = ((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0');
		const ulaAddress = ula_prefix.split('/')[0];
		const ulaParts = ulaAddress.split('::');

		let hextets = ulaParts[0].split(':');
		if (hextets.length === 1 && hextets[0] === "") {
			hextets = [];
		}

		while (hextets.length < 3) {
			hextets.push('0');
		}

		const ipv6SubnetAddress = `${hextets.slice(0, 3).join(':')}:${subnetIdHex}::`;

		return {
			ipv6subnet: `${ipv6SubnetAddress}/64`,
			ipv6gateway: `${ipv6SubnetAddress}1`
		};
	}
});
