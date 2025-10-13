'use strict';
'require ui';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';

/**
 * @file Secret creation form module using LuCI.form
 * @module podman.secret-form
 * @description Provides a modal-based form for creating secrets
 */
return L.Class.extend({
	/**
	 * Render the secret creation modal
	 * @param {Function} onSuccess - Callback to execute after successful creation
	 */
	render: function(onSuccess) {
		let field;

		const formData = {
			secret: {
				name: null,
				data: null
			}
		};
		const map = new form.JSONMap(formData, _('Create Secret'), '');
		const section = map.section(form.NamedSection, 'secret', 'secret');

		// Secret Name
		field = section.option(form.Value, 'name', _('Secret Name'));
		field.placeholder = _('my-secret');
		field.datatype = 'maxlength(253)';
		field.validate = (_section_id, value) => {
			if (!value || value.length === 0) {
				return _('Secret name is required');
			}
			if (!/^[a-zA-Z0-9_\-]+$/.test(value)) {
				return _('Secret name can only contain letters, numbers, underscores, and hyphens');
			}
			return true;
		};
		field.description = _('1-253 characters: letters, numbers, underscore (_), hyphen (-) only');

		// Secret Data
		field = section.option(form.TextValue, 'data', _('Secret Data'));
		field.placeholder = _('Enter secret data (password, token, key, etc.)');
		field.rows = 6;
		field.validate = (_section_id, value) => {
			if (!value || value.length === 0) {
				return _('Secret data is required');
			}
			return true;
		};
		field.description = _('The sensitive data to store securely');

		map.render().then((formElement) => {
			const modalContent = [
				formElement,

				// Security Notice
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'style': 'background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; border-radius: 4px; margin-top: 10px;' }, [
						E('strong', {}, _('Security Notice:')),
						E('ul', { 'style': 'margin: 10px 0 0 20px;' }, [
							E('li', {}, _('Secret data is stored encrypted')),
							E('li', {}, _('Once created, secret data cannot be viewed or retrieved')),
							E('li', {}, _('Secrets can only be used by containers, not displayed')),
							E('li', {}, _('To update a secret, delete and recreate it'))
						])
					])
				]),

				// Modal buttons
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-negative',
						'click': () => {
							ui.hideModal();
							map.reset();
						}
					}, _('Cancel')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-positive',
						'click': L.bind(this.handleCreate, this, map, onSuccess)
					}, _('Create'))
				])
			];

			ui.showModal('', modalContent);

			// Focus on name input
			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[data-name="name"]');

				if (nameInput) {
					nameInput.focus();
				}
			});
		});
	},

	/**
	 * Handle secret creation
	 * @param {Object} map - The form map object
	 * @param {Function} onSuccess - Success callback
	 */
	handleCreate: function(map, onSuccess) {
		// Parse and validate the form
		map.parse().then(() => {
			// Get the form data
			const secret = map.data.data.secret;
			const secretName = secret.name;
			const secretData = secret.data;

			// Additional validation already done by form validators
			if (!secretName || !secretData) {
				return;
			}

			ui.hideModal();
			map.reset();

			utils.showLoadingModal(_('Creating Secret'), _('Creating secret...'));

			podmanRPC.secret.create(secretName, secretData).then((result) => {
				ui.hideModal();

				// Check for various error formats
				if (result && result.error) {
					ui.addNotification(null, E('p', _('Failed to create secret: %s').format(result.error)), 'error');
					return;
				}
				if (result && result.message && result.response >= 400) {
					ui.addNotification(null, E('p', _('Failed to create secret: %s').format(result.message)), 'error');
					return;
				}
				if (result && result.cause) {
					ui.addNotification(null, E('p', _('Failed to create secret: %s').format(result.cause)), 'error');
					return;
				}

				ui.addTimeLimitedNotification(null, E('p', _('Secret created successfully')), 2000);

				if (onSuccess) {
					onSuccess();
				}
			}).catch((err) => {
				ui.hideModal();
				let errorMsg = err.message || err.toString();
				// Try to parse JSON error if present
				try {
					if (typeof err === 'string' && err.indexOf('{') >= 0) {
						const jsonError = JSON.parse(err.substring(err.indexOf('{')));
						errorMsg = jsonError.message || jsonError.cause || errorMsg;
					}
				} catch(e) {
					// Ignore parse errors
				}
				ui.addNotification(null, E('p', _('Failed to create secret: %s').format(errorMsg)), 'error');
			});
		}).catch(function(err) {
			// Validation failed - errors are already shown by the form
		});
	}
});
