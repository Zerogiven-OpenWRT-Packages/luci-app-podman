'use strict';

'require view';
'require form';
'require ui';

'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.format as format';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';

utils.addPodmanCss();

/**
 * Image management view with pull, inspect, and delete operations
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load image data and expand multi-tag images
	 * @returns {Promise<Object>} Image data or error
	 */
	load: async () => {
		return podmanRPC.image.list()
			.then((images) => {
				return {
					images: images || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed')
				};
			});
	},

	/**
	 * Render images view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function(data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		this.listHelper = new List.Util({
			itemName: 'image',
			rpc: podmanRPC.image,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Images'));

		const section = this.map.section(
			form.TableSection,
			'images',
			'',
			_('Manage Podman %s').format(_('Images').toLowerCase())
		);
		section.anonymous = true;

		let o;

		o = section.option(
			podmanForm.field.SelectDummyValue,
			'ID',
			new ui.Checkbox(0, { hiddenname: 'all' }).render()
		);

		o = section.option(form.DummyValue, 'Repository', _('Repository'));
		o.cfgvalue = (sectionId) => {
			const image = this.map.data.data[sectionId];
			const tag = image._displayTag || '<none>:<none>';
			const parts = tag.split(':');
			return E('strong', {}, parts[0] || '<none>');
		};

		o = section.option(form.DummyValue, 'Tag', _('Tag'));
		o.cfgvalue = (sectionId) => {
			const image = this.map.data.data[sectionId];
			const tag = image._displayTag || '<none>:<none>';
			const parts = tag.split(':');
			const tagValue = parts[1] || '<none>';

			if (tagValue.length > 14) {
				return E(
					'span',
					{ 'title': tagValue, 'class': 'tt' },
					tagValue.substring(0, 14) + '...'
				);
			}

			return tagValue;
		};

		o = section.option(podmanForm.field.LinkDataDummyValue, 'ImageId', _('Image ID'));
		o.click = (image) => this.handleInspect(image.Id);
		o.text = (image) => utils.truncate(image.Id ? image.Id.substring(7, 19) : '', 10);

		o = section.option(podmanForm.field.DataDummyValue, 'Size', _('Size'));
		o.cfgformatter = format.bytes;

		o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
		o.cfgformatter = format.date;

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

		const formImage = new podmanForm.Image.init();
		formImage.submit = () => this.handleRefresh();

		return Promise.all([
			formImage.render(),
			this.map.render(),
		]).then((rendered) => {
			const formRendered = rendered[0];
			const mapRendered = rendered[1];
			const viewContainer = E('div', {
				'class': 'podman-view-list'
			});

			viewContainer.appendChild(formRendered);
			viewContainer.appendChild(toolbar.container);
			viewContainer.appendChild(mapRendered);

			this.listHelper.setupSelectAll(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Get selected images
	 * @returns {Array<Object>} Array of {id, name} objects
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
			podmanUI.simpleTimeNotification(_('No %s selected').format(_('Images').toLowerCase()), 'warning');
			return;
		}

		const imageNames = selected.map((img) => img.name).join(', ');
		const confirmText = _('Pull latest version of %d %s?\n\n%s').format(
			selected.length,
			utils._n(selected.length, _('Image'), _('Images')).toLowerCase(),
			imageNames
		);
		if (!confirm(confirmText))
			return;

		podmanUI.showSpinningModal(
			_('Pulling Images'),
			_('Pulling latest version of %d %s...').format(
				selected.length,
				utils._n(selected.length, _('Image'), _('Images')).toLowerCase()
			)
		);

		const pullPromises = selected.map((img) => podmanRPC.image.pull(img.name));

		Promise.all(pullPromises).then((results) => {
			ui.hideModal();
			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				podmanUI.errorNotification(
					_('Failed to pull %d %s').format(
						errors.length,
						utils._n(errors.length, _('Image'), _('Images')).toLowerCase()
					)
				);
			} else {
				podmanUI.successTimeNotification(
					_('Successfully pulled %d %s').format(
						selected.length,
						utils._n(selected.length, _('Image'), _('Images')).toLowerCase()
					)
				);
			}
			this.handleRefresh();
		}).catch((err) => {
			ui.hideModal();
			podmanUI.errorNotification(
				_('Failed to pull some images: %s').format(err.message)
			);
		});
	},

	/**
	 * Refresh image list
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	handleRefresh: function (clearSelections) {
		clearSelections = clearSelections || false;
		this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Show image inspect modal
	 * @param {string} id - Image ID
	 */
	handleInspect: function (id) {
		this.listHelper.showInspect(id);
	}
});
