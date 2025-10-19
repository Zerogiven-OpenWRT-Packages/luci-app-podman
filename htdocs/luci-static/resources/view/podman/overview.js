'use strict';
'require view';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require ui';

/**
 * @module view.podman.overview
 * @description Overview dashboard for Podman LuCI application
 */
return view.extend({
	/**
	 * Load all system data on view initialization
	 * @returns {Promise<Array>} Array containing version, info, and resource lists
	 */
	load: function() {
		return Promise.all([
			podmanRPC.system.version(),
			podmanRPC.system.info(),
			podmanRPC.container.list('all=true'),
			podmanRPC.image.list(),
			podmanRPC.volume.list(),
			podmanRPC.network.list(),
			podmanRPC.pod.list(),
			podmanRPC.system.df()
		]);
	},

	/**
	 * Render the overview dashboard
	 * @param {Array} data - Array of loaded data [version, info, containers, images, volumes, networks, pods]
	 * @returns {Element} Overview view element
	 */
	render: function(data) {
		var version = data[0] || {};
		var info = data[1] || {};
		var containers = data[2] || [];
		var images = data[3] || [];
		// Handle volumes - can be wrapped in Volumes property or data array
		var volumeData = data[4] || [];
		var volumes = Array.isArray(volumeData) ? volumeData : (volumeData.Volumes || []);
		var networks = data[5] || [];
		var pods = data[6] || [];
		var diskUsage = data[7] || {};

		var runningContainers = containers.filter(function(c) { return c.State === 'running'; }).length;
		var runningPods = pods.filter(function(p) { return p.Status === 'Running'; }).length;

		var container = E('div', {}, [
			// System Actions Section (Auto-update, Prune)
			this.createSystemActionsSection(),

			// System Info Section
			this.createInfoSection(version, info),

			// Disk Usage Section
			this.createDiskUsageSection(diskUsage),

			// Resource Cards Section
			E('div', { 'style': 'margin-top: 30px;' }, [
				E('h3', { 'style': 'margin-bottom: 15px;' }, _('Resources')),
				this.createResourceCards(containers, pods, images, networks, volumes, runningContainers, runningPods)
			])
		]);

		return container;
	},

	/**
	 * Create system information section
	 * @param {Object} version - Version information
	 * @param {Object} info - System info
	 * @returns {Element} Info section element
	 */
	createInfoSection: function(version, info) {
		var memTotal = (info.host && info.host.memTotal) ? (info.host.memTotal / 1024 / 1024 / 1024).toFixed(2) : '0';
		var memFree = (info.host && info.host.memFree) ? (info.host.memFree / 1024 / 1024 / 1024).toFixed(2) : '0';

		return E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('h3', { 'style': 'margin-bottom: 15px;' }, _('Information')),
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width: 30%; font-weight: bold;' }, _('Podman Version')),
						E('td', { 'class': 'td' }, version.Version || _('Unknown'))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('API Version')),
						E('td', { 'class': 'td' }, version.ApiVersion || _('Unknown'))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('CPU')),
						E('td', { 'class': 'td' }, (info.host && info.host.cpus) ? info.host.cpus.toString() : _('Unknown'))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('Memory')),
						E('td', { 'class': 'td' }, memFree + ' GB / ' + memTotal + ' GB')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('Socket Path')),
						E('td', { 'class': 'td', 'style': 'font-family: monospace; font-size: 0.9em;' },
							(info.host && info.host.remoteSocket && info.host.remoteSocket.path) || '/run/podman/podman.sock')
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('Graph Root')),
						E('td', { 'class': 'td', 'style': 'font-family: monospace; font-size: 0.9em;' },
							(info.store && info.store.graphRoot) || _('Unknown'))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('Run Root')),
						E('td', { 'class': 'td', 'style': 'font-family: monospace; font-size: 0.9em;' },
							(info.store && info.store.runRoot) || _('Unknown'))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'font-weight: bold;' }, _('Registries')),
						E('td', { 'class': 'td', 'style': 'font-family: monospace; font-size: 0.9em;' },
							this.getRegistries(info))
					])
				])
			])
		]);
	},

	/**
	 * Get registries from info
	 * @param {Object} info - System info
	 * @returns {string} Comma-separated registries
	 */
	getRegistries: function(info) {
		if (info.registries && info.registries.search) {
			return info.registries.search.join(', ');
		}
		return 'docker.io, registry.fedoraproject.org, registry.access.redhat.com';
	},

	/**
	 * Create disk usage section
	 * @param {Object} diskUsage - Disk usage data
	 * @returns {Element} Disk usage section element
	 */
	createDiskUsageSection: function(diskUsage) {
		var imageSize = (diskUsage.Images && diskUsage.Images[0] && diskUsage.Images[0].Size) || 0;
		var imageReclaimable = (diskUsage.Images && diskUsage.Images[0] && diskUsage.Images[0].Reclaimable) || 0;
		var imageCount = (diskUsage.Images && diskUsage.Images[0] && diskUsage.Images[0].Count) || 0;

		var containerSize = (diskUsage.Containers && diskUsage.Containers[0] && diskUsage.Containers[0].Size) || 0;
		var containerReclaimable = (diskUsage.Containers && diskUsage.Containers[0] && diskUsage.Containers[0].Reclaimable) || 0;
		var containerCount = (diskUsage.Containers && diskUsage.Containers[0] && diskUsage.Containers[0].Count) || 0;

		var volumeSize = (diskUsage.Volumes && diskUsage.Volumes[0] && diskUsage.Volumes[0].Size) || 0;
		var volumeReclaimable = (diskUsage.Volumes && diskUsage.Volumes[0] && diskUsage.Volumes[0].Reclaimable) || 0;
		var volumeCount = (diskUsage.Volumes && diskUsage.Volumes[0] && diskUsage.Volumes[0].Count) || 0;

		return E('div', { 'class': 'cbi-section', 'style': 'margin-top: 20px;' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('h3', { 'style': 'margin-bottom: 15px;' }, _('Disk Usage')),
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr' }, [
						E('th', { 'class': 'th', 'style': 'font-weight: bold;' }, _('Type')),
						E('th', { 'class': 'th', 'style': 'font-weight: bold;' }, _('Count')),
						E('th', { 'class': 'th', 'style': 'font-weight: bold;' }, _('Size')),
						E('th', { 'class': 'th', 'style': 'font-weight: bold;' }, _('Reclaimable'))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, _('Images')),
						E('td', { 'class': 'td' }, String(imageCount)),
						E('td', { 'class': 'td' }, utils.formatBytes(imageSize)),
						E('td', { 'class': 'td' }, utils.formatBytes(imageReclaimable))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, _('Containers')),
						E('td', { 'class': 'td' }, String(containerCount)),
						E('td', { 'class': 'td' }, utils.formatBytes(containerSize)),
						E('td', { 'class': 'td' }, utils.formatBytes(containerReclaimable))
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, _('Volumes')),
						E('td', { 'class': 'td' }, String(volumeCount)),
						E('td', { 'class': 'td' }, utils.formatBytes(volumeSize)),
						E('td', { 'class': 'td' }, utils.formatBytes(volumeReclaimable))
					])
				])
			])
		]);
	},

	/**
	 * Create resource cards section
	 * @param {Array} containers - Container list
	 * @param {Array} pods - Pod list
	 * @param {Array} images - Image list
	 * @param {Array} networks - Network list
	 * @param {Array} volumes - Volume list
	 * @param {number} runningContainers - Running container count
	 * @param {number} runningPods - Running pod count
	 * @returns {Element} Cards container element
	 */
	createResourceCards: function(containers, pods, images, networks, volumes, runningContainers, runningPods) {
		return E('div', {
			'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;'
		}, [
			this.createCard('Containers', containers.length, runningContainers, 'admin/podman/containers', '#3498db'),
			this.createCard('Pods', pods.length, runningPods, 'admin/podman/pods', '#2ecc71'),
			this.createCard('Images', images.length, null, 'admin/podman/images', '#9b59b6'),
			this.createCard('Networks', networks.length, null, 'admin/podman/networks', '#e67e22'),
			this.createCard('Volumes', volumes.length, null, 'admin/podman/volumes', '#34495e')
		]);
	},

	/**
	 * Create a resource card
	 * @param {string} title - Card title
	 * @param {number} total - Total count
	 * @param {number|null} running - Running count (null if not applicable)
	 * @param {string} url - Link URL
	 * @param {string} color - Card accent color
	 * @returns {Element} Card element
	 */
	createCard: function(title, total, running, url, color) {
		var statsText = running !== null ? running + ' / ' + total : total.toString();

		return E('a', {
			'href': L.url(url),
			'style': 'text-decoration: none; color: inherit; display: block;'
		}, [
			E('div', {
				'class': 'cbi-section',
				'style': 'cursor: pointer; transition: all 0.2s; border-left: 4px solid ' + color + '; min-height: 120px; display: flex; flex-direction: column; justify-content: space-between; padding: 15px; margin: 0;'
			}, [
				E('div', { 'style': 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;' }, [
					E('span', { 'style': 'font-size: 14px; opacity: 0.8;' }, _(title)),
					this.getIcon(title, color)
				]),
				E('div', {}, [
					E('div', { 'style': 'font-size: 32px; font-weight: bold; color: ' + color + ';' }, statsText),
					running !== null ?
						E('div', { 'style': 'font-size: 12px; opacity: 0.7; margin-top: 5px;' },
							_('running') + ' / ' + _('total')) :
						E('div', { 'style': 'font-size: 12px; opacity: 0.7; margin-top: 5px;' }, _('total'))
				])
			])
		]);
	},

	/**
	 * Get icon for resource type
	 * @param {string} type - Resource type
	 * @param {string} color - Icon color
	 * @returns {Element} Icon element
	 */
	getIcon: function(type, color) {
		var icon = '📦';
		switch(type) {
			case 'Containers':
				icon = '🐳';
				break;
			case 'Pods':
				icon = '🔗';
				break;
			case 'Images':
				icon = '💿';
				break;
			case 'Networks':
				icon = '🌐';
				break;
			case 'Volumes':
				icon = '💾';
				break;
		}

		return E('span', { 'style': 'font-size: 24px; opacity: 0.6;' }, icon);
	},

	/**
	 * Create system actions section with buttons for maintenance tasks
	 * @returns {Element} System actions section
	 */
	createSystemActionsSection: function() {
		return E('div', { 'class': 'cbi-section', 'style': 'margin-bottom: 20px;' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('h3', { 'style': 'margin-bottom: 15px;' }, _('System Maintenance')),
				E('div', { 'style': 'display: flex; gap: 10px; flex-wrap: wrap;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': L.bind(this.handleAutoUpdate, this)
					}, _('Auto-Update Containers')),
					E('button', {
						'class': 'cbi-button cbi-button-remove',
						'click': L.bind(this.handlePrune, this)
					}, _('Cleanup / Prune'))
				])
			])
		]);
	},

	/**
	 * Handle auto-update action
	 */
	handleAutoUpdate: function() {
		var self = this;

		// First do dry-run to show what would be updated
		ui.showModal(_('Auto-Update Check'), [
			E('p', {}, _('Checking for container updates...')),
			E('div', { 'class': 'center' }, [
				E('em', { 'class': 'spinning' }, _('Loading...'))
			])
		]);

		podmanRPC.system.autoUpdate(true).then(function(result) {
			var updates = result.Updates || [];

			if (updates.length === 0) {
				ui.showModal(_('Auto-Update'), [
					E('p', {}, _('No containers are configured for auto-update or all containers are up to date.')),
					E('p', { 'style': 'margin-top: 10px; font-size: 0.9em; opacity: 0.8;' },
						_('To enable auto-update, add label io.containers.autoupdate=registry to your containers.')),
					E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
						E('button', {
							'class': 'cbi-button',
							'click': ui.hideModal
						}, _('Close'))
					])
				]);
				return;
			}

			// Show updates available
			var updateList = updates.map(function(update) {
				var status = update.Updated ? '✓ ' + _('Updated') : '○ ' + _('Available');
				return E('li', {}, update.ContainerName + ' - ' + status);
			});

			ui.showModal(_('Auto-Update Available'), [
				E('p', {}, _('The following containers can be updated:')),
				E('ul', { 'style': 'margin: 10px 0; padding-left: 20px;' }, updateList),
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-negative',
						'click': ui.hideModal
					}, _('Cancel')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-positive',
						'click': function() {
							ui.hideModal();
							self.performAutoUpdate();
						}
					}, _('Update Now'))
				])
			]);
		}).catch(function(err) {
			ui.showModal(_('Error'), [
				E('p', {}, _('Failed to check for updates: %s').format(err.message)),
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		});
	},

	/**
	 * Perform actual auto-update
	 */
	performAutoUpdate: function() {
		ui.showModal(_('Updating Containers'), [
			E('p', {}, _('Updating containers, please wait...')),
			E('div', { 'class': 'center' }, [
				E('em', { 'class': 'spinning' }, _('Loading...'))
			])
		]);

		podmanRPC.system.autoUpdate(false).then(function(result) {
			var updates = result.Updates || [];
			var successful = updates.filter(function(u) { return u.Updated; }).length;

			ui.showModal(_('Auto-Update Complete'), [
				E('p', {}, _('Updated %d container(s) successfully.').format(successful)),
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', {
						'class': 'cbi-button',
						'click': function() {
							ui.hideModal();
							window.location.reload();
						}
					}, _('Close'))
				])
			]);
		}).catch(function(err) {
			ui.showModal(_('Error'), [
				E('p', {}, _('Auto-update failed: %s').format(err.message)),
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		});
	},

	/**
	 * Handle cleanup/prune action
	 */
	handlePrune: function() {
		var self = this;

		ui.showModal(_('Cleanup Unused Resources'), [
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, _('Select what to clean up:')),
				E('div', { 'style': 'margin: 15px 0;' }, [
					E('label', { 'style': 'display: block; margin: 8px 0;' }, [
						E('input', { 'type': 'checkbox', 'id': 'prune-all-images', 'checked': '' }),
						' ',
						_('Remove all unused images (not just dangling)')
					]),
					E('label', { 'style': 'display: block; margin: 8px 0;' }, [
						E('input', { 'type': 'checkbox', 'id': 'prune-volumes' }),
						' ',
						_('Remove unused volumes')
					])
				]),
				E('p', { 'style': 'margin-top: 15px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107;' }, [
					E('strong', {}, _('Warning:')),
					' ',
					_('This will permanently delete unused containers, images, networks, and optionally volumes.')
				])
			]),
			E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'click': function() {
						var allImages = document.getElementById('prune-all-images').checked;
						var volumes = document.getElementById('prune-volumes').checked;
						ui.hideModal();
						self.performPrune(allImages, volumes);
					}
				}, _('Clean Up Now'))
			])
		]);
	},

	/**
	 * Perform system prune
	 */
	performPrune: function(allImages, volumes) {
		ui.showModal(_('Cleaning Up'), [
			E('p', {}, _('Removing unused resources, please wait...')),
			E('div', { 'class': 'center' }, [
				E('em', { 'class': 'spinning' }, _('Loading...'))
			])
		]);

		podmanRPC.system.prune(allImages, volumes).then(function(result) {
			var freedSpace = 0;
			var deletedItems = [];

			if (result.ContainerPruneReports) {
				result.ContainerPruneReports.forEach(function(r) {
					if (r.Size) freedSpace += r.Size;
				});
				if (result.ContainerPruneReports.length > 0) {
					deletedItems.push(result.ContainerPruneReports.length + _(' containers'));
				}
			}

			if (result.ImagePruneReports) {
				result.ImagePruneReports.forEach(function(r) {
					if (r.Size) freedSpace += r.Size;
				});
				if (result.ImagePruneReports.length > 0) {
					deletedItems.push(result.ImagePruneReports.length + _(' images'));
				}
			}

			if (result.VolumePruneReports) {
				result.VolumePruneReports.forEach(function(r) {
					if (r.Size) freedSpace += r.Size;
				});
				if (result.VolumePruneReports.length > 0) {
					deletedItems.push(result.VolumePruneReports.length + _(' volumes'));
				}
			}

			ui.showModal(_('Cleanup Complete'), [
				E('p', {}, _('Cleanup successful!')),
				deletedItems.length > 0 ?
					E('p', { 'style': 'margin-top: 10px;' }, _('Removed: %s').format(deletedItems.join(', '))) :
					E('p', { 'style': 'margin-top: 10px;' }, _('No unused resources found')),
				E('p', { 'style': 'margin-top: 10px; font-weight: bold; color: #27ae60;' },
					_('Space freed: %s').format(utils.formatBytes(freedSpace))),
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', {
						'class': 'cbi-button',
						'click': function() {
							ui.hideModal();
							window.location.reload();
						}
					}, _('Close'))
				])
			]);
		}).catch(function(err) {
			ui.showModal(_('Error'), [
				E('p', {}, _('Cleanup failed: %s').format(err.message)),
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
