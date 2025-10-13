'use strict';
'require ui';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';

/**
 * @file Network creation form module using LuCI.form
 * @module podman.network-form
 * @description Provides a modal-based form for creating networks
 */

return L.Class.extend({
	render: function(onSuccess) {
		let field;

		const formData = {
			network: {
				name: null,
				driver: 'bridge',
				subnet: null,
				gateway: null,
				ip_range: null,
				ipv6: false,
				internal: false,
				labels: null
			}
		};

		const map = new form.JSONMap(formData, _('Create Network'), '');
		const section = map.section(form.NamedSection, 'network', 'network');

		// Network Name
		field = section.option(form.Value, 'name', _('Network Name'));
		field.placeholder = _('my-network');
		field.datatype = 'maxlength(253)';
		field.validate = (_section_id, value) => {
			if (!value || value.length === 0) return _('Network name is required');
			return true;
		};
		field.description = _('Name for the network');

		// Driver
		field = section.option(form.ListValue, 'driver', _('Driver'));
		field.value('bridge', 'bridge');
		field.value('macvlan', 'macvlan');
		field.value('ipvlan', 'ipvlan');
		field.default = 'bridge';
		field.description = _('Network driver');

		// IPv4 Subnet
		field = section.option(form.Value, 'subnet', _('IPv4 Subnet (CIDR)'));
		field.placeholder = '10.89.0.0/24';
		field.optional = true;
		field.datatype = 'cidr4';
		field.description = _('IPv4 subnet in CIDR notation');

		// IPv4 Gateway
		field = section.option(form.Value, 'gateway', _('IPv4 Gateway'));
		field.placeholder = '10.89.0.1';
		field.optional = true;
		field.datatype = 'ip4addr';
		field.description = _('IPv4 gateway address');

		// IP Range
		field = section.option(form.Value, 'ip_range', _('IP Range (CIDR)'));
		field.placeholder = '10.89.0.0/28';
		field.optional = true;
		field.datatype = 'cidr4';
		field.description = _('Allocate container IP from this range');

		// IPv6
		field = section.option(form.Flag, 'ipv6', _('Enable IPv6'));
		field.default = field.disabled;
		field.description = _('Enable IPv6 networking');

		// Internal
		field = section.option(form.Flag, 'internal', _('Internal Network'));
		field.default = field.disabled;
		field.description = _('Restrict external access to the network');

		// Labels
		field = section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = _('key1=value1\nkey2=value2');
		field.rows = 3;
		field.optional = true;
		field.description = _('Labels in key=value format, one per line');

		map.render().then((formElement) => {
			ui.showModal('', [
				formElement,
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-negative',
						'click': () => {
							ui.hideModal();
							map.reset();
						}
					}, _('Cancel')),
					' ',
					E('button', { 'class': 'cbi-button cbi-button-positive', 'click': L.bind(this.handleCreate, this, map, onSuccess) }, _('Create'))
				])
			]);

			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[name="name"]');
				if (nameInput) nameInput.focus();
			});
		});
	},

	handleCreate: function(map, onSuccess) {
		map.parse().then(() => {
			const network = map.data.data.network;
			const payload = {
				name: network.name,
				driver: network.driver || 'bridge'
			};

			// Build IPAM config if subnet provided
			if (network.subnet) {
				payload.subnets = [{ subnet: network.subnet }];
				if (network.gateway) payload.subnets[0].gateway = network.gateway;
				if (network.ip_range) payload.subnets[0].lease_range = { start_ip: '', end_ip: '' };
			}

			payload.ipv6_enabled = network.ipv6 === '1';
			payload.internal = network.internal === '1';

			// Parse labels
			if (network.labels) {
				payload.labels = {};
				network.labels.split('\n').forEach((line) => {
					const parts = line.split('=');
					if (parts.length >= 2) {
						const key = parts[0].trim();
						const value = parts.slice(1).join('=').trim();
						if (key) payload.labels[key] = value;
					}
				});
			}

			ui.hideModal();
			map.reset();

			utils.showLoadingModal(_('Creating Network'), _('Creating network...'));

			podmanRPC.network.create(JSON.stringify(payload)).then((result) => {
				ui.hideModal();
				if (result && result.error) {
					ui.addNotification(null, E('p', _('Failed to create network: %s').format(result.error)), 'error');
					return;
				}
				ui.addTimeLimitedNotification(null, E('p', _('Network created successfully')), 2000);
				if (onSuccess) onSuccess();
			}).catch((err) => {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed to create network: %s').format(err.message)), 'error');
			});
		}).catch(() => {});
	}
});
