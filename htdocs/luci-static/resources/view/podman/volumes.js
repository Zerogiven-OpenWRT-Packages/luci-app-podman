'use strict';

'require view';
'require form';
'require ui';

'require fs';
'require podman.utils as utils';
'require podman.format as format';
'require podman.list as List';
'require podman.rpc as podmanRPC';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';

utils.addPodmanCss();

/**
 * Volume management view with create, import, export, and delete operations
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load volume data
	 * @returns {Promise<Object>} Volume data or error
	 */
	load: async () => {
		return podmanRPC.volume.list()
			.then((volumes) => {
				// Sort volumes alphabetically by name
				if (volumes && volumes.length > 0) {
					volumes.sort((a, b) => {
						const nameA = (a.Name || '').toLowerCase();
						const nameB = (b.Name || '').toLowerCase();
						return nameA.localeCompare(nameB);
					});
				}
				return {
					volumes: volumes || []
				};
			})
			.catch((err) => {
				return {
					error: err.message || _('Failed')
				};
			});
	},

	/**
	 * Render volumes view
	 * @param {Object} data - Data from load()
	 * @returns {Element} Rendered view element
	 */
	render: function (data) {
		if (data && data.error) {
			return utils.renderError(data.error);
		}

		this.listHelper = new List.Util({
			itemName: 'volume',
			rpc: podmanRPC.volume,
			data: data,
			view: this
		});

		this.map = new form.JSONMap(this.listHelper.data, _('Volumes'));

		const section = this.map.section(
			form.TableSection,
			'volumes',
			'',
			_('Manage Podman %s').format(_('Volumes').toLowerCase())
		);
		section.anonymous = true;

		let o;

		o = section.option(
			podmanForm.field.SelectDummyValue,
			'ID',
			new ui.Checkbox(0, {
				hiddenname: 'all'
			}).render()
		);

		o = section.option(podmanForm.field.LinkDataDummyValue, 'VolumeName', _('Name'));
		o.click = (volume) => this.handleInspect(volume.Name);
		o.text = (volume) => utils.truncate(volume.Name || _('Unknown'), 20);
		o.linktitle = (volume) => volume.Name || _('Unknown');

		o = section.option(podmanForm.field.DataDummyValue, 'Driver', _('Driver'));
		o.cfgdefault = 'local';

		o = section.option(podmanForm.field.DataDummyValue, 'Mountpoint', _('Mountpoint'));
		o.cfgdefault = _('N/A');
		o.cfgtitle = (cfg) => cfg;
		o.cfgformatter = (cfg) => utils.truncate(cfg, 30);

		o = section.option(podmanForm.field.DataDummyValue, 'CreatedAt', _('Created'));
		o.cfgformatter = format.date;

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: undefined, // Will add multi-button instead
			customButtons: [{
				text: _('Export'),
				handler: () => this.handleExportSelected(),
				cssClass: 'save',
				tooltip: _('Export selected volumes')
			}]
		});

		const createButton = new podmanUI.MultiButton({}, 'add')
			.addItem(_('Create %s').format(_('Volume')), () => this.handleCreateVolume())
			.addItem(_('Import Volume'), () => this.handleImportVolume())
			.render();
		toolbar.prependButton(createButton);

		return this.map.render().then((mapRendered) => {
			const viewContainer = E('div', {
				'class': 'podman-view-list'
			});

			viewContainer.appendChild(toolbar.container);
			viewContainer.appendChild(mapRendered);

			this.listHelper.setupSelectAll(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Delete selected volumes
	 */
	handleDeleteSelected: function () {
		this.listHelper.bulkDelete({
			selected: this.listHelper.getSelected((volume) => volume.Name),
			deletePromiseFn: (name) => podmanRPC.volume.remove(name, false),
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Refresh volume list
	 * @param {boolean} clearSelections - Clear checkbox selections
	 */
	handleRefresh: function (clearSelections) {
		clearSelections = clearSelections || false;
		this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Show create volume form
	 */
	handleCreateVolume: function () {
		const form = new podmanForm.Volume.init();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Show volume inspect modal
	 * @param {string} name - Volume name
	 */
	handleInspect: function (name) {
		this.listHelper.showInspect(name);
	},

	/**
	 * Export selected volumes as tar.gz files
	 */
	handleExportSelected: function () {
		const selected = this.listHelper.getSelected((volume) => volume.Name);

		if (selected.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format(_('Volumes')
			.toLowerCase()));
			return;
		}

		podmanUI.showSpinningModal(_('Exporting Volumes'), _('Exporting selected volumes...'));

		let exportIndex = 0;
		const exportNext = () => {
			if (exportIndex >= selected.length) {
				this.listHelper.unselectAll();
				ui.hideModal();
				podmanUI.successTimeNotification(_('All volumes exported successfully'));
				return;
			}

			const volumeName = selected[exportIndex];
			exportIndex++;

			fs.exec_direct('/usr/libexec/podman-api', ['volume_export', volumeName], 'blob')
				.then((blob) => {
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `${volumeName}.tar`;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
					URL.revokeObjectURL(url);

					exportNext();
				}).catch((err) => {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to export volume %s: %s').format(
						volumeName, err.message));
				});
		};

		exportNext();
	},

	/**
	 * Show import volume dialog with file picker
	 */
	handleImportVolume: function () {
		const fileInput = E('input', {
			'type': 'file',
			'accept': '.tar,.tar.gz,.tgz',
			'class': 'hidden'
		});

		fileInput.addEventListener('change', (ev) => {
			const file = ev.target.files[0];
			if (!file) return;

			// Detect if file is compressed based on extension
			const isCompressed = file.name.endsWith('.tar.gz') || file.name.endsWith(
				'.tgz');
			const volumeName = file.name.replace(/\.(tar\.gz|tgz|tar)$/, '');

			ui.showModal(_('Import Volume'), [
				E('p', {}, _('Import volume from archive: %s').format(file.name)),
				E('div', {
					'class': 'cbi-value'
				}, [
					E('label', {
						'class': 'cbi-value-title'
					}, _('Volume Name')),
					E('div', {
						'class': 'cbi-value-field'
					}, [
						E('input', {
							'type': 'text',
							'class': 'cbi-input-text',
							'id': 'import-volume-name',
							'value': volumeName,
							'placeholder': _('Enter volume name')
						})
					])
				]),
				E('div', {
					'class': 'right'
				}, [
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.hideModal
					}, _('Cancel')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-positive',
						'click': () => {
							const name = document.getElementById(
								'import-volume-name').value.trim();
							if (!name) {
								podmanUI.errorNotification(_(
										'Volume name is required'
										));
								return;
							}

							ui.hideModal();
							podmanUI.showSpinningModal(_(
								'Importing Volume'), _(
								'Importing volume...'));

							// Read file and encode to base64
							const reader = new FileReader();
							reader.onload = (e) => {
								const arrayBuffer = e.target
									.result;
								const bytes = new Uint8Array(
									arrayBuffer);
								let binary = '';
								for (let i = 0; i < bytes
									.length; i++) {
									binary += String.fromCharCode(
										bytes[i]);
								}
								const base64Data = btoa(binary);

								fs.exec_direct(
									'/usr/libexec/podman-api',
									[
										'volume_import',
										name,
										isCompressed ? '1' :
										'0',
										base64Data
									], 'text').then(() => {
									ui.hideModal();
									podmanUI
										.successTimeNotification(
											_(
												'Volume imported successfully')
											);
									this.handleRefresh(
										false);
								}).catch((err) => {
									ui.hideModal();
									podmanUI
										.errorNotification(
											_(
												'Failed to import volume: %s')
											.format(err
												.message)
											);
								});
							};
							reader.onerror = () => {
								ui.hideModal();
								podmanUI.errorNotification(_(
										'Failed to read file'
										));
							};
							reader.readAsArrayBuffer(file);
						}
					}, _('Import'))
				])
			]);
		});

		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
	}
});
