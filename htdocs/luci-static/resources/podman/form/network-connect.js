'use strict';

'require baseclass';
'require form';
'require ui';

'require podman.ui as podmanUI';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormNetworkConnect',
		map: null,
		containerId: null,

		/**
		 * Render the network connect form
		 * @param {string} containerId - Container ID
		 * @param {Array} networks - Available networks
		 * @param {Function} onSuccess - Success callback
		 * @returns {Promise<HTMLElement>} Rendered form element
		 */
		render: async function (containerId, networks, onSuccess) {
			this.containerId = containerId;
			this.onSuccess = onSuccess;

			const data = {
				network: {
					name: '',
					ip: ''
				}
			};

			this.map = new form.JSONMap(data, '');
			const section = this.map.section(form.NamedSection, 'network', 'network');
			section.anonymous = true;
			section.addremove = false;

			let field;

			field = section.option(form.ListValue, 'name', _('Connect to Network'));
			field.value('', _('-- Select %s --').format(_('Network')));
			if (networks && Array.isArray(networks)) {
				networks.forEach((net) => {
					const name = net.Name || net.name;
					if (name && name !== 'none' && name !== 'host') {
						field.value(name, name);
					}
				});
			}

			field = section.option(form.Value, 'ip', _('Static IP (Optional)'));
			field.datatype = 'ip4addr';
			field.optional = true;
			field.placeholder = '192.168.1.100';
			field.description = _('Leave empty for automatic IP assignment');

			field = section.option(form.Button, '_connect', ' ');
			field.inputtitle = _('Connect');
			field.inputstyle = 'positive';
			field.onclick = () => this.handleConnect();

			return this.map.render();
		},

		/**
		 * Handle network connection
		 */
		handleConnect: function () {
			this.map.save().then(() => {
				const networkData = this.map.data.data.network;

				if (!networkData.name) {
					pui.warningNotification(_('Please select a network'));
					return;
				}

				pui.showSpinningModal(_('Connecting to Network'), _(
					'Connecting container to network...'));

				const params = { container: this.containerId };
				if (networkData.ip) {
					params.static_ips = [networkData.ip];
				}

				podmanRPC.network.connect(networkData.name, params).then((
					result) => {
					ui.hideModal();
					if (result && result.error) {
						pui.errorNotification(_('Failed to connect to network: %s')
							.format(result.error));
					} else {
						pui.successTimeNotification(_(
							'Connected to network successfully'));
						if (this.onSuccess) this.onSuccess();
					}
				}).catch((err) => {
					ui.hideModal();
					pui.errorNotification(_('Failed to connect to network: %s')
						.format(err.message));
				});
			}).catch(() => { });
		}
	})
});
