'use strict';

'require form';

'require podman.utils as utils';
'require podman.rpc as podmanRPC';
'require podman.form as podmanForm';
'require podman.view as podmanView';
'require podman.form.secret as PodmanFormSecret';

const SECRET_LABELS_TRUNCATE_LEN = 30;

/**
 * Manage podman secrets
 */
return podmanView.list.extend({
	sectionName: 'secrets',

	title: _('Secrets'),
	titleSingle: _('Secret'),

	/**
	 * Load secret data
	 */
	async load() {
		return podmanRPC.secrets.list();
	},

	/**
	 * Update list section
	 */
	async updateSection() {
		this.section.selectKey = 'ID';
		this.section.createForm = PodmanFormSecret;

		let o;

		o = this.section.option(podmanForm.field.LinkDummyValue, 'Name', _('Name'));
		o.cfgdatavalue = (secret) => secret.getName();
		o.click = (_value, secret) => this.section.handleInspect(secret, ['SecretData']);

		o = this.section.option(podmanForm.field.DummyValue, 'Driver', _('Driver'));
		o.cfgdatavalue = (secret) => secret.getDriver();
		o.width = '10%';

		o = this.section.option(podmanForm.field.DummyValue, 'Labels', _('Labels'));
		o.cfgdatavalue = (secret) => {
			const labels = secret.getLabels();
			const keys = Object.keys(labels);
			return keys.length ? keys.map((key) => `${key}=${labels[key]}`).join(', ') : '-';
		};
		o.cfgformatter = (labels) => utils.truncate(labels, SECRET_LABELS_TRUNCATE_LEN);
		o.cfgtt = (labels) => labels.length > SECRET_LABELS_TRUNCATE_LEN ? labels : '';
		o.width = '20%';

		o = this.section.option(podmanForm.field.DateDummyValue, 'CreatedAt', _('Created'));
		o.width = '20%';
	},
});
