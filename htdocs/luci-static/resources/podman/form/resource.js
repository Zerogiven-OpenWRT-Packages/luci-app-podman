'use strict';

'require baseclass';
'require form';
'require ui';

'require podman.ui as podmanUI';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormResource',
		map: null,
		containerId: null,

		/**
		 * Render the resource editor form
		 * @param {string} containerId - Container ID
		 * @param {Object} containerData - Container inspect data
		 * @returns {Promise<HTMLElement>} Rendered form element
		 */
		render: async function (containerId, containerData) {
			this.containerId = containerId;
			const hostConfig = containerData.HostConfig || {};

			const data = {
				resources: {
					cpuLimit: hostConfig.CpuQuota > 0 ? (hostConfig.CpuQuota / 100000).toFixed(
						2) : '',
					cpuShares: hostConfig.CpuShares || '',
					memory: hostConfig.Memory > 0 ? format.bytes(hostConfig.Memory, 0) : '',
					memorySwap: hostConfig.MemorySwap > 0 ? format.bytes(hostConfig
						.MemorySwap, 0) : '',
					blkioWeight: hostConfig.BlkioWeight || ''
				}
			};

			this.map = new form.JSONMap(data, _('Resource Limits'));
			const section = this.map.section(form.NamedSection, 'resources', 'resources');

			let field;

			field = section.option(form.Value, 'cpuLimit', _('CPU Limit'));
			field.datatype = 'ufloat';
			field.placeholder = '0.5, 1.0, 2.0';
			field.optional = true;
			field.description = _('Number of CPUs (e.g., 0.5, 1.0, 2.0)') + ' ' + _('Leave empty for unlimited.');

			field = section.option(form.Value, 'cpuShares', _('CPU Shares Weight'));
			field.datatype = 'uinteger';
			field.placeholder = '1024';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (value && (parseInt(value) < 0 || parseInt(value) > 262144)) {
					return _('Must be between 0 and 262144');
				}
				return true;
			};
			field.description = _('CPU shares (relative weight), default is 1024. 0 = use default.');

			field = section.option(form.Value, 'memory', _('Memory Limit'));
			field.placeholder = '512m, 1g, 2g';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (!/^\d+(?:\.\d+)?\s*[kmg]?b?$/i.test(value)) {
					return _('Invalid format.') + ' ' + _('Use: 512m, 1g');
				}
				return true;
			};
			field.description = _('Memory limit (e.g., 512m, 1g)') + ' ' + _('Leave empty for unlimited.');

			field = section.option(form.Value, 'memorySwap', _('Memory + Swap Limit'));
			field.placeholder = '1g, 2g, -1';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (value === '-1') return true;
				if (!/^\d+(?:\.\d+)?\s*[kmg]?b?$/i.test(value)) {
					return _('Invalid format.') + ' ' + _('Use: 512m, 1g, or -1 for unlimited swap');
				}
				return true;
			};
			field.description = _('Total memory limit (memory + swap). -1 for unlimited swap.');

			field = section.option(form.Value, 'blkioWeight', _('Block IO Weight'));
			field.datatype = 'uinteger';
			field.placeholder = '500';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (value && (parseInt(value) < 10 || parseInt(value) > 1000) && parseInt(
					value) !== 0) {
					return _('Must be 0 or between 10 and 1000');
				}
				return true;
			};
			field.description = _('Block IO weight (relative weight), 10-1000. 0 = use default.');

			field = section.option(form.Button, '_update', ' ');
			field.inputtitle = _('Update Resources');
			field.inputstyle = 'save';
			field.onclick = () => this.handleUpdate();

			return this.map.render();
		},

		/**
		 * Handle resource update
		 */
		handleUpdate: function () {
			this.map.save().then(() => {
				const resources = this.map.data.data.resources;

				const memory = format.parseMemory(resources.memory, true);
				const memorySwap = resources.memorySwap === '-1' ? -1 : format.parseMemory(
					resources.memorySwap, true);

				if (memory === null && resources.memory) {
					podmanUI.errorNotification(_('Invalid format.') + ' ' + _('Use: 512m, 1g'));
					return;
				}
				if (memorySwap === null && resources.memorySwap && resources.memorySwap !==
					'-1') {
					podmanUI.errorNotification(_('Invalid format.') + ' ' + _('Use: 512m, 1g, or -1 for unlimited swap'));
					return;
				}

				const updateData = {};

				updateData.cpu = {};
				if (resources.cpuLimit) {
					// Podman uses 100000 microseconds (100ms) as the period
					const period = 100000;
					updateData.cpu.quota = Math.floor(parseFloat(resources.cpuLimit) *
						period);
					updateData.cpu.period = period;
				} else {
					updateData.cpu.quota = 0;
					updateData.cpu.period = 0;
				}
				updateData.cpu.shares = parseInt(resources.cpuShares) || 0;

				updateData.memory = {};
				updateData.memory.limit = memory > 0 ? memory : 0;
				if (memorySwap !== 0) {
					updateData.memory.swap = memorySwap;
				} else {
					updateData.memory.swap = 0;
				}

				updateData.blockIO = {
					weight: parseInt(resources.blkioWeight) || 0
				};

				podmanUI.showSpinningModal(_('Updating Resources'), _(
					'Updating container resources...'));

				podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then(
					(result) => {
						ui.hideModal();
						if (result && result.error) {
							podmanUI.errorNotification(_('Failed to update resources: %s')
								.format(result.error));
						} else {
							podmanUI.successTimeNotification(_(
								'Resources updated successfully'));
							session.setLocalData('podman_active_tab', 'resources');
							window.location.reload();
						}
					}).catch((err) => {
						ui.hideModal();
						podmanUI.errorNotification(_('Failed to update resources: %s').format(
							err.message));
					});
			}).catch(() => { });
		}
	})
});
