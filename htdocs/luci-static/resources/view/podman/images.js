'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';

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
	 * Load image data on view initialization
	 * @returns {Promise<Object>} Image data wrapped in object
	 */
	load: async () => {
		return podmanRPC.image.list()
			.then((images) => {
				// Expand images with multiple tags into separate records
				const expandedImages = [];
				(images || []).forEach((image) => {
					const repoTags = image.RepoTags || ['<none>:<none>'];
					repoTags.forEach((tag) => {
						// Create a copy of the image for each tag
						expandedImages.push({
							...image,
							_displayTag: tag,
							_originalImage: image
						});
					});
				});
				return {
					images: expandedImages
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed to load images')
				};
			});
	},

	/**
	 * Render the images view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Images view element
	 */
	render: function (data) {
		// Handle errors from load()
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		// Initialize list helper with full data object
		this.listHelper = new List.Util({
			itemName: 'image',
			rpc: podmanRPC.image,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Images'));

		const section = this.map.section(form.TableSection, 'images', '', _(
			'Manage Podman images'));
		section.anonymous = true;

		let o;

		// Checkbox column for selection
		o = section.option(podmanForm.field.SelectDummyValue, 'Id', new ui.Checkbox(
			0, {
				hiddenname: 'all'
			}).render());

		// Repository column
		o = section.option(form.DummyValue, 'Repository', _('Repository'));
		o.cfgvalue = (sectionId) => {
			const image = this.map.data.data[sectionId];
			const tag = image._displayTag || '<none>:<none>';
			const parts = tag.split(':');
			return E('strong', {}, parts[0] || '<none>');
		};

		// Tag column
		o = section.option(form.DummyValue, 'Tag', _('Tag'));
		o.cfgvalue = (sectionId) => {
			const image = this.map.data.data[sectionId];
			const tag = image._displayTag || '<none>:<none>';
			const parts = tag.split(':');
			return parts[1] || '<none>';
		};

		// Image ID column
		o = section.option(podmanForm.field.LinkDataDummyValue, 'ImageId', _('Image ID'));
		o.click = (image) => this.handleInspect(image.Id);
		o.text = (image) => utils.truncate(image.Id ? image.Id.substring(7, 19) : '', 10);

		// Size column
		o = section.option(podmanForm.field.DataDummyValue, 'Size', _('Size'));
		o.cfgformatter = utils.formatBytes;
		// Created column
		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = utils.formatDate;

		// Create toolbar using helper
		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			customButtons: [{
				text: _('Pull Latest'),
				handler: () => this
					.handlePullLatestSelected(),
				cssClass: 'positive'
			}]
		});

		const formImage = new podmanForm.Image();
		formImage.submit = () => this.handleRefresh();

		return Promise.all([
			formImage.render(),
			this.map.render(),
		]).then((rendered) => {
			const formRendered = rendered[0];
			const mapRendered = rendered[1];
			const viewContainer = E('div', {
				'class': 'podman-view-container'
			});

			// Add pull section first
			viewContainer.appendChild(formRendered);
			// Add toolbar outside map (persists during refresh)
			viewContainer.appendChild(toolbar.container);
			// Add map content
			viewContainer.appendChild(mapRendered);

			// Setup "select all" checkbox using helper
			this.listHelper.setupSelectAll(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Get selected image objects from checkboxes
	 * @returns {Array<Object>} Array of {id, name} objects for selected images
	 */
	getSelectedImages: function () {
		return this.listHelper.getSelected((image) => {
			return {
				id: image.Id,
				name: image._displayTag || '<none>:<none>'
			};
		});
	},

	/**
	 * Delete selected images
	 */
	handleDeleteSelected: function () {
		this.listHelper.bulkDelete({
			selected: this.getSelectedImages(),
			deletePromiseFn: (img) => podmanRPC.image.remove(img.name, false),
			formatItemName: (img) => img.name,
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Pull latest version of selected images
	 */
	handlePullLatestSelected: function () {
		const selected = this.getSelectedImages();

		if (selected.length === 0) {
			podmanUI.simpleTimeNotification(_('No images selected'), 'warning');
			return;
		}

		const imageNames = selected.map((img) => img.name).join(', ');
		if (!confirm(_('Pull latest version of %d image(s)?\n\n%s').format(selected.length,
				imageNames)))
			return;

		podmanUI.showSpinningModal(_('Pulling Images'), _(
			'Pulling latest version of %d image(s)...').format(selected.length));

		const pullPromises = selected.map((img) => podmanRPC.image.pull(img.name));

		Promise.all(pullPromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				podmanUI.errorNotification(_('Failed to pull %d image(s)').format(errors
					.length));
			} else {
				podmanUI.successTimeNotification(_('Successfully pulled %d image(s)')
					.format(selected.length));
			}
			this.handleRefresh();
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(_('Failed to pull some images: %s').format(err
				.message));
		});
	},

	/**
	 * Refresh image list
	 */
	handleRefresh: function (clearSelections) {
		clearSelections = clearSelections || false;
		this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Inspect an image and show details in modal
	 * @param {string} id - Image ID
	 */
	handleInspect: function (id) {
		this.listHelper.showInspect(id);
	}
});
