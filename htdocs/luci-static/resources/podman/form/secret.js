'use strict';

'require baseclass';
'require form';

'require podman.rpc as podmanRPC';
'require podman.view as podmanView';

/**
 * Create podman secret
 */
const PodmanFormSecret = podmanView.form.extend({
	__name__: 'Podman.Form.Secret',

	makeData() {
		return {
			secret: {
				name: null,
				data: null,
				labels: null,
			}
		};
	},

	createForm() {
		let field;

		field = this.section.option(form.Value, 'name', _('Secret Name'));
		field.placeholder = 'my-secret';
		field.rmempty = false;
		field.datatype = 'maxlength(253)';
		field.validate = (_section_id, value) => {
			if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
				return _(
					'Secret name can only contain letters, numbers, underscores, and hyphens'
				);
			}
			return true;
		};
		field.description = _(
			'1-253 characters: letters, numbers, underscore (_), hyphen (-) only');

		field = this.section.option(form.TextValue, 'data', _('Secret Data'));
		field.placeholder = _('Enter secret data (password, token, key, etc.)');
		field.rmempty = false;
		field.rows = 6;
		field.description = _('The sensitive data to store securely');

		field = this.section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = 'key1=value1\nkey2=value2';
		field.rows = 3;
		field.optional = true;
		field.description = _('Labels in key=value format, one per line');
	},

	async handleCreate() {
		if (!this.isValid()) {
			return this.scrollToInvalid();
		}

		await this.save();

		const data = this.getFieldValues();

		if (!data.name || !data.data) {
			return;
		}

		const labels = {};
		if (data.labels) {
			data.labels.split('\n').forEach((line) => {
				const parts = line.split('=');
				if (parts.length >= 2) {
					const key = parts[0].trim();
					const value = parts.slice(1).join('=').trim();
					if (key) labels[key] = value;
				}
			});
		}

		const createFn = () => podmanRPC.secrets.create(data.name, data.data, labels);

		return this.super('handleCreate', [ createFn, _('Secret') ]);
	},
});

return baseclass.extend({
	init: PodmanFormSecret
});
