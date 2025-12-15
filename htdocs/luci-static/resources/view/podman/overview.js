'use strict';

'require view';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.format as format';
'require podman.ui as pui';
'require ui';

/**
 * Podman Overview Dashboard View
 */
return view.extend({
	/**
	 * Load Phase 1 data (fast) on view initialization
	 * Phase 2 data (slower) is loaded after render in loadPhase2()
	 *
	 * @returns {Promise<Array>} Promise resolving to array of:
	 *   [0] version - Podman version information
	 *   [1] info - System info (CPU, memory, paths, registries)
	 */
	load: function () {
		// Phase 1: Fast initial load - version and system info only
		return Promise.all([
			podmanRPC.system.version(),
			podmanRPC.system.info()
		]);
	},

	/**
	 * Render the overview dashboard with tab-based UI
	 * Tab 1 (Overview): Shows Phase 1 data immediately, then loads Phase 2 resource data
	 * Tab 2 (Disk Usage): Load on demand with button
	 *
	 * @param {Array} data - Array from load() (Phase 1 data only)
	 * @returns {Element} Complete dashboard view with tabs
	 */
	render: function (data) {
		// Phase 1 data (loaded immediately)
		const version = data[0] || {};
		const info = data[1] || {};

		// Tab 1: Overview (loads immediately)
		const overviewTabContent = E('div', {}, [
			this.createSystemActionsSection(),
			this.createInfoSection(version, info),
			E('div', {
				'id': 'resource-cards-container',
				'style': 'margin-top: 30px;'
			}, [
				E('h3', {
					'style': 'margin-bottom: 15px;'
				}, _('Resources')),
				this.createLoadingPlaceholder(_('Resources'))
			])
		]);

		// Tab 2: Disk Usage (load on demand)
		const diskUsageTabContent = E('div', {
			'id': 'disk-usage-tab-content'
		}, [
			this.createDiskUsageLoadButton()
		]);

		// Create tabs
		const tabs = new pui.Tabs('overview')
			.addTab('overview', _('Overview'), overviewTabContent, true)
			.addTab('disk-usage', _('Disk Usage'), diskUsageTabContent)
			.render();

		// Start Phase 2 loading for Overview tab only
		this.loadPhase2Overview();

		return tabs;
	},

	/**
	 * Load Phase 2 data for Overview tab (fast endpoints only)
	 * No longer loads system.df() - that's in Disk Usage tab on demand
	 */
	loadPhase2Overview: function () {
		Promise.all([
			podmanRPC.container.list('all=true'),
			podmanRPC.image.list(),
			podmanRPC.volume.list(),
			podmanRPC.network.list(),
			podmanRPC.pod.list()
		]).then((data) => {
			const containers = data[0] || [];
			const images = data[1] || [];
			// Handle volumes - can be wrapped in Volumes property or data array
			const volumeData = data[2] || [];
			const volumes = Array.isArray(volumeData) ? volumeData : (volumeData.Volumes || []);
			const networks = data[3] || [];
			const pods = data[4] || [];

			const runningContainers = containers.filter((c) => c.State === 'running').length;
			const runningPods = pods.filter((p) => p.Status === 'Running').length;

			// Update Resource Cards section
			const resourceCardsContainer = document.getElementById('resource-cards-container');
			if (resourceCardsContainer) {
				resourceCardsContainer.innerHTML = '';
				resourceCardsContainer.appendChild(
					E('h3', {
						'style': 'margin-bottom: 15px;'
					}, _('Resources'))
				);
				resourceCardsContainer.appendChild(
					this.createResourceCards(containers, pods, images, networks, volumes,
						runningContainers, runningPods)
				);
			}
		}).catch((err) => {
			const resourceCardsContainer = document.getElementById('resource-cards-container');
			if (resourceCardsContainer) {
				resourceCardsContainer.innerHTML = '';
				resourceCardsContainer.appendChild(
					E('p', {
						'class': 'alert-message error'
					}, _('Failed to load resources: %s').format(err.message))
				);
			}
		});
	},

	/**
	 * Create a loading placeholder for lazy-loaded sections
	 *
	 * @param {string} title - Section title being loaded
	 * @returns {Element} Loading placeholder element
	 */
	createLoadingPlaceholder: function (title) {
		return E('div', {
			'class': 'cbi-section',
			'style': 'text-align: center; padding: 30px;'
		}, [
			E('em', {
				'class': 'spinning'
			}, _('Loading %s...').format(title))
		]);
	},

	/**
	 * Create system information section
	 *
	 * @param {Object} version - Podman version information (Version, ApiVersion)
	 * @param {Object} info - System information object containing:
	 *   - host: {cpus, memTotal, memFree, remoteSocket}
	 *   - store: {graphRoot, runRoot}
	 *   - registries: {search}
	 * @returns {Element} System information section element
	 */
	createInfoSection: function (version, info) {
		const memTotal = (info.host && info.host.memTotal) ? (info.host.memTotal / 1024 / 1024 /
			1024).toFixed(2) : '0';
		const memFree = (info.host && info.host.memFree) ? (info.host.memFree / 1024 / 1024 /
				1024)
			.toFixed(2) : '0';

		const table = new pui.Table()
			.addInfoRow(_('Podman Version'), version.Version || _('Unknown'))
			.addInfoRow(_('API Version'), version.ApiVersion || _('Unknown'))
			.addInfoRow(_('CPU'), (info.host && info.host.cpus) ? info.host.cpus.toString() : _(
				'Unknown'))
			.addInfoRow(_('Memory'), memFree + ' GB / ' + memTotal + ' GB')
			.addInfoRow(_('Socket Path'),
				E('span', {
						'style': 'font-family: monospace; font-size: 0.9em;'
					},
					(info.host && info.host.remoteSocket && info.host.remoteSocket.path) ||
					'/run/podman/podman.sock'))
			.addInfoRow(_('Graph Root'),
				E('span', {
						'style': 'font-family: monospace; font-size: 0.9em;'
					},
					(info.store && info.store.graphRoot) || _('Unknown')))
			.addInfoRow(_('Run Root'),
				E('span', {
						'style': 'font-family: monospace; font-size: 0.9em;'
					},
					(info.store && info.store.runRoot) || _('Unknown')))
			.addInfoRow(_('Registries'),
				E('span', {
						'style': 'font-family: monospace; font-size: 0.9em;'
					},
					this.getRegistries(info)));

		const section = new pui.Section();
		section.addNode(_('Information'), '', table.render());
		return section.render();
	},

	/**
	 * Get configured container image registries
	 *
	 * @param {Object} info - System info object with registries.search array
	 * @returns {string} Comma-separated list of registry URLs
	 */
	getRegistries: function (info) {
		if (info.registries && info.registries.search) {
			return info.registries.search.join(', ');
		}
		return 'docker.io, registry.fedoraproject.org, registry.access.redhat.com';
	},

	/**
	 * Create disk usage tab content with load button
	 * @returns {Element} Container with button to trigger system.df() call
	 */
	createDiskUsageLoadButton: function () {
		const button = new pui.Button(
			_('Load Disk Usage Statistics'),
			() => this.loadDiskUsage(),
			'action'
		).render();

		const description = E('p', {
			'style': 'margin: 15px 0 10px 0; color: #666; font-size: 0.9em;'
		}, _('Click to load detailed disk usage information for containers, images, and volumes. This may take several seconds with many resources.'));

		return E('div', {
			'style': 'padding: 20px;'
		}, [description, button]);
	},

	/**
	 * Load disk usage data on demand (called from Disk Usage tab)
	 * Replaces load button with actual disk usage statistics
	 */
	loadDiskUsage: function () {
		const diskUsageTabContent = document.getElementById('disk-usage-tab-content');
		if (!diskUsageTabContent) return;

		// Show loading state
		diskUsageTabContent.innerHTML = '';
		diskUsageTabContent.appendChild(
			E('div', {
				'style': 'padding: 20px; text-align: center;'
			}, [
				E('em', {
					'class': 'spinning'
				}, _('Loading disk usage data...'))
			])
		);

		// Call system.df() with user awareness this may be slow
		podmanRPC.system.df().then((diskUsage) => {
			diskUsageTabContent.innerHTML = '';
			diskUsageTabContent.appendChild(
				this.createDiskUsageSection(diskUsage)
			);
		}).catch((err) => {
			diskUsageTabContent.innerHTML = '';

			const errorMsg = E('div', {
				'style': 'padding: 20px;'
			}, [
				E('p', {
					'class': 'alert-message error'
				}, _('Failed to load disk usage: %s').format(err.message)),
				E('p', {
					'style': 'margin-top: 10px; font-size: 0.9em;'
				}, _('This typically occurs with many containers. The operation may have timed out.')),
				E('div', {
					'style': 'margin-top: 15px;'
				}, [
					new pui.Button(
						_('Try Again'),
						() => this.loadDiskUsage(),
						'action'
					).render()
				])
			]);

			diskUsageTabContent.appendChild(errorMsg);
		});
	},

	/**
	 * Create disk usage section
	 *
	 * @param {Object} diskUsage - Disk usage data object containing:
	 *   - Images: [{Size, Reclaimable, Count}]
	 *   - Containers: [{Size, Reclaimable, Count}]
	 *   - Volumes: [{Size, Reclaimable, Count}]
	 * @returns {Element} Disk usage section element with statistics table
	 */
	createDiskUsageSection: function (diskUsage) {
		const imageSize = (diskUsage.Images && diskUsage.Images[0] && diskUsage.Images[0].Size) ||
			0;
		const imageReclaimable = (diskUsage.Images && diskUsage.Images[0] && diskUsage.Images[0]
			.Reclaimable) || 0;
		const imageCount = (diskUsage.Images && diskUsage.Images[0] && diskUsage.Images[0]
			.Count) ||
			0;

		const containerSize = (diskUsage.Containers && diskUsage.Containers[0] && diskUsage
			.Containers[0].Size) || 0;
		const containerReclaimable = (diskUsage.Containers && diskUsage.Containers[0] && diskUsage
			.Containers[0].Reclaimable) || 0;
		const containerCount = (diskUsage.Containers && diskUsage.Containers[0] && diskUsage
			.Containers[0].Count) || 0;

		const volumeSize = (diskUsage.Volumes && diskUsage.Volumes[0] && diskUsage.Volumes[0]
			.Size) || 0;
		const volumeReclaimable = (diskUsage.Volumes && diskUsage.Volumes[0] && diskUsage.Volumes[
				0]
			.Reclaimable) || 0;
		const volumeCount = (diskUsage.Volumes && diskUsage.Volumes[0] && diskUsage.Volumes[0]
			.Count) || 0;

		const table = new pui.Table()
			.addHeader(_('Type'))
			.addHeader(_('Count'))
			.addHeader(_('Size'))
			.addHeader(_('Reclaimable'))
			.addRow([{
					inner: _('Images')
				},
				{
					inner: String(imageCount)
				},
				{
					inner: format.bytes(imageSize)
				},
				{
					inner: format.bytes(imageReclaimable)
				}
			])
			.addRow([{
					inner: _('Containers')
				},
				{
					inner: String(containerCount)
				},
				{
					inner: format.bytes(containerSize)
				},
				{
					inner: format.bytes(containerReclaimable)
				}
			])
			.addRow([{
					inner: _('Volumes')
				},
				{
					inner: String(volumeCount)
				},
				{
					inner: format.bytes(volumeSize)
				},
				{
					inner: format.bytes(volumeReclaimable)
				}
			]);

		const section = new pui.Section({
			'style': 'margin-top: 20px;'
		});
		section.addNode(_('Disk Usage'), '', table.render());
		return section.render();
	},

	/**
	 * Create resource cards section
	 *
	 * @param {Array} containers - All containers
	 * @param {Array} pods - All pods
	 * @param {Array} images - All images
	 * @param {Array} networks - All networks
	 * @param {Array} volumes - All volumes
	 * @param {number} runningContainers - Count of running containers
	 * @param {number} runningPods - Count of running pods
	 * @returns {Element} Responsive grid container with resource cards
	 */
	createResourceCards: function (containers, pods, images, networks, volumes, runningContainers,
		runningPods) {
		return E('div', {
			'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px;'
		}, [
			this.createCard('Containers', containers.length, runningContainers,
				'admin/podman/containers', '#3498db'),
			this.createCard('Pods', pods.length, runningPods, 'admin/podman/pods',
				'#2ecc71'),
			this.createCard('Images', images.length, null, 'admin/podman/images',
				'#9b59b6'),
			this.createCard('Networks', networks.length, null, 'admin/podman/networks',
				'#e67e22'),
			this.createCard('Volumes', volumes.length, null, 'admin/podman/volumes',
				'#34495e')
		]);
	},

	/**
	 * Create a single resource card
	 *
	 * @param {string} title - Card title (e.g., 'Containers', 'Images')
	 * @param {number} total - Total resource count
	 * @param {number|null} running - Running count (null for non-runnable resources)
	 * @param {string} url - Relative URL path to resource management page
	 * @param {string} color - CSS color for card border and statistics
	 * @returns {Element} Styled card element with hover effects
	 */
	createCard: function (title, total, running, url, color) {
		const statsText = running !== null ? running + ' / ' + total : total.toString();

		return E('a', {
			'href': L.url(url),
			'style': 'text-decoration: none; color: inherit; display: block;'
		}, [
			E('div', {
				'class': 'cbi-section',
				'style': 'cursor: pointer; transition: all 0.2s; border-left: 4px solid ' +
					color +
					'; min-height: 120px; display: flex; flex-direction: column; justify-content: space-between; padding: 15px; margin: 0;'
			}, [
				E('div', {
						'style': 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;'
					},
					[
						E('span', {
							'style': 'font-size: 14px; opacity: 0.8;'
						}, _(
							title)),
						this.getIcon(title, color)
					]),
				E('div', {}, [
					E('div', {
						'style': 'font-size: 32px; font-weight: bold; color: ' +
							color + ';'
					}, statsText),
					running !== null ?
					E('div', {
							'style': 'font-size: 12px; opacity: 0.7; margin-top: 5px;'
						},
						_('running') + ' / ' + _('total')) :
					E('div', {
							'style': 'font-size: 12px; opacity: 0.7; margin-top: 5px;'
						},
						_('total'))
				])
			])
		]);
	},

	/**
	 * Get emoji icon for resource type
	 *
	 * @param {string} type - Resource type ('Containers', 'Pods', 'Images', 'Networks', 'Volumes')
	 * @param {string} color - Icon color (currently unused, for future styling)
	 * @returns {Element} Span element containing emoji icon
	 */
	getIcon: function (type, color) {
		let icon = '📦';
		switch (type) {
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

		return E('span', {
			'style': 'font-size: 24px; opacity: 0.6;'
		}, icon);
	},

	/**
	 * Create system actions section with buttons for maintenance tasks
	 * @returns {Element} System actions section
	 */
	createSystemActionsSection: function () {
		const buttons = E('div', {
			'style': 'display: flex; gap: 10px; flex-wrap: wrap;'
		}, [
			new pui.Button(_('Auto-Update Containers'), () => this.handleAutoUpdate(),
				'action').render(),
			new pui.Button(_('Cleanup / Prune'), () => this.handlePrune(), 'remove')
			.render()
		]);

		const section = new pui.Section({
			'style': 'margin-bottom: 20px;'
		});
		section.addNode(_('System Maintenance'), '', buttons);
		return section.render();
	},

	/**
	 * Handle container auto-update action
	 */
	handleAutoUpdate: function () {
		const self = this;

		// First do dry-run to show what would be updated
		ui.showModal(_('Auto-Update Check'), [
			E('p', {}, _('Checking for container updates...')),
			E('div', {
				'class': 'center'
			}, [
				E('em', {
					'class': 'spinning'
				}, _('Loading...'))
			])
		]);

		podmanRPC.system.autoUpdate(true).then(function (result) {
			var updates = result.Updates || [];

			if (updates.length === 0) {
				ui.showModal(_('Auto-Update'), [
					E('p', {}, _(
						'No containers are configured for auto-update or all containers are up to date.'
					)),
					E('p', {
							'style': 'margin-top: 10px; font-size: 0.9em; opacity: 0.8;'
						},
						_(
							'To enable auto-update, add label io.containers.autoupdate=registry to your containers.'
						)
					),
					new pui.ModalButtons({
						confirmText: _('Close'),
						onConfirm: ui.hideModal,
						onCancel: null
					}).render()
				]);
				return;
			}

			// Show updates available
			var updateList = updates.map(function (update) {
				var status = update.Updated ? '✓ ' + _('Updated') : '○ ' + _(
					'Available');
				return E('li', {}, update.ContainerName + ' - ' + status);
			});

			ui.showModal(_('Auto-Update Available'), [
				E('p', {}, _('The following containers can be updated:')),
				E('ul', {
						'style': 'margin: 10px 0; padding-left: 20px;'
					},
					updateList),
				new pui.ModalButtons({
					confirmText: _('Update Now'),
					onConfirm: () => {
						ui.hideModal();
						self.performAutoUpdate();
					}
				}).render()
			]);
		}).catch(function (err) {
			ui.showModal(_('Error'), [
				E('p', {}, _('Failed to check for updates: %s').format(err
					.message)),
				new pui.ModalButtons({
					confirmText: _('Close'),
					onConfirm: ui.hideModal,
					onCancel: null
				}).render()
			]);
		});
	},

	/**
	 * Perform actual container auto-update
	 */
	performAutoUpdate: function () {
		ui.showModal(_('Updating Containers'), [
			E('p', {}, _('Updating containers, please wait...')),
			E('div', {
				'class': 'center'
			}, [
				E('em', {
					'class': 'spinning'
				}, _('Loading...'))
			])
		]);

		podmanRPC.system.autoUpdate(false).then(function (result) {
			var updates = result.Updates || [];
			var successful = updates.filter(function (u) {
				return u.Updated;
			}).length;

			ui.showModal(_('Auto-Update Complete'), [
				E('p', {}, _('Updated %d %s successfully.').format(
				successful, _('Containers').toLowerCase())),
				new pui.ModalButtons({
					confirmText: _('Close'),
					onConfirm: () => {
						ui.hideModal();
						window.location.reload();
					},
					onCancel: null
				}).render()
			]);
		}).catch(function (err) {
			ui.showModal(_('Error'), [
				E('p', {}, _('Auto-update failed: %s').format(err.message)),
				new pui.ModalButtons({
					confirmText: _('Close'),
					onConfirm: ui.hideModal,
					onCancel: null
				}).render()
			]);
		});
	},

	/**
	 * Handle system cleanup/prune action
	 */
	handlePrune: function () {
		const self = this;

		ui.showModal(_('Cleanup Unused Resources'), [
			E('div', {
				'class': 'cbi-section'
			}, [
				E('p', {}, _('Select what to clean up:')),
				E('div', {
					'style': 'margin: 15px 0;'
				}, [
					E('label', {
						'style': 'display: block; margin: 8px 0;'
					}, [
						E(
							'input', {
								'type': 'checkbox',
								'id': 'prune-all-images',
								'checked': ''
							}),
						' ',
						_('Remove all unused images (not just dangling)')
					]),
					E('label', {
						'style': 'display: block; margin: 8px 0;'
					}, [
						E(
							'input', {
								'type': 'checkbox',
								'id': 'prune-volumes'
							}),
						' ',
						_('Remove unused volumes')
					])
				]),
				E('p', {
						'style': 'margin-top: 15px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107;'
					},
					[
						E('strong', {}, _('Warning:')),
						' ',
						_(
							'This will permanently delete unused containers, images, networks, and optionally volumes.'
						)
					])
			]),
			new pui.ModalButtons({
				confirmText: _('Clean Up Now'),
				confirmClass: 'remove',
				onConfirm: () => {
					const allImages = document.getElementById('prune-all-images')
						.checked;
					const volumes = document.getElementById('prune-volumes')
						.checked;
					ui.hideModal();
					self.performPrune(allImages, volumes);
				}
			}).render()
		]);
	},

	/**
	 * Perform system prune operation
	 *
	 * @param {boolean} allImages - If true, remove all unused images; if false, only dangling
	 * @param {boolean} volumes - If true, also remove unused volumes
	 */
	performPrune: function (allImages, volumes) {
		ui.showModal(_('Cleaning Up'), [
			E('p', {}, _('Removing unused resources, please wait...')),
			E('div', {
				'class': 'center'
			}, [
				E('em', {
					'class': 'spinning'
				}, _('Loading...'))
			])
		]);

		podmanRPC.system.prune(allImages, volumes).then(function (result) {
			let freedSpace = 0;
			const deletedItems = [];

			if (result.ContainerPruneReports) {
				result.ContainerPruneReports.forEach(function (r) {
					if (r.Size) freedSpace += r.Size;
				});
				if (result.ContainerPruneReports.length > 0) {
					deletedItems.push(result.ContainerPruneReports.length + ' ' + _('Containers').toLowerCase());
				}
			}

			if (result.ImagePruneReports) {
				result.ImagePruneReports.forEach(function (r) {
					if (r.Size) freedSpace += r.Size;
				});
				if (result.ImagePruneReports.length > 0) {
					deletedItems.push(result.ImagePruneReports.length + ' ' + _('Images').toLowerCase());
				}
			}

			if (result.VolumePruneReports) {
				result.VolumePruneReports.forEach(function (r) {
					if (r.Size) freedSpace += r.Size;
				});
				if (result.VolumePruneReports.length > 0) {
					deletedItems.push(result.VolumePruneReports.length + ' ' + _('Volumes').toLowerCase());
				}
			}

			ui.showModal(_('Cleanup Complete'), [
				E('p', {}, _('Cleanup successful!')),
				deletedItems.length > 0 ?
				E('p', {
					'style': 'margin-top: 10px;'
				}, _('Removed: %s').format(
					deletedItems.join(', '))) :
				E('p', {
					'style': 'margin-top: 10px;'
				}, _(
					'No unused resources found')),
				E('p', {
						'style': 'margin-top: 10px; font-weight: bold; color: #27ae60;'
					},
					_('Space freed: %s').format(format.bytes(freedSpace))),
				new pui.ModalButtons({
					confirmText: _('Close'),
					onConfirm: () => {
						ui.hideModal();
						window.location.reload();
					},
					onCancel: null
				}).render()
			]);
		}).catch(function (err) {
			ui.showModal(_('Error'), [
				E('p', {}, _('Cleanup failed: %s').format(err.message)),
				new pui.ModalButtons({
					confirmText: _('Close'),
					onConfirm: ui.hideModal,
					onCancel: null
				}).render()
			]);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
