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
 * @module view.podman.volumes
 * @description Volume management view using proper LuCI form components
 */
return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	map: null,
	listHelper: null,

	/**
	 * Load volume data on view initialization
	 * @returns {Promise<Object>} Volume data wrapped in object
	 */
	load: async () => {
		return podmanRPC.volume.list()
			.then((volumes) => {
				return { volumes: volumes || [] };
			})
			.catch((err) => {
				return { error: err.message || _('Failed to load volumes') };
			});
	},

	/**
	 * Render the volumes view using form components
	 * @param {Object} data - Data from load()
	 * @returns {Element} Volumes view element
	 */
	render: function(data) {
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

		const section = this.map.section(form.TableSection, 'volumes', '', _(
			'Manage Podman volumes'));
		section.anonymous = true;

		let o;

		o = section.option(podmanForm.field.SelectDummyValue, 'Name', new ui.Checkbox(
		0, { hiddenname: 'all' }).render());

		o = section.option(podmanForm.field.LinkDataDummyValue, 'VolumeName', _('Name'));
		o.click = (volume) => this.handleInspect(volume.Name);
		o.text = (volume) => utils.truncate(volume.Name || _('Unknown'), 20);
		o.linktitle = (volume) => volume.Name || _('Unknown');

		o = section.option(podmanForm.field.DataDummyValue, 'Driver', _('Driver'));
		o.cfgdefault = _('local');

		o = section.option(podmanForm.field.DataDummyValue, 'Mountpoint', _('Mountpoint'));
		o.cfgdefault = _('N/A');
		o.cfgtitle = (cfg) => cfg;
		o.cfgformatter = (cfg) => utils.truncate(cfg, 30);

		o = section.option(podmanForm.field.DataDummyValue, 'CreatedAt', _('Created'));
		o.cfgformatter = (cfg) => utils.formatDate(Date.parse(cfg) / 1000);

		const toolbar = this.listHelper.createToolbar({
			onDelete: () => this.handleDeleteSelected(),
			onRefresh: () => this.handleRefresh(),
			onCreate: undefined,  // Will add multi-button instead
			customButtons: [{
				text: _('Export'),
				handler: () => this.handleExportSelected(),
				cssClass: 'save',
				tooltip: _('Export selected volumes')
			}]
		});

		const createButton = new podmanUI.MultiButton({}, 'add')
			.addItem(_('Create Volume'), () => this.handleCreateVolume())
			.addItem(_('Import Volume'), () => this.handleImportVolume())
			.render();
		toolbar.prependButton(createButton);

		return this.map.render().then((mapRendered) => {
			const viewContainer = E('div', { 'class': 'podman-view-container' });

			viewContainer.appendChild(toolbar.container);
			viewContainer.appendChild(mapRendered);

			this.listHelper.setupSelectAll(mapRendered);

			return viewContainer;
		});
	},

	/**
	 * Delete selected volumes
	 */
	handleDeleteSelected: function() {
		this.listHelper.bulkDelete({
			selected: this.listHelper.getSelected((volume) => volume.Name),
			deletePromiseFn: (name) => podmanRPC.volume.remove(name, false),
			onSuccess: () => this.handleRefresh(true)
		});
	},

	/**
	 * Refresh volume list
	 */
	handleRefresh: function(clearSelections) {
		clearSelections = clearSelections || false;
		this.listHelper.refreshTable(clearSelections);
	},

	/**
	 * Show create volume dialog
	 */
	handleCreateVolume: function() {
		const form = new podmanForm.Volume();
		form.submit = () => this.handleRefresh();
		form.render();
	},

	/**
	 * Show volume details
	 * @param {string} name - Volume name
	 */
	handleInspect: function(name) {
		this.listHelper.showInspect(name);
	},

	/**
	 * Export selected volumes
	 */
	handleExportSelected: function() {
		const selected = this.listHelper.getSelected((volume) => volume.Name);

		if (selected.length === 0) {
			ui.addTimeLimitedNotification(null, E('p', _('No volumes selected')), 3000, 'warning');
			return;
		}

		podmanUI.showSpinningModal(_('Exporting Volumes'), _('Exporting selected volumes...'));

		// Export each volume sequentially (can't do parallel because we download files)
		let exportIndex = 0;
		const exportNext = () => {
			if (exportIndex >= selected.length) {
				ui.hideModal();
				podmanUI.successTimeNotification(_('All volumes exported successfully'));
				return;
			}

			const volumeName = selected[exportIndex];
			exportIndex++;

			podmanRPC.volume.exportVolume(volumeName).then((result) => {
				if (result.error) {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to export volume %s: %s').format(volumeName, result.error));
					return;
				}

				const binaryData = atob(result.data);
				const bytes = new Uint8Array(binaryData.length);
				for (let i = 0; i < binaryData.length; i++) {
					bytes[i] = binaryData.charCodeAt(i);
				}
				const blob = new Blob([bytes], { type: 'application/x-tar' });
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
				podmanUI.errorNotification(_('Failed to export volume %s: %s').format(volumeName, err.message));
			});
		};

		exportNext();
	},

	/**
	 * Show import volume dialog
	 */
	handleImportVolume: function() {
		const fileInput = E('input', {
			'type': 'file',
			'accept': '.tar',
			'style': 'display: none'
		});

		fileInput.addEventListener('change', (ev) => {
			const file = ev.target.files[0];
			if (!file) return;

			const volumeName = file.name.replace(/\.tar$/, '');

			ui.showModal(_('Import Volume'), [
				E('p', {}, _('Import volume from tar file: %s').format(file.name)),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Volume Name')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'class': 'cbi-input-text',
							'id': 'import-volume-name',
							'value': volumeName,
							'placeholder': _('Enter volume name')
						})
					])
				]),
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.hideModal
					}, _('Cancel')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-positive',
						'click': () => {
							const name = document.getElementById('import-volume-name').value.trim();
							if (!name) {
								podmanUI.errorNotification(_('Volume name is required'));
								return;
							}

							ui.hideModal();
							podmanUI.showSpinningModal(_('Importing Volume'), _('Importing volume...'));

							const reader = new FileReader();
							reader.onload = (e) => {
								const arrayBuffer = e.target.result;
								const bytes = new Uint8Array(arrayBuffer);
								let binary = '';
								for (let i = 0; i < bytes.length; i++) {
									binary += String.fromCharCode(bytes[i]);
								}
								const base64Data = btoa(binary);

								podmanRPC.volume.importVolume(name, base64Data).then((result) => {
									ui.hideModal();
									if (result.error) {
										podmanUI.errorNotification(_('Failed to import volume: %s').format(result.error));
									} else {
										podmanUI.successTimeNotification(_('Volume imported successfully'));
										this.handleRefresh(false);
									}
								}).catch((err) => {
									ui.hideModal();
									podmanUI.errorNotification(_('Failed to import volume: %s').format(err.message));
								});
							};
							reader.onerror = () => {
								ui.hideModal();
								podmanUI.errorNotification(_('Failed to read file'));
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
