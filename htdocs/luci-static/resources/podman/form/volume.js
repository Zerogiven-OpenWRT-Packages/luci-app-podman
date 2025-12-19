'use strict';

'require baseclass';
'require form';
'require ui';

'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormVolume',
		map: null,

		render: function () {
			this.data = {
				volume: {
					name: null,
					driver: 'local',
					options: null,
					labels: null
				}
			};

			let field;

			this.map = new form.JSONMap(this.data, _('Create Volume'), '');
			const section = this.map.section(form.NamedSection, 'volume', 'volume');

			field = section.option(form.Value, 'name', _('Volume Name'));
			field.placeholder = _('my-volume (optional)');
			field.optional = true;
			field.datatype = 'maxlength(253)';
			field.description = _('Volume name. Leave empty to auto-generate.');

			field = section.option(form.ListValue, 'driver', _('Driver'));
			field.value('local', 'local');
			field.value('image', 'image');
			field.description = _('Volume driver to use');

			field = section.option(form.Value, 'options', _('Mount Options'));
			field.placeholder = 'type=tmpfs,device=tmpfs,o=size=100m';
			field.optional = true;
			field.description = _(
				'Driver-specific options (comma-separated, e.g., type=tmpfs,o=size=100m)');

			field = section.option(form.TextValue, 'labels', _('Labels'));
			field.placeholder = _('key1=value1\nkey2=value2');
			field.rows = 3;
			field.optional = true;
			field.description = _('Labels in key=value format, one per line');

			this.map.render().then((formElement) => {
				ui.showModal('', [
					formElement,
					new podmanUI.ModalButtons({
						confirmText: _('Create'),
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
		 * Parse form data and create volume via RPC
		 */
		handleCreate: function () {
			this.map.save().then(() => {
				const volume = this.map.data.data.volume;
				const payload = {
					Name: volume.name || ''
				};

				if (volume.driver) payload.Driver = volume.driver;

				if (volume.options) {
					payload.Options = {};
					volume.options.split(',').forEach((opt) => {
						const parts = opt.split('=');
						if (parts.length === 2) {
							payload.Options[parts[0].trim()] = parts[1].trim();
						}
					});
				}

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
				podmanUI.showSpinningModal(_('Creating %s').format(_('Volume')), _('Creating %s...').format(_('Volume').toLowerCase()));

				podmanRPC.volume.create(JSON.stringify(payload)).then((result) => {
					ui.hideModal();
					if (result && result.error) {
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Volume').toLowerCase(), result.error));
						return;
					}
					podmanUI.successTimeNotification(_('%s created successfully').format(_('Volume')));
					this.submit();
				}).catch((err) => {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Volume').toLowerCase(), err.message));
				});
			}).catch(() => { });
		},

		submit: () => { },
	})
});
