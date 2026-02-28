'use strict';

'require baseclass';
'require dom';
'require ui';
'require poll';

'require podman.ui as podmanUI';
'require podman.format as format';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.constants as constants';

/**
 * Container stats tab - displays real-time CPU, memory, network, and process info
 */
return baseclass.extend({
	containerData: {},

	/**
	 * Render stats tab content with live polling
	 * @param {HTMLElement} content - Container element to render into
	 * @param {string} containerId - Container ID
	 * @param {Object} containerData - Container inspect data
	 */
	render: function (content, containerId, containerData) {
		this.containerId = containerId;
		this.containerData = containerData;

		dom.content(content, null);

		const statsTable = new podmanUI.Table({ 'class': 'table table-list' });
		statsTable
			.addRow([
				{ inner: _('CPU Usage') },
				{
					inner: '-',
					options: {
						'id': 'stat-cpu'
					}
				}
			])
			.addRow([
				{ inner: _('Memory Usage') },
				{
					inner: '-',
					options: {
						'id': 'stat-memory'
					}
				}
			])
			.addRow([
				{ inner: _('Memory Limit') },
				{
					inner: '-',
					options: {
						'id': 'stat-memory-limit'
					}
				}
			])
			.addRow([
				{ inner: _('Memory %') },
				{
					inner: '-',
					options: {
						'id': 'stat-memory-percent'
					}
				}
			])
			.addRow([
				{ inner: _('Network I/O') },
				{
					inner: '-',
					options: {
						'id': 'stat-network'
					}
				}
			])
			.addRow([
				{ inner: _('Block I/O') },
				{
					inner: '-',
					options: {
						'id': 'stat-blockio'
					}
				}
			])
			.addRow([
				{ inner: _('PIDs') },
				{
					inner: '-',
					options: {
						'id': 'stat-pids'
					}
				}
			]);

		const statsSection = new podmanUI.Section();
		statsSection.addNode(_('Resource Usage'), '', statsTable.render());

		const statsDisplay = statsSection.render();

		const processSection = new podmanUI.Section({
			'class': 'mt-lg'
		});
		processSection.addNode(_('Running Processes'), '', E('div', {
			'id': 'process-list-container'
		}, [
			E('p', {}, _('Loading process list...'))
		]));

		content.appendChild(statsDisplay);
		content.appendChild(processSection.render());

		// Show message that container is not running
		const cpuEl = document.getElementById('stat-cpu');
		const memEl = document.getElementById('stat-memory');
		const memLimitEl = document.getElementById('stat-memory-limit');
		const memPercentEl = document.getElementById('stat-memory-percent');
		const netEl = document.getElementById('stat-network');
		const blockEl = document.getElementById('stat-blockio');
		const pidsEl = document.getElementById('stat-pids');

		if (cpuEl) cpuEl.textContent = _('Container not running');
		if (memEl) memEl.textContent = '-';
		if (memLimitEl) memLimitEl.textContent = '-';
		if (memPercentEl) memPercentEl.textContent = '-';
		if (netEl) netEl.textContent = '-';
		if (blockEl) blockEl.textContent = '-';
		if (pidsEl) pidsEl.textContent = '-';

		const processContainer = document.getElementById('process-list-container');
		if (processContainer) {
			dom.content(processContainer, E('p', {
					'class': 'text-muted'
				},
				_('Container must be running to view processes')));
		}

		// Only poll stats/processes if container is running
		const isRunning = this.containerData.State && this.containerData.State.Running;

		if (isRunning) {
			this.updateStats();
			this.updateProcessList();

			const view = this;
			this.statsPollFn = async function () {
				return Promise.all([
					view.updateStats(),
					view.updateProcessList()
				]).catch((err) => {
					console.error('Stats/Process poll error:', err);
				});
			};

			poll.add(this.statsPollFn, constants.STATS_POLL_INTERVAL);
		}
	},


	/**
	 * Update stats display with current resource usage
	 */
	updateStats: function () {
		return podmanRPC.container.stats(this.containerId).then((result) => {
			// Podman stats API returns different formats:
			// - With stream=false: Single stats object
			// - CLI format: Wrapped in Stats array
			// Try both formats
			let stats = null;
			if (result && result.Stats && result.Stats.length > 0) {
				// Array format (CLI-style)
				stats = result.Stats[0];
			} else if (result && typeof result === 'object') {
				// Direct object format (API)
				stats = result;
			}

			if (!stats) {
				return;
			}

			// CPU Usage - try different field names
			const cpuPercent = stats.CPUPerc || stats.cpu_percent || stats.cpu || '0%';
			const cpuEl = document.getElementById('stat-cpu');
			if (cpuEl) cpuEl.textContent = cpuPercent;

			// Memory Usage - try different field names
			const memUsage = stats.MemUsage || stats.mem_usage ||
				(stats.memory_stats && stats.memory_stats.usage ? format.bytes(stats
					.memory_stats.usage) : '-');
			const memEl = document.getElementById('stat-memory');
			if (memEl) memEl.textContent = memUsage;

			// Memory Limit - try different field names
			const memLimit = stats.MemLimit || stats.mem_limit ||
				(stats.memory_stats && stats.memory_stats.limit ? format.bytes(stats
					.memory_stats.limit) : _('Unlimited'));
			const memLimitEl = document.getElementById('stat-memory-limit');
			if (memLimitEl) memLimitEl.textContent = memLimit;

			// Memory Percent - try different field names
			const memPercent = stats.MemPerc || stats.mem_percent || stats.mem || '0%';
			const memPercentEl = document.getElementById('stat-memory-percent');
			if (memPercentEl) memPercentEl.textContent = memPercent;

			// Network I/O - format nicely
			const netIO = stats.NetIO || stats.net_io || stats.network_io || stats
				.networks;
			const netEl = document.getElementById('stat-network');
			if (netEl) netEl.textContent = format.networkIO(netIO);

			// Block I/O - format nicely
			const blockIO = stats.BlockIO || stats.block_io || stats.blkio || stats
				.blkio_stats;
			const blockEl = document.getElementById('stat-blockio');
			if (blockEl) blockEl.textContent = format.blockIO(blockIO);

			// PIDs - format nicely
			const pids = stats.PIDs || stats.pids || stats.pids_stats;
			const pidsEl = document.getElementById('stat-pids');
			if (pidsEl) pidsEl.textContent = format.pids(pids);

		}).catch((err) => {
			console.error('Stats error:', err);
			// Stats failed to load - show error only in console
		});
	},

	/**
	 * Update process list with running processes
	 */
	updateProcessList: function () {
		return podmanRPC.container.top(this.containerId, '').then((result) => {
			const content = document.getElementById('process-list-container');
			if (!content) return;

			if (!result || !result.Titles || !result.Processes) {
				dom.content(content, E('p', {}, _('No process data available')));
				return;
			}

			const titles = result.Titles || [];
			const processes = result.Processes || [];

			if (titles.length === 0 || processes.length === 0) {
				dom.content(content, E('p', {}, _('No running processes')));
				return;
			}

			const processTable = new podmanUI.Table({
				'style': 'font-size: 11px; width: 100%;'
			});

			titles.forEach((title) => {
				processTable.addHeader(_(title), { 'style': 'font-family: monospace; white-space: nowrap;' });
			});


			processes.forEach((proc) => {
				const cells = proc.map((cell, index) => {
					let style =
						'font-family: monospace; font-size: 11px; padding: 4px 8px;';
					let displayValue = cell || '-';

					if (titles[index] === 'PID' || titles[index] ===
						'PPID' || titles[index] === '%CPU') {
						style += ' text-align: right;';
					} else if (titles[index] === 'ELAPSED') {
						displayValue = format.elapsedTime(cell);
					} else if (titles[index] === 'COMMAND') {
						style +=
							' max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
					}

					return {
						inner: displayValue,
						options: {
							'style': style,
							'title': cell || '-'
						}
					};
				});

				processTable.addRow(cells);
			});

			dom.content(content, processTable.render());

		}).catch((err) => {
			console.error('Process list error:', err);
			const content = document.getElementById('process-list-container');
			if (content) {
				dom.content(content, E('p', {
						'class': 'text-muted'
					},
					_('Failed to load process list: %s').format(
						err.message || _('Unknown error')
					)
				));
			}
		});
	},

	/**
	 * Cleanup poll functions when view is destroyed
	 */
	cleanup: function () {
		if (this.statsPollFn) {
			try {
				poll.remove(this.statsPollFn);
			} catch (e) {
				// Ignore errors if poll function was already removed
			}
			this.statsPollFn = null;
		}
	}
});
