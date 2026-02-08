'use strict';

'require baseclass';
'require form';
'require fs';
'require ui';

'require podman.ui as podmanUI';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormImage',
		map: null,

		/**
		 * Render the image pull form
		 * @returns {Promise<HTMLElement>} Rendered form element
		 */
		render: function () {
			// Create data as instance property (not prototype)
			this.data = {
				image: {
					registry: '',
					image: ''
				}
			};

			this.map = new form.JSONMap(this.data, _('Pull Image'), _(
				'Fetch a container image using Podman.'));
			const s = this.map.section(form.NamedSection, 'image', '');
			const oReg = s.option(form.ListValue, 'registry', _('Registry'));
			oReg.value('', 'docker.io');
			oReg.value('quay.io/', 'quay.io');
			oReg.value('ghcr.io/', 'ghcr.io');
			oReg.value('gcr.io/', 'gcr.io');
			const oImg = s.option(form.Value, 'image', _('Image'));
			oImg.placeholder = 'nginx:latest';

			const btn = s.option(form.Button, '_pull', ' ');
			btn.inputstyle = 'add';
			btn.inputtitle = _('Pull Image');
			btn.onclick = () => {
				this.handlePullExecute();
			};

			return this.map.render();
		},

		/**
		 * Execute image pull via fs.exec_direct
		 */
		handlePullExecute: function () {
			this.map.save().then(() => {
				const registry = this.map.data.data.image.registry;
				const image = this.map.data.data.image.image;

				if (!image) {
					podmanUI.errorNotification(_('Please enter an image name'));
					return;
				}
				const imageName = registry ? registry + image :
					'docker.io/library/' + image;

				ui.showModal(_('Pulling Image'), [
					E('p', {
						'class': 'spinning image-pull'
					}, _('Pulling %s...').format(imageName))
				]);

				fs.exec_direct('/usr/libexec/podman-api', ['image_pull', imageName], 'text')
					.then(() => {
						ui.hideModal();
						podmanUI.successTimeNotification(_('Image pulled successfully'));

						this.map.data.data.image.image = '';
						this.map.save().then(() => {
							this.submit();
						});
					}).catch((err) => {
						ui.hideModal();
						podmanUI.errorNotification(
							_('Failed to pull image: %s').format(err.message));
					});
			});
		},

		/**
		 * Intentionally left as a no-op.
		 * This form performs actions via dedicated handlers (e.g. handlePullExecute)
		 * and does not use the standard submit pipeline.
		 * @returns {Promise<void>} Resolved promise to satisfy form interface
		 */
		submit: function () {
			return Promise.resolve();
		},
	})
});
