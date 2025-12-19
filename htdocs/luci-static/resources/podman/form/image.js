'use strict';

'require baseclass';
'require form';
'require poll';
'require ui';

'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormImage',
		map: null,
		pollFn: null,

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
			oImg.rmempty = false;

			const btn = s.option(form.Button, '_pull', ' ');
			btn.inputstyle = 'add';
			btn.inputtitle = _('Pull Image');
			btn.onclick = (ev) => {
				const button = ev.target;
				const formContainer = button.closest('.cbi-section, .cbi-map');
				if (formContainer) {
					const invalidFields = formContainer.querySelectorAll('.cbi-input-invalid');
					if (invalidFields.length > 0) {
						return;
					}
				}

				this.handlePullExecute();
			};

			return this.map.render();
		},

		/**
		 * Execute image pull with streaming progress
		 */
		handlePullExecute: function () {
			this.map.save().then(() => {
				const registry = this.map.data.data.image.registry;
				const image = this.map.data.data.image.image;

				if (!image) {
					podmanUI.errorNotification(_('Please enter an image name'));
					return;
				}
				const imageName = registry ? registry + image : 'docker.io/library/' + image;

				ui.showModal(_('Pulling Image'), [
					E('p', {
						'class': 'spinning image-pull'
					}, _('Starting image pull...')),
					E('pre', {
						'id': 'pull-output',
						'class': 'terminal-area',
					}, '')
				]);

				podmanRPC.image.pullStream(imageName).then((result) => {
					if (!result || !result.session_id) {
						ui.hideModal();
						podmanUI.errorNotification(_('Failed to start image pull'));
						return;
					}

					this.pollPullStatus(result.session_id);
				}).catch((err) => {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to pull image: %s').format(err
						.message));
				});
			});
		},

		/**
		 * Parse Docker/Podman JSON stream output
		 * @param {string} output - Raw output string
		 * @returns {string} Cleaned output
		 */
		parseJsonStream: function (output) {
			let cleanOutput = '';
			const lines = output.split('\n');

			lines.forEach((line) => {
				line = line.trim();
				if (!line) return;

				let hasValidJson = false;
				try {
					const obj = JSON.parse(line);
					if (obj.stream) {
						cleanOutput += obj.stream;
						hasValidJson = true;
					} else if (obj.images && obj.images.length > 0) {
						cleanOutput += 'Image ID: ' + obj.id + '\n';
						hasValidJson = true;
					}
				} catch (e) {
					const parts = line.split(/\}\s*\{/);
					if (parts.length > 1) {
						parts.forEach((part, idx) => {
							if (idx > 0) part = '{' + part;
							if (idx < parts.length - 1) part = part + '}';

							try {
								const obj = JSON.parse(part);
								if (obj.stream) {
									cleanOutput += obj.stream;
									hasValidJson = true;
								} else if (obj.images && obj.images.length > 0) {
									cleanOutput += 'Image ID: ' + obj.id + '\n';
									hasValidJson = true;
								}
							} catch (e2) {
							}
						});
					}
				}
				if (!hasValidJson) {
					cleanOutput += line + '\n';
				}
			});

			return cleanOutput;
		},

		/**
		 * Poll image pull status and update progress using poll.add()
		 * @param {string} sessionId - Pull session ID
		 */
		pollPullStatus: function (sessionId) {
			const outputEl = document.getElementById('pull-output');
			let offset = 0;

			this.pollFn = () => {
				return podmanRPC.image.pullStatus(sessionId, offset).then((status) => {
					if (status.output && outputEl) {
						const cleanOutput = this.parseJsonStream(status.output);
						outputEl.textContent += cleanOutput;
						outputEl.scrollTop = outputEl.scrollHeight;
						offset += status.output.length;
					}

					if (status.complete) {
						poll.remove(this.pollFn);

						if (!status.success) {
							if (outputEl) {
								outputEl.textContent += '\n\nPull failed!';
							}

							const modalContent = document.querySelector('.modal');
							if (modalContent) {
								const closeBtn = modalContent.querySelector(
									'.cbi-button');
								if (!closeBtn) {
									const btnContainer = E(
										'div', {
										'class': 'right',
										'style': 'margin-top: 10px;'
									},
										[
											new podmanUI.Button(_('Close'), () => {
												ui
													.hideModal();
											}).render()
										]);
									modalContent.appendChild(btnContainer);
								}
							}

							podmanUI.errorNotification(_('Failed to pull image'));

							return;
						}

						if (outputEl) {
							outputEl.textContent += '\n\nImage pulled successfully!';
						}

						const modalContent = document.querySelector('.modal');
						if (modalContent) {
							const closeBtn = modalContent.querySelector('.cbi-button');
							if (!closeBtn) {
								const btnContainer = E(
									'div', { 'class': 'right modal-buttons' },
									[
										new podmanUI.Button(
											_('Close'),
											() => {
												ui.hideModal();
											},
											'positive'
										).render()
									]
								);
								modalContent.appendChild(btnContainer);
							}
						}

						podmanUI.successTimeNotification(_('Image pulled successfully'));

						document.querySelector('.spinning.image-pull').remove();

						this.map.reset();
						this.submit();
					}
				}).catch((err) => {
					poll.remove(this.pollFn);
					if (outputEl) {
						outputEl.textContent += '\n\nError: ' + err.message;
					}
					podmanUI.errorNotification(_('Failed to pull image: %s').format(err
						.message));
				});
			};

			poll.add(this.pollFn, 1); // Poll every 1 second
		},

		submit: () => { },
	})
});
