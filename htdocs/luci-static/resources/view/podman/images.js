'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';

/**
 * @module view.podman.images
 * @description Image management view using proper LuCI form components
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Generic failure handler for rendering errors
	 * @param {string} message - Error message to display
	 * @returns {Element} Error element
	 */
	generic_failure: function(message) {
		return E('div', {
			'class': 'alert-message error'
		}, [_('RPC call failure: '), message]);
	},

	/**
	 * Load image data on view initialization
	 * @returns {Promise<Object>} Image data wrapped in object
	 */
	load: async () => {
		return podmanRPC.image.list()
			.then((images) => {
				return { images: images || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load images') };
			});
	},

	/**
	 * Render the images view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Images view element
	 */
	render: function(data) {
		// Handle errors from load()
		if (data && data.error) {
			return this.generic_failure(data.error);
		}

		// Initialize list helper
		this.listHelper = new pui.ListViewHelper({
			prefix: 'images',
			itemName: 'image',
			rpc: podmanRPC.image,
			data: data.images,
			view: this
		});

		const getImageData = (sectionId) => data.images[sectionId.replace('images', '')];

		// Create pull image form
		const pullSection = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('h3', {}, _('Pull Image')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Registry')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('select', {
							'id': 'registry-select',
							'class': 'cbi-input-select',
							'style': 'width: auto;'
						}, [
							E('option', { 'value': '' }, 'docker.io'),
							E('option', { 'value': 'quay.io/' }, 'quay.io'),
							E('option', { 'value': 'ghcr.io/' }, 'ghcr.io'),
							E('option', { 'value': 'gcr.io/' }, 'gcr.io')
						])
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Image')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'id': 'image-name-input',
							'class': 'cbi-input-text',
							'placeholder': _('nginx:latest'),
							'style': 'width: 300px;'
						}),
						' ',
						new pui.Button(_('Pull Image'), () => this.handlePullExecute(), 'add').render()
					])
				])
			])
		]);

		this.map = new form.JSONMap(data, _('Images'));
		const section = this.map.section(form.TableSection, 'images', '', _('Manage Podman images'));
		let o;

		section.anonymous = true;
		section.nodescription = true;

		// Checkbox column for selection
		o = section.option(form.DummyValue, 'Id', new ui.Checkbox(0, { hiddenname: 'all' }).render());
		o.cfgvalue = (sectionId) => {
			return new ui.Checkbox(0, { hiddenname: sectionId }).render();
		};

		// Repository column
		o = section.option(form.DummyValue, 'Repository', _('Repository'));
		o.cfgvalue = (sectionId) => {
			const image = getImageData(sectionId);
			const repoTags = image.RepoTags || ['<none>:<none>'];
			const firstTag = repoTags[0].split(':');
			return E('strong', {}, firstTag[0] || '<none>');
		};
		o.rawhtml = true;

		// Tag column
		o = section.option(form.DummyValue, 'Tag', _('Tag'));
		o.cfgvalue = (sectionId) => {
			const image = getImageData(sectionId);
			const repoTags = image.RepoTags || ['<none>:<none>'];
			const firstTag = repoTags[0].split(':');
			return firstTag[1] || '<none>';
		};

		// Image ID column
		o = section.option(form.DummyValue, 'ImageId', _('Image ID'));
		o.cfgvalue = (sectionId) => {
			const image = getImageData(sectionId);
			return E('a', {
				href: '#',
				click: (ev) => {
					ev.preventDefault();
					this.handleInspect(image.Id);
				}
			}, utils.truncate(image.Id ? image.Id.substring(7, 19) : '', 10));
		};
		o.rawhtml = true;

		// Size column
		o = section.option(form.DummyValue, 'Size', _('Size'));
		o.cfgvalue = (sectionId) => {
			const image = getImageData(sectionId);
			return utils.formatBytes(image.Size);
		};

		// Created column
		o = section.option(form.DummyValue, 'Created', _('Created'));
		o.cfgvalue = (sectionId) => {
			const image = getImageData(sectionId);
			return image && image.Created ? utils.formatDate(image.Created) : _('Unknown');
		};

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			customButtons: [
				{ text: _('Pull Latest'), handler: () => this.handlePullLatestSelected(), cssClass: 'positive' }
			]
		});

		return this.map.render().then((rendered) => {
			// Insert pull section before the images table
			const mainContainer = E('div', {}, [pullSection, rendered]);

			const header = rendered.querySelector('.cbi-section');
			if (header) {
				header.insertBefore(toolbar.container, header.firstChild);
			}

			// Setup "select all" checkbox using helper
			this.listHelper.setupSelectAll(rendered);

			return mainContainer;
		});
	},

	/**
	 * Get selected image objects from checkboxes
	 * @returns {Array<Object>} Array of {id, name} objects for selected images
	 */
	getSelectedImages: function() {
		return this.listHelper.getSelected((image) => {
			const repoTags = image.RepoTags || ['<none>:<none>'];
			return {
				id: image.Id,
				name: repoTags[0]
			};
		});
	},

	/**
	 * Delete selected images
	 */
	handleDeleteSelected: function() {
		utils.handleBulkDelete({
			selected: this.getSelectedImages(),
			itemName: 'image',
			deletePromiseFn: (img) => podmanRPC.image.remove(img.id, false),
			formatItemName: (img) => img.name
		});
	},

	/**
	 * Pull latest version of selected images
	 */
	handlePullLatestSelected: function() {
		const selected = this.getSelectedImages();

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No images selected')), 3000, 'warning');
			return;
		}

		const imageNames = selected.map((img) => img.name).join(', ');
		if (!confirm(_('Pull latest version of %d image(s)?\n\n%s').format(selected.length, imageNames)))
			return;

		ui.showModal(_('Pulling Images'), [
			E('p', { 'class': 'spinning' }, _('Pulling latest version of %d image(s)...').format(selected.length))
		]);

		const pullPromises = selected.map((img) => {
			return podmanRPC.image.pull(img.name);
		});

		Promise.all(pullPromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				ui.addNotification(null, E('p', _('Failed to pull %d image(s)').format(errors.length)), 'error');
			} else {
				ui.addTimeLimitedNotification(null, E('p', _('Successfully pulled %d image(s)').format(selected.length)), 3000, 'info');
			}
			window.location.reload();
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to pull some images: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Refresh image list
	 */
	handleRefresh: function() {
		window.location.reload();
	},

	/**
	 * Execute image pull with streaming progress
	 */
	handlePullExecute: function() {
		const registrySelect = document.getElementById('registry-select');
		const imageInput = document.getElementById('image-name-input');

		const registry = registrySelect ? registrySelect.value : '';
		const image = imageInput ? imageInput.value.trim() : '';

		if (!image) {
			ui.addNotification(null, E('p', _('Please enter an image name')), 'error');
			return;
		}

		// If registry is empty (docker.io default), add the prefix
		const imageName = registry ? registry + image : 'docker.io/library/' + image;

		ui.showModal(_('Pulling Image'), [
			E('p', { 'class': 'spinning' }, _('Starting image pull...')),
			E('pre', {
				'id': 'pull-output',
				'style': 'max-height: 300px; overflow-y: auto; background: #000; color: #0f0; padding: 10px; min-height: 100px;'
			}, '')
		]);

		podmanRPC.image.pullStream(imageName).then((result) => {
			if (!result || !result.session_id) {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed to start image pull')), 'error');
				return;
			}

			this.pollPullStatus(result.session_id);
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to pull image: %s').format(err.message)), 'error');
		});
	},

	/**
	 * Poll image pull status and update progress
	 * @param {string} sessionId - Pull session ID
	 */
	pollPullStatus: function(sessionId) {
		let offset = 0;
		let pollInterval;

		const updateStatus = () => {
			podmanRPC.image.pullStatus(sessionId, offset).then((status) => {
				const outputEl = document.getElementById('pull-output');
				if (outputEl && status.output) {
					const output = status.output;
					let cleanOutput = '';

					// Split by lines first to handle mixed JSON and plain text
					const lines = output.split('\n');

					lines.forEach((line) => {
						line = line.trim();
						if (!line) return;

						// Try to parse as JSON
						if (line.startsWith('{') && line.endsWith('}')) {
							try {
								const obj = JSON.parse(line);
								if (obj.stream) {
									cleanOutput += obj.stream.replace(/\n$/, '') + '\n';
								} else if (obj.images && obj.images.length > 0) {
									cleanOutput += 'Image ID: ' + obj.id + '\n';
								}
							} catch(e) {
								cleanOutput += line + '\n';
							}
						} else if (line.includes('{') && line.includes('}')) {
							const jsonMatch = line.match(/\{[^}]+\}/);
							if (jsonMatch) {
								try {
									const obj = JSON.parse(jsonMatch[0]);
									if (obj.stream) {
										cleanOutput += obj.stream.replace(/\n$/, '') + '\n';
									} else {
										cleanOutput += line + '\n';
									}
								} catch(e) {
									cleanOutput += line + '\n';
								}
							} else {
								cleanOutput += line + '\n';
							}
						} else {
							cleanOutput += line + '\n';
						}
					});

					outputEl.textContent += cleanOutput;
					outputEl.scrollTop = outputEl.scrollHeight;
					offset += status.output.length;
				}

				if (!status.complete) return;

				clearInterval(pollInterval);

				if (status.success) {
					if (outputEl) {
						outputEl.textContent += '\n\nImage pulled successfully!';
					}

					const modalContent = document.querySelector('.modal');
					if (modalContent) {
						const closeBtn = modalContent.querySelector('.cbi-button');
						if (!closeBtn) {
							const btnContainer = E('div', { 'class': 'right', 'style': 'margin-top: 10px;' }, [
								new pui.Button(_('Close'), () => { ui.hideModal(); }, 'positive').render()
							]);
							modalContent.appendChild(btnContainer);
						}
					}

					ui.addTimeLimitedNotification(null, E('p', _('Image pulled successfully')), 3000, 'info');
					this.handleRefresh();
					return;
				}

				if (outputEl) {
					outputEl.textContent += '\n\nPull failed!';
				}

				const modalContent = document.querySelector('.modal');
				if (modalContent) {
					const closeBtn = modalContent.querySelector('.cbi-button');
					if (!closeBtn) {
						const btnContainer = E('div', { 'class': 'right', 'style': 'margin-top: 10px;' }, [
							new pui.Button(_('Close'), () => { ui.hideModal(); }).render()
						]);
						modalContent.appendChild(btnContainer);
					}
				}

				ui.addNotification(null, E('p', _('Failed to pull image')), 'error');
			});
		};

		pollInterval = setInterval(updateStatus, 1000);
		updateStatus();
	},

	/**
	 * Inspect an image and show details in modal
	 * @param {string} id - Image ID
	 */
	handleInspect: function(id) {
		this.listHelper.showInspect(id);
	}
});
