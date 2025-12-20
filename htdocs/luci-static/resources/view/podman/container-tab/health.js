'use strict';

'require baseclass';
'require ui';
'require poll';

'require podman.container-util as ContainerUtil';
'require podman.ui as podmanUI';
'require podman.format as format';
'require podman.rpc as podmanRPC';
'require podman.openwrt-network as openwrtNetwork';
'require podman.utils as utils';

/**
 * Container health tab - displays health check config, status, and history
 */
return baseclass.extend({
	/**
	 * Render health tab content
	 * @param {HTMLElement} content - Container element to render into
	 * @param {string} containerId - Container ID
	 * @param {Object} containerData - Container inspect data
	 */
	render: function (content, containerId, containerData) {
		this.content = content;
		this.containerId = containerId;
		this.containerData = containerData;

		// Clear existing content
		while (content.firstChild) {
			content.removeChild(content.firstChild);
		}

		const data = this.containerData;
		const health = data.State && data.State.Health;
		const healthConfig = data.Config && data.Config.Healthcheck;

		// Build health check information sections
		const sections = [];

		// Health Check Configuration Section (read-only)
		if (healthConfig && healthConfig.Test && healthConfig.Test.length > 0) {
			const configTable = new podmanUI.Table();

			const testCmd = healthConfig.Test.join(' ');
			configTable.addInfoRow(_('Test Command'), E('code', {
				'style': 'font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 3px;'
			}, testCmd));

			if (healthConfig.Interval) {
				configTable.addInfoRow(_('Interval'), format.duration(healthConfig.Interval));
			}

			if (healthConfig.Timeout) {
				configTable.addInfoRow(_('Timeout'), format.duration(healthConfig.Timeout));
			}

			if (healthConfig.StartPeriod) {
				configTable.addInfoRow(_('Start Period'), format.duration(healthConfig
					.StartPeriod));
			}

			if (healthConfig.Retries) {
				configTable.addInfoRow(_('Retries'), String(healthConfig.Retries));
			}

			const configSection = new podmanUI.Section({
				'style': 'margin-bottom: 20px;'
			});
			configSection.addNode(_('Health Check Configuration'),
				E('div', {
						'style': 'font-size: 0.9em; color: #666; margin-top: 5px;'
					},
					_(
						'Health check configuration is set at container creation and cannot be modified. To change it, you must recreate the container.')
					),
				configTable.render());
			sections.push(configSection.render());
		} else {
			// No health check configured
			const noHealthSection = new podmanUI.Section({
				'style': 'margin-bottom: 20px;'
			});
			noHealthSection.addNode(
				_('Health Check Configuration'),
				_('No health check configured.'),
				E('div')
			);
			sections.push(noHealthSection.render());
		}

		// Current Status Section (only if health check exists)
		if (health) {
			const status = health.Status || 'none';
			const failingStreak = health.FailingStreak || 0;

			const statusTable = new podmanUI.Table();
			statusTable.addRow([{
					inner: _('Status'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: E('span', {
						'class': 'badge status-' + status.toLowerCase(),
						'style': 'font-size: 16px;'
					}, status)
				}
			]);

			statusTable.addRow([{
					inner: _('Failing Streak'),
					options: {
						'style': 'width: 33%; font-weight: bold;'
					}
				},
				{
					inner: failingStreak > 0 ? _('%d consecutive failures').format(
						failingStreak) : _('No failures'),
					options: {
						'style': failingStreak > 0 ?
							'color: #ff6b6b; font-weight: bold;' : ''
					}
				}
			]);

			const statusSection = new podmanUI.Section({
				'style': 'margin-bottom: 20px;'
			});
			statusSection.addNode(_('Health Status'), '', statusTable.render());
			sections.push(statusSection.render());
		}

		// History Section (only if health check exists and has log)
		if (health && health.Log && health.Log.length > 0) {
			const log = health.Log;
			const historyTable = new podmanUI.Table();
			historyTable
				.addHeader(_('Started'))
				.addHeader(_('Ended'))
				.addHeader(_('Result'))
				.addHeader(_('Output'));

			log.slice(-10).reverse().forEach((entry) => {
				const exitCode = entry.ExitCode !== undefined ? entry.ExitCode : '-';
				const exitStatus = exitCode === 0 ? _('Success') : _('Failed');
				const exitClass = exitCode === 0 ? 'status-healthy' : 'status-unhealthy';
				const outputText = entry.Output ? entry.Output.trim() : '-';

				// Create span with textContent to properly escape HTML
				const outputSpan = E('span', {});
				outputSpan.textContent = outputText;

				const resultBadge = E('span', {}, [
					E('span', {
						'class': 'badge ' + exitClass
					}, exitStatus),
					' ',
					E('small', {}, '(Exit: ' + exitCode + ')')
				]);

				historyTable.addRow([{
						inner: entry.Start ? format.date(entry.Start) : '-'
					},
					{
						inner: entry.End ? format.date(entry.End) : '-'
					},
					{
						inner: resultBadge
					},
					{
						inner: outputSpan,
						options: {
							'style': 'font-family: monospace; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
							'title': outputText
						}
					}
				]);
			});

			const historySection = new podmanUI.Section({
				'style': 'margin-bottom: 20px;'
			});
			historySection.addNode(_('Recent Checks (Last 10)'), '', historyTable.render());
			sections.push(historySection.render());
		}

		// Append all sections
		sections.forEach((section) => {
			content.appendChild(section);
		});

		// Add manual health check button (only if health check is configured)
		if (health) {
			content.appendChild(E('div', {
				'style': 'margin-top: 20px;'
			}, [
				new podmanUI.Button(_('Run Health Check Now'), () => this
					.handleHealthCheck(),
					'positive').render()
			]));
		}
	},

	/**
	 * Handle manual health check execution
	 */
	handleHealthCheck: function () {
		ContainerUtil.healthCheckContainers(this.containerId).then(() => {
			// Re-fetch container data and update health tab
			podmanRPC.container.inspect(this.containerId).then((containerData) => {
				this.containerData = containerData;
				this.render(this.content, this.containerId, this.containerData);
			}).catch((err) => {
				console.error('Failed to refresh container data:', err);
			});
		});
	},
});
