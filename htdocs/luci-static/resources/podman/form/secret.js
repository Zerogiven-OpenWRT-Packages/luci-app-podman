'use strict';

'require baseclass';
'require form';
'require ui';

'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormSecret',
		map: null,

		/**
		 * Render the secret creation modal
		 */
		render: function () {
			// Create data as instance property (not prototype)
			this.data = {
				secret: {
					name: null,
					data: null
				}
			};

			let field;

			this.map = new form.JSONMap(this.data, _('Create %s').format('Secret'), '');
			const section = this.map.section(form.NamedSection, 'secret', 'secret');

			field = section.option(form.Value, 'name', _('Secret Name'));
			field.placeholder = 'my-secret';
			field.datatype = 'rangelength(1,253)';
			field.validate = (_section_id, value) => {
				if (!/^[a-zA-Z0-9_\-]+$/.test(value)) {
					return _(
						'Secret name can only contain letters, numbers, underscores, and hyphens'
					);
				}
				return true;
			};
			field.description = _(
				'1-253 characters: letters, numbers, underscore (_), hyphen (-) only');

			field = section.option(form.TextValue, 'data', _('Secret Data'));
			field.placeholder = _('Enter secret data (password, token, key, etc.)');
			field.rows = 6;
			field.datatype = 'minlength(1)';
			field.description = _('The sensitive data to store securely');

			this.map.render().then((formElement) => {
				const modalContent = [
					formElement,

					E('div', { 'class': 'cbi-section' }, [
						E('div', { 'style': 'background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; border-radius: 4px; margin-top: 10px;' },
							[
								E('strong', {}, _('Security Notice:')),
								E('ul', {
									'style': 'margin: 10px 0 0 20px;'
								}, [
									E('li', {}, _(
										'Secret data is stored encrypted')),
									E('li', {}, _(
										'Once created, secret data cannot be viewed or retrieved'
									)),
									E('li', {}, _(
										'Secrets can only be used by containers, not displayed'
									)),
									E('li', {}, _(
										'To update a secret, delete and recreate it'
									))
								])
							])
					]),

					new podmanUI.ModalButtons({
						confirmText: _('Create %s').format('').trim(),
						onConfirm: () => this.handleCreate(),
						onCancel: () => ui.hideModal()
					}).render()
				];

				ui.showModal('', modalContent);

				requestAnimationFrame(() => {
					const nameInput = document.querySelector(
						'input[data-name="name"]');

					if (nameInput) {
						nameInput.focus();
					}
				});
			});
		},

		/**
		 * Handle secret creation
		 */
		handleCreate: function () {
			this.map.save().then(() => {
				const secretName = this.map.data.data.secret.name;
				const secretData = this.map.data.data.secret.data;

				if (!secretName || !secretData) {
					return;
				}

				ui.hideModal();
				podmanUI.showSpinningModal(_('Creating %s').format(_('Secret')), _('Creating %s...').format(_('Secret').toLowerCase()));

				podmanRPC.secret.create(secretName, secretData).then((result) => {
					ui.hideModal();

					if (result && result.error) {
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Secret').toLowerCase(), result.error));
						return;
					}
					if (result && result.message && result.response >= 400) {
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Secret').toLowerCase(), result.message));
						return;
					}
					if (result && result.cause) {
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Secret').toLowerCase(), result.cause));
						return;
					}

					podmanUI.successTimeNotification(_('%s created successfully').format(_('Secret')));

					this.submit();
				}).catch((err) => {
					ui.hideModal();
					let errorMsg = err.message || err.toString();
					try {
						if (typeof err === 'string' && err.indexOf('{') >= 0) {
							const jsonError = JSON.parse(err.substring(err.indexOf(
								'{')));
							errorMsg = jsonError.message || jsonError.cause ||
								errorMsg;
						}
					} catch (e) {
					}
					podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Secret').toLowerCase(), errorMsg));
				});
			}).catch((err) => {
			});
		},

		submit: () => { },
	})
});
