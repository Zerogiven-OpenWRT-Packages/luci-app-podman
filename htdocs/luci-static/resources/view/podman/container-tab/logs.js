'use strict';

'require baseclass';
'require dom';
'require fs';
'require ui';
'require poll';

'require podman.ui as podmanUI';
'require podman.constants as constants';

const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s/;
const TIMESTAMP_RE_GLOBAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s/gm;

/**
 * Container logs tab - displays container logs with optional live streaming
 * Uses fs.exec_direct() with podman-api wrapper to fetch logs via Podman REST API
 * The API returns Docker multiplexed stream format (8-byte header per frame)
 */
return baseclass.extend({
	/**
	 * Render logs tab content with stream controls
	 * @param {HTMLElement} content - Container element to render into
	 * @param {string} containerId - Container ID
	 */
	render: function (content, containerId) {
		this.containerId = containerId;

		// Clear existing content
		dom.content(content, null);

		// Create logs display
		const logsDisplay = E('div', {
			'class': 'cbi-section'
		}, [
			E('div', {
				'class': 'cbi-section-node'
			}, [
				// Controls
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
				// Logs container
				E('pre', {
					'id': 'logs-output',
					'class': 'logs-output'
				}, _('Loading logs...'))
			])
		]);

		content.appendChild(logsDisplay);

		// Load initial logs
		this.refreshLogs();
	},

	/**
	 * Parse Docker multiplexed stream format from binary buffer.
	 * Each frame: 1 byte stream type, 3 bytes padding, 4 bytes big-endian size, then payload.
	 * @param {ArrayBuffer} buffer - Raw binary response from Podman logs API
	 * @returns {string} Decoded log text with headers stripped
	 */
	parseDockerStream: function (buffer) {
		const view = new DataView(buffer);
		const decoder = new TextDecoder();
		const chunks = [];
		let offset = 0;

		while (offset + 8 <= buffer.byteLength) {
			const frameSize = view.getUint32(offset + 4, false);
			offset += 8;

			if (offset + frameSize > buffer.byteLength) break;

			chunks.push(decoder.decode(new Uint8Array(buffer, offset, frameSize)));
			offset += frameSize;
		}

		return chunks.join('');
	},

	/**
	 * Fetch logs via podman-api wrapper and parse the Docker stream response
	 * @param {number} lines - Number of tail lines (0 = all)
	 * @param {string} since - Unix epoch timestamp or '0' for none
	 * @returns {Promise<string>} Parsed log text
	 */
	fetchLogs: function (lines, since) {
		return fs.exec_direct('/usr/libexec/podman-api',
			['logs', String(lines), since || '0', this.containerId], 'blob'
		).then((blob) => {
			return blob.arrayBuffer();
		}).then((buffer) => {
			return this.parseDockerStream(buffer);
		});
	},

	/**
	 * Process timestamped log lines in a single pass:
	 * - Filter out duplicate lines (timestamps <= previousTimestamp)
	 * - Extract the last timestamp for the next --since baseline
	 * - Strip timestamp prefixes for display
	 *
	 * @param {string} text - Timestamped log text (after stripAnsi)
	 * @param {string|null} previousTimestamp - Filter threshold (null = keep all)
	 * @returns {{displayText: string, lastTimestamp: string|null}}
	 */
	processLines: function (text, previousTimestamp) {
		if (!text) return { displayText: '', lastTimestamp: null };

		const lines = text.split('\n');
		const result = [];
		let lastTimestamp = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(TIMESTAMP_RE);

			if (match) {
				const ts = match[1];

				// Filter duplicates if threshold is set
				if (previousTimestamp && ts <= previousTimestamp) continue;

				lastTimestamp = ts;

				// Strip timestamp prefix for display
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

		this.fetchLogs(lines, '0').then((text) => {
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

	/**
	 * Strip ANSI escape sequences from log text
	 * @param {string} text - Text with ANSI codes
	 * @returns {string} Clean text
	 */
	stripAnsi: function (text) {
		if (!text) return text;
		return text.replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '');
	},

	/**
	 * Convert an RFC3339 timestamp to Unix epoch seconds string for the API
	 * @param {string} timestamp - RFC3339 timestamp
	 * @returns {string} Unix epoch seconds (e.g. "1707388200")
	 */
	timestampToEpoch: function (timestamp) {
		if (!timestamp) return '0';
		const ms = new Date(timestamp).getTime();
		if (isNaN(ms)) return '0';
		return String(Math.floor(ms / 1000));
	},

	/**
	 * Strip timestamps from log lines for display
	 * @param {string} text - Log text with timestamps
	 * @returns {string} Log text without timestamp prefixes
	 */
	stripTimestamps: function (text) {
		if (!text) return text;
		return text.replace(TIMESTAMP_RE_GLOBAL, '');
	},

	/**
	 * Clear logs display
	 */
	clearLogs: function () {
		const output = document.getElementById('logs-output');
		if (output) {
			output.textContent = '';
		}
	},

	/**
	 * Toggle log streaming on/off
	 * @param {Event} ev - Change event from checkbox
	 */
	toggleLogStream: function (ev) {
		if (ev.target.checked) {
			this.startLogStream();
			return;
		}

		this.stopLogStream();
	},

	/**
	 * Start log streaming using poll.add + fetchLogs with --since
	 */
	startLogStream: function () {
		if (this.isStartingStream) return;
		this.isStartingStream = true;

		const output = document.getElementById('logs-output');
		if (!output) {
			this.isStartingStream = false;
			return;
		}

		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 100 : 100;

		output.textContent = _('Loading logs...');

		this.fetchLogs(lines, '0').then((text) => {
			const cleanText = this.stripAnsi(text || '');
			const { displayText, lastTimestamp } = this.processLines(cleanText, null);

			this.lastTimestamp = lastTimestamp;

			if (displayText.trim().length > 0) {
				output.textContent = displayText;
			} else {
				output.textContent = '';
			}
			output.scrollTop = output.scrollHeight;

			// Start polling for new logs
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
	 * Poll for new log lines using --since timestamp
	 */
	pollNewLogs: function () {
		const outputEl = document.getElementById('logs-output');
		const view = this;

		this.logPollFn = function () {
			if (!view.logPollFn) {
				return Promise.resolve();
			}

			const since = view.timestampToEpoch(view.lastTimestamp);

			return view.fetchLogs(0, since).then((text) => {
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

	/**
	 * Stop log streaming
	 */
	stopLogStream: function () {
		if (this.logPollFn) {
			try {
				poll.remove(this.logPollFn);
			} catch (e) {
				// Ignore if already removed
			}
			this.logPollFn = null;
		}

		this.lastTimestamp = null;
	},

	/**
	 * Cleanup poll functions when view is destroyed
	 */
	cleanup: function () {
		this.stopLogStream();
	}
});
