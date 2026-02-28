'use strict';

'require baseclass';
'require dom';
'require ui';
'require poll';

'require podman.rpc as podmanRPC';
'require podman.ui as podmanUI';
'require podman.constants as constants';

const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s/;
const TIMESTAMP_RE_GLOBAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s/gm;
const POLL_TAIL_LINES = 100;

/**
 * Container logs tab - displays container logs with optional live streaming.
 * Streaming uses tail+since: server filters by epoch (97% data reduction),
 * client deduplicates sub-second precision via ISO timestamp comparison.
 */
return baseclass.extend({
	/**
	 * Render logs tab content with stream controls
	 * @param {HTMLElement} content - Container element to render into
	 * @param {string} containerId - Container ID
	 */
	render: function (content, containerId) {
		this.containerId = containerId;

		dom.content(content, null);

		const logsDisplay = E('div', {
			'class': 'cbi-section'
		}, [
			E('div', {
				'class': 'cbi-section-node'
			}, [
				E('div', {
					'class': 'mb-sm'
				}, [
					E('label', {
						'class': 'mr-md'
					}, [
						E('input', {
							'type': 'checkbox',
							'id': 'log-stream-toggle',
							'class': 'mr-xs',
							'checked': 'checked',
							'change': (ev) => this.toggleLogStream(ev)
						}),
						_('Live Stream')
					]),
					E('label', {
						'class': 'mr-md'
					}, [
						_('Lines: '),
						E('input', {
							'type': 'number',
							'id': 'log-lines',
							'class': 'cbi-input-text input-xs ml-xs',
							'value': '100',
							'min': '10',
							'max': '150'
						})
					]),
					new podmanUI.Button(_('Clear'), () => this.clearLogs())
					.render(),
					' ',
					new podmanUI.Button(_('Refresh'), () => this.refreshLogs())
					.render()
				]),
				E('pre', {
					'id': 'logs-output',
					'class': 'logs-output'
				}, _('Loading logs...'))
			])
		]);

		content.appendChild(logsDisplay);

		const tabNode = document.querySelector('[data-tab="logs"]');
		const mutationObserver = new MutationObserver((mutationsList, observer) => {
			let activateLogsPoll = true;
			mutationsList.forEach(mutation => {
				if (activateLogsPoll === true && mutation.attributeName === 'class' && mutation.target.classList.contains('cbi-tab-disabled') === false) {
					activateLogsPoll = false;
					this.startLogStream();

					return;
				}

				if (activateLogsPoll === true && mutation.attributeName === 'class' && mutation.target.classList.contains('cbi-tab-disabled') === true) {
					activateLogsPoll = false;
					this.stopLogStream();

					return;
				}
			});
		});

		mutationObserver.observe(tabNode, { attributes: true });
	},

	/**
	 * Fetch last N log lines via RPC
	 * @param {number} lines - Number of tail lines
	 * @param {number} [since] - Unix epoch timestamp (0 = no filter)
	 * @returns {Promise<string>} Log text
	 */
	fetchLogs: function (lines, since) {
		return podmanRPC.container.logs(this.containerId, lines || 100, since || 0)
			.then((result) => result.logs || '');
	},

	/**
	 * Process timestamped log lines: filter duplicates and strip timestamps.
	 * @param {string} text - Raw log text with timestamps
	 * @param {string|null} afterTimestamp - Only keep lines with ts > this (null = keep all)
	 * @returns {{displayText: string, lastTimestamp: string|null}}
	 */
	processLines: function (text, afterTimestamp) {
		if (!text) return { displayText: '', lastTimestamp: null };

		const lines = text.split('\n');
		const result = [];
		let lastTimestamp = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(TIMESTAMP_RE);

			if (match) {
				const ts = match[1];
				if (afterTimestamp && ts <= afterTimestamp) continue;
				lastTimestamp = ts;
				result.push(line.substring(match[0].length));
			} else {
				result.push(line);
			}
		}

		return {
			displayText: result.join('\n'),
			lastTimestamp: lastTimestamp
		};
	},

	/**
	 * Refresh logs manually (non-streaming, fetch last N lines)
	 */
	refreshLogs: function () {
		const output = document.getElementById('logs-output');
		if (!output) return;

		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 100 : 100;

		output.textContent = _('Loading logs...');

		this.fetchLogs(lines).then((text) => {
			const cleanText = this.stripAnsi(this.stripTimestamps(text || ''));
			if (cleanText.trim().length > 0) {
				output.textContent = cleanText;
			} else {
				output.textContent = _('No logs available');
			}
			output.scrollTop = output.scrollHeight;
		}).catch((err) => {
			output.textContent = _('Failed to load logs: %s').format(err.message);
		});
	},

	stripAnsi: function (text) {
		if (!text) return text;
		return text.replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '');
	},

	stripTimestamps: function (text) {
		if (!text) return text;
		return text.replace(TIMESTAMP_RE_GLOBAL, '');
	},

	clearLogs: function () {
		const output = document.getElementById('logs-output');
		if (output) {
			output.textContent = '';
		}
	},

	toggleLogStream: function (ev) {
		if (ev.target.checked) {
			this.startLogStream();
			return;
		}
		this.stopLogStream();
	},

	/**
	 * Start log streaming: load initial lines, then poll with tail+dedupe
	 */
	startLogStream: function () {
		if (this.isStartingStream) {
			return;
		}

		this.isStartingStream = true;

		const output = document.getElementById('logs-output');
		if (!output) {
			this.isStartingStream = false;
			return;
		}

		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 100 : 100;

		output.textContent = _('Loading logs...');

		this.fetchLogs(lines).then((text) => {
			const cleanText = this.stripAnsi(text || '');
			const { displayText, lastTimestamp } = this.processLines(cleanText, null);

			this.lastTimestamp = lastTimestamp;

			output.textContent = displayText.trim().length > 0 ? displayText : '';
			output.scrollTop = output.scrollHeight;

			this.pollNewLogs();
			this.isStartingStream = false;
		}).catch((err) => {
			output.textContent = _('Failed to start log stream: %s').format(err.message);
			const checkbox = document.getElementById('log-stream-toggle');
			if (checkbox) checkbox.checked = false;
			this.isStartingStream = false;
		});
	},

	/**
	 * Convert ISO 8601 timestamp to Unix epoch seconds.
	 * @param {string} isoTs - ISO timestamp (e.g. "2026-02-28T19:06:57.123+01:00")
	 * @returns {number} Unix epoch seconds (0 if parse fails)
	 */
	isoToEpoch: function (isoTs) {
		if (!isoTs) return 0;
		const ms = Date.parse(isoTs);
		return isNaN(ms) ? 0 : Math.floor(ms / 1000);
	},

	/**
	 * Poll for new log lines.
	 */
	pollNewLogs: function () {
		const outputEl = document.getElementById('logs-output');
		const view = this;

		this.logPollFn = function () {
			if (!view.logPollFn) return Promise.resolve();

			// Skip when logs tab is not visible
			const el = document.getElementById('tab-logs-content');
			if (!el || !el.offsetParent)
				return Promise.resolve();

			const sinceEpoch = view.isoToEpoch(view.lastTimestamp);
			return view.fetchLogs(POLL_TAIL_LINES, sinceEpoch).then((text) => {
				const cleanText = view.stripAnsi(text || '');
				if (cleanText.trim().length === 0) return;

				const { displayText, lastTimestamp } = view.processLines(cleanText, view.lastTimestamp);

				if (lastTimestamp) {
					view.lastTimestamp = lastTimestamp;
				}

				if (displayText.trim().length > 0 && outputEl) {
					outputEl.textContent += displayText;
					outputEl.scrollTop = outputEl.scrollHeight;
				}
			}).catch((err) => {
				console.error('Poll error:', err);
			});
		};

		poll.add(this.logPollFn, constants.POLL_INTERVAL);
	},

	stopLogStream: function () {
		if (this.logPollFn) {
			try { poll.remove(this.logPollFn); } catch (e) {}
			this.logPollFn = null;
		}
		this.lastTimestamp = null;
	},

	cleanup: function () {
		this.stopLogStream();
	}
});
