'use strict';
'require ui';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';

/**
 * @file Pod creation form module using LuCI.form
 * @module podman.pod-form
 * @description Provides a modal-based form for creating pods
 */

return L.Class.extend({
	render: function(onSuccess) {
		let field;

		const formData = {
			pod: {
				name: null,
				hostname: null,
				ports: null,
				labels: null
			}
		};

		const map = new form.JSONMap(formData, _('Create Pod'), '');
		const section = map.section(form.NamedSection, 'pod', 'pod');

		// Pod Name
		field = section.option(form.Value, 'name', _('Pod Name'));
		field.placeholder = _('my-pod');
		field.datatype = 'maxlength(253)';
		field.validate = (_section_id, value) => {
			if (!value || value.length === 0) return _('Pod name is required');
			return true;
		};
		field.description = _('Name for the pod');

		// Hostname
		field = section.option(form.Value, 'hostname', _('Hostname'));
		field.placeholder = _('pod-hostname');
		field.optional = true;
		field.datatype = 'hostname';
		field.description = _('Hostname to assign to the pod');

		// Port Mappings
		field = section.option(form.TextValue, 'ports', _('Port Mappings'));
		field.placeholder = _('8080:80\n8443:443');
		field.rows = 4;
		field.optional = true;
		field.description = _('Publish ports, one per line (host:container format)');

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
			const pod = map.data.data.pod;
			const payload = { name: pod.name };

			if (pod.hostname) payload.hostname = pod.hostname;

			// Parse port mappings
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

			// Parse labels
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
			map.reset();

			utils.showLoadingModal(_('Creating Pod'), _('Creating pod...'));

			podmanRPC.pod.create(JSON.stringify(payload)).then((result) => {
				ui.hideModal();
				if (result && result.error) {
					ui.addNotification(null, E('p', _('Failed to create pod: %s').format(result.error)), 'error');
					return;
				}
				ui.addTimeLimitedNotification(null, E('p', _('Pod created successfully')), 2000);
				if (onSuccess) onSuccess();
			}).catch((err) => {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed to create pod: %s').format(err.message)), 'error');
			});
		}).catch(() => {});
	}
});
