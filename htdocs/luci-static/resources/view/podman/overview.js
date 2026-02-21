'use strict';

'require dom';
'require view';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.format as format';
'require podman.ui as podmanUI';
'require podman.auto-update as autoUpdate';
'require ui';
'require uci';

utils.addPodmanCss().addCss('view/podman/overview.css');

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
		// Phase 1: Fast initial load - version, system info, and UCI config
		return Promise.all([
			podmanRPC.system.version(),
			podmanRPC.system.info(),
			uci.load('podman').then(() => uci.get('podman', 'globals', 'debug')).catch(() => '0')
		]).then(([version, info, debug]) => {
			if (debug === '1') {
				return podmanRPC.system.debug().then((debugData) => {
					return [version, info, debugData];
				}).catch(() => [version, info, null]);
			}
			return [version, info, null];
		});
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
		const debugData = data[2] || null;

		// Tab 1: Overview (loads immediately)
		const overviewChildren = [
			this.createSystemActionsSection(),
			this.createInfoSection(version, info)
		];

		if (debugData && debugData.checks) {
			overviewChildren.push(this.createDebugSection(debugData));
		}

		overviewChildren.push(E('div', {
			'id': 'resource-cards-container',
			'class': 'resources-section'
		}, [
			E('h3', {
				'class': 'resources-heading'
			}, _('Resources')),
			this.createLoadingPlaceholder(_('Resources'))
		]));

		// Tab 2: Disk Usage (load on demand)
		const diskUsageTabContent = E('div', {
			'id': 'disk-usage-tab-content'
		}, [
			this.createDiskUsageLoadButton()
		]);

		const overviewTabContent = E('div', {}, overviewChildren);

		// Create tabs
		const tabs = new podmanUI.Tabs('overview')
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
				dom.content(resourceCardsContainer, [
					E('h3', {
						'class': 'resources-heading'
					}, _('Resources')),
					this.createResourceCards(containers, pods, images, networks, volumes,
						runningContainers, runningPods)
				]);
			}
		}).catch((err) => {
			const resourceCardsContainer = document.getElementById('resource-cards-container');
			if (resourceCardsContainer) {
				dom.content(resourceCardsContainer,
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
			'class': 'cbi-section loading-placeholder'
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
		const memTotal = (info.host && info.host.memTotal) ? format.bytes(info.host.memTotal) : '0 B';
		const memFree = (info.host && info.host.memFree) ? format.bytes(info.host.memFree) : '0 B';

		const table = new podmanUI.Table({ class: 'table table-list table-list-overview' })
			.addInfoRow(_('Podman Version'), version.Version || _('Unknown'))
			.addInfoRow(_('API Version'), version.ApiVersion || _('Unknown'))
			.addInfoRow(
				_('CPU'),
				(info.host && info.host.cpus) ? info.host.cpus.toString() : _('Unknown')
			)
			.addInfoRow(_('Memory'), memFree + ' / ' + memTotal)
			.addInfoRow(
				_('Socket Path'),
				E(
					'span',
					{ 'class': 'cli-value' },
					(info.host && info.host.remoteSocket && info.host.remoteSocket.path) || '/run/podman/podman.sock'
				)
			)
			.addInfoRow(
				_('Graph Root'),
				E('span', { 'class': 'cli-value' }, (info.store && info.store.graphRoot) || _('Unknown'))
			)
			.addInfoRow(
				_('Run Root'),
				E('span', { 'class': 'cli-value' }, (info.store && info.store.runRoot) || _('Unknown')))
			.addInfoRow(_('Registries'),
				E('span', { 'class': 'cli-value' }, this.getRegistries(info)));

		const section = new podmanUI.Section();
		section.addNode(_('Information'), '', table.render());
		return section.render();
	},

	/**
	 * Create system diagnostics section (debug mode only)
	 *
	 * @param {Object} debugData - Debug data with checks array from system_debug RPC
	 * @returns {Element} Diagnostics section element
	 */
	createDebugSection: function (debugData) {
		const statusIcons = {
			ok: '\u2713',
			warn: '\u26A0',
			error: '\u2717'
		};
		const statusColors = {
			ok: '#2ecc71',
			warn: '#e67e22',
			error: '#e74c3c'
		};

		const table = new podmanUI.Table({ class: 'table table-list table-list-overview' });

		(debugData.checks || []).forEach((check) => {
			const icon = statusIcons[check.status] || '?';
			const color = statusColors[check.status] || '#666';
			const detail = check.detail || '';
			const message = check.message ? ' \u2014 ' + check.message : '';

			table.addInfoRow(
				_(check.label),
				E('span', { 'style': 'color:' + color }, [
					E('strong', {}, icon + ' '),
					E('span', { 'class': 'cli-value' }, detail),
					message
				])
			);
		});

		const section = new podmanUI.Section();
		section.addNode(_('System Diagnostics'), _('Debug mode enabled in UCI config'), table.render());
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
		const button = new podmanUI.Button(
			_('Load Disk Usage Statistics'),
			() => this.loadDiskUsage(),
			'action'
		).render();

		const description = E('p', {
			'class': 'overview-description'
		}, _('Click to load detailed disk usage information for containers, images, and volumes. This may take several seconds with many resources.'));

		return E('div', {}, [description, button]);
	},

	/**
	 * Load disk usage data on demand (called from Disk Usage tab)
	 * Replaces load button with actual disk usage statistics
	 */
	loadDiskUsage: function () {
		const diskUsageTabContent = document.getElementById('disk-usage-tab-content');
		if (!diskUsageTabContent) return;

		// Show loading state
		dom.content(diskUsageTabContent,
			E('div', {
				'class': 'loading-placeholder'
			}, [
				E('em', {
					'class': 'spinning'
				}, _('Loading disk usage data...'))
			])
		);

		// Call system.df() with user awareness this may be slow
		podmanRPC.system.df().then((diskUsage) => {
			dom.content(diskUsageTabContent,
				this.createDiskUsageSection(diskUsage)
			);
		}).catch((err) => {
			const errorMsg = E('div', {
				'class': 'p-md'
			}, [
				E('p', {
					'class': 'alert-message error'
				}, _('Failed to load disk usage: %s').format(err.message)),
				E('p', {
					'class': 'mt-sm text-sm'
				}, _('This typically occurs with many containers. The operation may have timed out.')),
				E('div', {
					'class': 'mt-md'
				}, [
					new podmanUI.Button(
						_('Try Again'),
						() => this.loadDiskUsage(),
						'action'
					).render()
				])
			]);

			dom.content(diskUsageTabContent, errorMsg);
		});
	},

	/**
	 * Extract disk usage stats from a category
	 * @param {Array} category - Disk usage category array (e.g., diskUsage.Images)
	 * @returns {Object} {size, reclaimable, count}
	 */
	extractDiskStats: function (category) {
		const data = (category && category[0]) || {};
		return {
			size: data.Size || 0,
			reclaimable: data.Reclaimable || 0,
			count: data.Count || 0
		};
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
		const images = this.extractDiskStats(diskUsage.Images);
		const containers = this.extractDiskStats(diskUsage.Containers);
		const volumes = this.extractDiskStats(diskUsage.Volumes);

		const table = new podmanUI.Table()
			.addHeader(_('Type'))
			.addHeader(_('Count'))
			.addHeader(_('Size'))
			.addHeader(_('Reclaimable'));

		[
			{ label: _('Images'), stats: images },
			{ label: _('Containers'), stats: containers },
			{ label: _('Volumes'), stats: volumes }
		].forEach((item) => {
			table.addRow([
				{ inner: item.label },
				{ inner: String(item.stats.count) },
				{ inner: format.bytes(item.stats.size) },
				{ inner: format.bytes(item.stats.reclaimable) }
			]);
		});

		const section = new podmanUI.Section({ 'class': 'mt-lg' });
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
		return E('div', { 'class': 'overview-cards' }, [
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
			'class': 'overview-card-link'
		}, [
			E('div', {
				'class': 'cbi-section',
				'style': 'border-left: 4px solid ' + color + ';'
			}, [
				E('div', { 'class': 'card-link-header' }, [
					E('span', { 'class': 'card-link-title' }, _(title)),
					this.getIcon(title)
				]),
				E('div', {}, [
					E('div', {
						'class': 'card-link-headline',
						'style': 'color: ' + color + ';'
					}, statsText),
					running !== null ?
					E('div', { 'class': 'card-link-text' }, _('running') + ' / ' + _('total'))
					:
					E('div', { 'class': 'card-link-text' }, _('total'))
				])
			])
		]);
	},

	/**
	 * Get emoji icon for resource type
	 *
	 * @param {string} type - Resource type ('Containers', 'Pods', 'Images', 'Networks', 'Volumes')
	 * @returns {Element} Span element containing emoji icon
	 */
	getIcon: function (type) {
		const icons = {
			'Containers': '🐳',
			'Pods': '🔗',
			'Images': '💿',
			'Networks': '🌐',
			'Volumes': '💾'
		};

		return E('span', { 'class': 'card-link-icon' }, icons[type] || '📦');
	},

	/**
	 * Create system actions section with buttons for maintenance tasks
	 * @returns {Element} System actions section
	 */
	createSystemActionsSection: function () {
		const buttons = E('div', { 'class': 'overview-actions' }, [
			new podmanUI.Button(
				_('Check for Updates'),
				() => this.handleCheckUpdates(),
				'positive'
			).render(),
			new podmanUI.Button(
				_('Cleanup / Prune'),
				() => this.handlePrune(),
				'remove'
			).render()
		]);

		const section = new podmanUI.Section({ 'class': 'mb-lg' });
		section.addNode(_('System Maintenance'), '', buttons);
		return section.render();
	},

	/**
	 * Handle check for container updates action
	 */
	handleCheckUpdates: function () {
		const view = this;

		// Show initial loading modal
		ui.showModal(_('Check for Updates'), [
			E('p', {}, _('Finding containers with auto-update label...')),
			E('div', { 'class': 'center' }, [
				E('em', { 'class': 'spinning' }, _('Loading...'))
			])
		]);

		// Get containers with auto-update label
		autoUpdate.getAutoUpdateContainers().then((containers) => {
			if (!containers || containers.length === 0) {
				ui.showModal(_('Check for Updates'), [
					E('p', {}, _('No containers with auto-update label found.')),
					E('p', { 'class': 'overview-hint mt-sm' },
						_('To enable auto-update for a container, add the label: io.containers.autoupdate=registry')),
					new podmanUI.ModalButtons({
						confirmText: _('Close'),
						onConfirm: ui.hideModal,
						onCancel: null
					}).render()
				]);
				return;
			}

			// Update modal to show checking progress
			ui.showModal(_('Check for Updates'), [
				E('p', {}, _('Checking %d containers for updates...').format(containers.length)),
				E('div', { 'id': 'update-check-progress' }, [
					E('em', { 'class': 'spinning' }, _('Pulling images and comparing digests...'))
				])
			]);

			// Check for updates
			return autoUpdate.checkForUpdates(containers, (container, idx, total) => {
				const progressDiv = document.getElementById('update-check-progress');
				if (progressDiv) {
					progressDiv.innerHTML = '';
					progressDiv.appendChild(E('em', { 'class': 'spinning' },
						_('Checking %s (%d/%d)...').format(container.name, idx, total)));
				}
			}).then((results) => {
				view.showUpdateResults(results);
			});
		}).catch((err) => {
			ui.showModal(_('Error'), [
				E('p', {}, _('Failed to check for updates: %s').format(err.message)),
				new podmanUI.ModalButtons({
					confirmText: _('Close'),
					onConfirm: ui.hideModal,
					onCancel: null
				}).render()
			]);
		});
	},

	/**
	 * Show update check results modal
	 * @param {Array} results - Update check results
	 */
	showUpdateResults: function (results) {
		const view = this;
		const hasUpdates = results.filter((r) => r.hasUpdate);
		const upToDate = results.filter((r) => !r.hasUpdate && !r.error);
		const errors = results.filter((r) => r.error);

		const content = [E('div', { 'class': 'cbi-section' })];
		const section = content[0];

		// Show containers with updates available
		if (hasUpdates.length > 0) {
			section.appendChild(E('p', { 'class': 'modal-heading' },
				_('Updates available:')));

			const updateList = E('div', { 'class': 'mb-md' });
			hasUpdates.forEach((r, idx) => {
				updateList.appendChild(E('label', { 'class': 'checkbox-item' }, [
					E('input', {
						'type': 'checkbox',
						'id': 'update-container-' + idx,
						'data-name': r.name,
						'data-running': r.running ? '1' : '0',
						'checked': ''
					}),
					' ',
					E('strong', {}, r.name),
					' (',
					r.image,
					')'
				]));
			});
			section.appendChild(updateList);
		}

		// Show up-to-date containers
		if (upToDate.length > 0) {
			section.appendChild(E('p', { 'class': 'mt-md text-success' },
				_('Already up-to-date: %s').format(upToDate.map((r) => r.name).join(', '))));
		}

		// Show errors
		if (errors.length > 0) {
			section.appendChild(E('p', { 'class': 'mt-md text-error' },
				_('Errors checking: %s').format(errors.map((r) => r.name + ' (' + r.error + ')').join(', '))));
		}

		// Show modal with results
		if (hasUpdates.length > 0) {
			content.push(new podmanUI.ModalButtons({
				confirmText: _('Update Selected'),
				confirmClass: 'positive',
				onConfirm: () => {
					// Get selected containers
					const selected = [];

					hasUpdates.forEach((r, idx) => {
						const checkbox = document.getElementById('update-container-' + idx);
						if (checkbox && checkbox.checked) {
							selected.push({
								name: r.name,
								image: r.image,
								running: r.running,
								currentImageId: r.currentImageId
							});
						}
					});

					if (selected.length === 0) {
						podmanUI.warningTimeNotification(_('No containers selected'));
						return;
					}

					ui.hideModal();
					view.performUpdates(selected);
				},
				onCancel: ui.hideModal
			}).render());
		} else {
			content.push(new podmanUI.ModalButtons({
				confirmText: _('Close'),
				onConfirm: ui.hideModal,
				onCancel: null
			}).render());
		}

		ui.showModal(_('Update Check Results'), content);
	},

	/**
	 * Perform container updates
	 * @param {Array} containers - Containers to update
	 */
	performUpdates: function (containers) {
		const view = this;
		let currentContainer = null;

		// Show progress modal
		ui.showModal(_('Updating Containers'), [
			E('div', { 'id': 'update-progress-container' }, [
				E('em', { 'class': 'spinning' }, _('Starting updates...'))
			])
		]);

		const updateProgressUI = (container, step, msg, idx, total) => {
			const progressContainer = document.getElementById('update-progress-container');
			if (!progressContainer) return;

			dom.content(progressContainer, [
				E('p', { 'class': 'modal-heading' },
					_('%s (%d/%d):').format(container.name, idx, total)),
				E('div', { 'class': 'ml-md' }, [
					E('em', { 'class': 'spinning' }, msg)
				])
			]);
		};

		autoUpdate.updateContainers(
			containers,
			(container, idx, total) => {
				currentContainer = container;
				updateProgressUI(container, 0, _('Starting...'), idx, total);
			},
			(container, step, msg) => {
				const idx = containers.indexOf(container) + 1;
				updateProgressUI(container, step, msg, idx, containers.length);
			},
			null
		).then((summary) => {
			view.showUpdateSummary(summary);
		}).catch((err) => {
			ui.showModal(_('Error'), [
				E('p', {}, _('Update failed: %s').format(err.message)),
				new podmanUI.ModalButtons({
					confirmText: _('Close'),
					onConfirm: () => {
						ui.hideModal();
						window.location.reload();
					},
					onCancel: null
				}).render()
			]);
		});
	},

	/**
	 * Show update summary modal
	 * @param {Object} summary - Update summary with successes and failures
	 */
	showUpdateSummary: function (summary) {
		const content = [E('div', { 'class': 'cbi-section' })];
		const section = content[0];

		// Show successes
		if (summary.successes.length > 0) {
			section.appendChild(E('p', { 'class': 'text-success mb-sm' },
				_('Successfully updated: %s').format(summary.successes.map((r) => r.name).join(', '))));
		}

		// Show failures with recovery information
		if (summary.failures.length > 0) {
			section.appendChild(E('p', { 'class': 'text-error mb-sm' },
				_('Failed to update:')));

			summary.failures.forEach((failure) => {
				const failureDiv = E('div', {
					'class': 'failure-box'
				});

				failureDiv.appendChild(E('p', { 'class': 'text-bold' }, failure.name));
				failureDiv.appendChild(E('p', { 'class': 'text-error' }, failure.error));

				// Show CreateCommand for manual recovery
				if (failure.createCommand) {
					const cmdStr = utils.formatCreateCommand(failure.createCommand);
					failureDiv.appendChild(E('p', { 'class': 'mt-sm' },
						_('To manually recreate, run:')));
					failureDiv.appendChild(E('pre', {
						'class': 'recovery-command'
					}, cmdStr));
					failureDiv.appendChild(E('button', {
						'class': 'cbi-button mt-sm',
						'click': () => {
							navigator.clipboard.writeText(cmdStr).then(() => {
								podmanUI.infoTimeNotification(_('Command copied to clipboard'));
							});
						}
					}, _('Copy Command')));
				}

				section.appendChild(failureDiv);
			});
		}

		content.push(new podmanUI.ModalButtons({
			confirmText: _('Close'),
			onConfirm: () => {
				ui.hideModal();
				window.location.reload();
			},
			onCancel: null
		}).render());

		ui.showModal(_('Update Complete'), content);
	},

	/**
	 * Handle system cleanup/prune action
	 */
	handlePrune: function () {
		ui.showModal(_('Cleanup Unused Resources'), [
			E('div', {
				'class': 'cbi-section'
			}, [
				E('p', {}, _('Select what to clean up:')),
				E('div', {
					'class': 'prune-options'
				}, [
					E('label', {
						'class': 'checkbox-item'
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
						'class': 'checkbox-item'
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
						'class': 'warning-box mt-md'
					},
					[
						E('strong', {}, _('Warning:')),
						' ',
						_(
							'This will permanently delete unused containers, images, networks, and optionally volumes.'
						)
					])
			]),
			new podmanUI.ModalButtons({
				confirmText: _('Clean Up Now'),
				confirmClass: 'remove',
				onConfirm: () => {
					const allImages = document.getElementById('prune-all-images')
						.checked;
					const volumes = document.getElementById('prune-volumes')
						.checked;
					ui.hideModal();
					this.performPrune(allImages, volumes);
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
		ui.showModal(_('Clean Up Now'), [
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

			const reportTypes = [
				{ key: 'ContainerPruneReports', label: _('Containers') },
				{ key: 'ImagePruneReports', label: _('Images') },
				{ key: 'VolumePruneReports', label: _('Volumes') }
			];

			reportTypes.forEach(function (type) {
				const reports = result[type.key];
				if (reports && reports.length > 0) {
					reports.forEach(function (r) {
						if (r.Size) freedSpace += r.Size;
					});
					deletedItems.push(reports.length + ' ' + type.label.toLowerCase());
				}
			});

			ui.showModal(_('Cleanup Complete'), [
				E('p', {}, _('Cleanup successful!')),
				deletedItems.length > 0 ?
				E('p', {
					'class': 'mt-sm'
				}, _('Removed: %s').format(
					deletedItems.join(', '))) :
				E('p', {
					'class': 'mt-sm'
				}, _(
					'No unused resources found')),
				E('p', {
						'class': 'mt-sm text-success text-bold'
					},
					_('Space freed: %s').format(format.bytes(freedSpace))),
				new podmanUI.ModalButtons({
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
				new podmanUI.ModalButtons({
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
