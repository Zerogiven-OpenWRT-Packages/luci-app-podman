'use strict';

'require baseclass';
'require form';
'require ui';

'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormPod',
		map: null,

		/**
		 * Render the pod creation form
		 * @returns {Promise<HTMLElement>} Rendered form element
		 */
		render: async function () {
			// Create data as instance property (not prototype)
			this.data = {
				pod: {
					name: null,
					hostname: null,
					ports: null,
					labels: null
				}
			};

			this.map = new form.JSONMap(this.data, _('Create %s').format(_('Pod')), '');

			const section = this.map.section(form.NamedSection, 'pod', 'pod');
			let field;

			field = section.option(form.Value, 'name', _('Pod Name'));
			field.placeholder = 'my-pod';
			field.datatype = 'maxlength(253)';
			field.description = _('Name for the pod');

			field = section.option(form.Value, 'hostname', _('Hostname'));
			field.placeholder = 'pod-hostname';
			field.optional = true;
			field.datatype = 'hostname';
			field.description = _('Hostname to assign to the pod');
			field = section.option(form.TextValue, 'ports', _('Port Mappings'));
			field.placeholder = '8080:80\n8443:443';
			field.rows = 4;
			field.optional = true;
			field.description = _('Publish ports, one per line (host:container format)');

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
		 * Parse form data and create pod via RPC
		 */
		handleCreate: function () {
			this.map.save().then(() => {
				const pod = this.map.data.data.pod;
				const payload = {
					name: pod.name
				};

				if (pod.hostname) payload.hostname = pod.hostname;

				if (pod.ports) {
					payload.portmappings = [];
					pod.ports.split('\n').forEach((line) => {
						line = line.trim();
						if (!line) return;
						const parts = line.split(':');
						if (parts.length === 2) {
							const hostPort = parseInt(parts[0].trim(), 10);
							const containerPort = parseInt(parts[1].trim(), 10);
							if (!isNaN(hostPort) && !isNaN(containerPort)) {
								payload.portmappings.push({
									host_port: hostPort,
									container_port: containerPort,
									protocol: 'tcp'
								});
							}
						}
					});
				}

				if (pod.labels) {
					payload.labels = {};
					pod.labels.split('\n').forEach((line) => {
						const parts = line.split('=');
						if (parts.length >= 2) {
							const key = parts[0].trim();
							const value = parts.slice(1).join('=').trim();
							if (key) payload.labels[key] = value;
						}
					});
				}

				ui.hideModal();
				podmanUI.showSpinningModal(_('Creating %s').format(_('Pod')), _('Creating %s...').format(_('Pod').toLowerCase()));

				podmanRPC.pod.create(JSON.stringify(payload)).then((result) => {
					ui.hideModal();
					if (result && result.error) {
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Pod').toLowerCase(), result.error));
						return;
					}
					podmanUI.successTimeNotification(_('%s created successfully').format(_('Pod')));

					this.submit();
				}).catch((err) => {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Pod').toLowerCase(), err.message));
				});
			}).catch(() => { });
		},

		submit: () => { },
	})
});
