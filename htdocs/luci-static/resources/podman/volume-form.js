'use strict';
'require ui';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';

/**
 * @file Volume creation form module using LuCI.form
 * @module podman.volume-form
 * @description Provides a modal-based form for creating volumes
 */

return L.Class.extend({
	render: function(onSuccess) {
		let field;

		const formData = {
			volume: {
				name: null,
				driver: 'local',
				options: null,
				labels: null
			}
		};

		const map = new form.JSONMap(formData, _('Create Volume'), '');
		const section = map.section(form.NamedSection, 'volume', 'volume');

		// Volume Name
		field = section.option(form.Value, 'name', _('Volume Name'));
		field.placeholder = _('my-volume (optional)');
		field.optional = true;
		field.datatype = 'maxlength(253)';
		field.description = _('Volume name. Leave empty to auto-generate.');

		// Driver
		field = section.option(form.ListValue, 'driver', _('Driver'));
		field.value('local', 'local');
		field.value('image', 'image');
		field.default = 'local';
		field.description = _('Volume driver to use');

		// Mount Options
		field = section.option(form.Value, 'options', _('Mount Options'));
		field.placeholder = _('type=tmpfs,device=tmpfs,o=size=100m');
		field.optional = true;
		field.description = _('Driver-specific options (comma-separated, e.g., type=tmpfs,o=size=100m)');

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
			const volume = map.data.data.volume;
			const payload = { Name: volume.name || '' };

			if (volume.driver) payload.Driver = volume.driver;

			// Parse options
			if (volume.options) {
				payload.Options = {};
				volume.options.split(',').forEach((opt) => {
					const parts = opt.split('=');
					if (parts.length === 2) {
						payload.Options[parts[0].trim()] = parts[1].trim();
					}
				});
			}

			// Parse labels
			if (volume.labels) {
				payload.Labels = {};
				volume.labels.split('\n').forEach((line) => {
					const parts = line.split('=');
					if (parts.length >= 2) {
						const key = parts[0].trim();
						const value = parts.slice(1).join('=').trim();
						if (key) payload.Labels[key] = value;
					}
				});
			}

			ui.hideModal();
			map.reset();

			utils.showLoadingModal(_('Creating Volume'), _('Creating volume...'));

			podmanRPC.volume.create(JSON.stringify(payload)).then((result) => {
				ui.hideModal();
				if (result && result.error) {
					ui.addNotification(null, E('p', _('Failed to create volume: %s').format(result.error)), 'error');
					return;
				}
				ui.addTimeLimitedNotification(null, E('p', _('Volume created successfully')), 2000);
				if (onSuccess) onSuccess();
			}).catch((err) => {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed to create volume: %s').format(err.message)), 'error');
			});
		}).catch(() => {});
	}
});
