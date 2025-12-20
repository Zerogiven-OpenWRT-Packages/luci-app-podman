'use strict';

'require baseclass';
'require ui';
'require poll';

'require podman.ui as podmanUI';
'require podman.format as format';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.constants as constants';

/**
 * Container logs tab - displays container logs with optional live streaming
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
		while (content.firstChild) {
			content.removeChild(content.firstChild);
		}

		// Create logs display
		const logsDisplay = E('div', {
			'class': 'cbi-section'
		}, [
			E('div', {
				'class': 'cbi-section-node'
			}, [
				// Controls
				E('div', {
					'style': 'margin-bottom: 10px;'
				}, [
					E('label', {
						'style': 'margin-right: 15px;'
					}, [
						E('input', {
							'type': 'checkbox',
							'id': 'log-stream-toggle',
							'style': 'margin-right: 5px;',
							'change': (ev) => this.toggleLogStream(ev)
						}),
						_('Live Stream')
					]),
					E('label', {
						'style': 'margin-right: 15px;'
					}, [
						_('Lines: '),
						E('input', {
							'type': 'number',
							'id': 'log-lines',
							'class': 'cbi-input-text',
							'value': '100',
							'min': '10',
							'max': '150',
							'style': 'width: 80px; margin-left: 5px;'
						})
					]),
					new podmanUI.Button(_('Clear'), () => this.clearLogs()).render(),
					' ',
					new podmanUI.Button(_('Refresh'), () => this.refreshLogs())
					.render()
				]),
				// Logs container
				E('pre', {
					'id': 'logs-output',
					'style': 'background: #000; color: #0f0; padding: 10px; height: 600px; overflow: auto; font-family: monospace; font-size: 12px; white-space: pre; resize: vertical;'
				}, _('Loading logs...'))
			])
		]);

		content.appendChild(logsDisplay);

		// Load initial logs
		this.refreshLogs();
	},

	/**
	 * Refresh logs manually (non-streaming, fetch last N lines)
	 */
	refreshLogs: function () {
		const output = document.getElementById('logs-output');
		if (!output) return;

		// Get the number of lines from input
		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 1000 : 1000;

		// Get last N lines (non-streaming)
		const params = 'stdout=true&stderr=true&tail=' + lines;

		output.textContent = _('Loading logs...');

		podmanRPC.container.logs(this.containerId, params).then((result) => {
			// Backend returns base64-encoded binary data in {data: "..."} object
			let base64Data = '';
			if (result && typeof result === 'object' && result.data) {
				base64Data = result.data;
			} else if (typeof result === 'string') {
				base64Data = result;
			}

			if (!base64Data) {
				output.textContent = _('No logs available');
				return;
			}

			// Decode base64 to binary string
			let binaryText = '';
			try {
				binaryText = atob(base64Data);
			} catch (e) {
				console.error('Base64 decode error:', e);
				output.textContent = _('Failed to decode logs');
				return;
			}

			// Strip Docker stream headers (8-byte headers)
			const withoutHeaders = this.stripDockerStreamHeaders(binaryText);

			// Convert binary string to proper UTF-8
			const utf8Text = this.binaryToUtf8(withoutHeaders);

			// Strip ANSI escape sequences
			const cleanText = this.stripAnsi(utf8Text);

			if (cleanText && cleanText.trim().length > 0) {
				output.textContent = cleanText;
			} else {
				output.textContent = _('No logs available');
			}
			output.scrollTop = output.scrollHeight;
		}).catch((err) => {
			console.error('LOG ERROR:', err);
			output.textContent = _('Failed to load logs: %s').format(err.message);
		});
	},

		/**
	 * Strip Docker stream format headers (8-byte headers before each frame)
	 * Docker/Podman logs use multiplexed stream format:
	 * - Byte 0: Stream type (1=stdout, 2=stderr, 3=stdin)
	 * - Bytes 1-3: Padding
	 * - Bytes 4-7: Frame size (uint32 big-endian)
	 * - Bytes 8+: Actual data
	 * @param {string} text - Text with Docker stream headers
	 * @returns {string} Text without headers
	 */
	stripDockerStreamHeaders: function (text) {
		if (!text || text.length === 0) return text;

		let result = '';
		let pos = 0;

		while (pos < text.length) {
			// Need at least 8 bytes for header
			if (pos + 8 > text.length) {
				// Incomplete header, skip rest
				break;
			}

			// Read frame size from bytes 4-7 (big-endian uint32)
			const size = (text.charCodeAt(pos + 4) << 24) |
				(text.charCodeAt(pos + 5) << 16) |
				(text.charCodeAt(pos + 6) << 8) |
				text.charCodeAt(pos + 7);

			// Skip 8-byte header
			pos += 8;

			// Extract frame data
			if (pos + size <= text.length) {
				result += text.substring(pos, pos + size);
				pos += size;
			} else {
				// Incomplete frame, take what we can
				result += text.substring(pos);
				break;
			}
		}

		return result;
	},

	/**
	 * Strip ANSI escape sequences from log text
	 * @param {string} text - Text with ANSI codes
	 * @returns {string} Clean text
	 */
	stripAnsi: function (text) {
		if (!text) return text;
		// Remove ANSI escape sequences (colors, cursor movement, etc.)
		// eslint-disable-line no-control-regex
		return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g,
			'');
	},

	/**
	 * Convert binary string (from atob) to proper UTF-8 text
	 * atob() returns a "binary string" where each char is one byte (0-255).
	 * This function properly decodes UTF-8 encoded bytes.
	 * @param {string} binaryString - Binary string from atob()
	 * @returns {string} Properly decoded UTF-8 text
	 */
	binaryToUtf8: function (binaryString) {
		if (!binaryString) return binaryString;
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return new TextDecoder('utf-8').decode(bytes);
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
	 * Start log streaming session with backend
	 */
	startLogStream: function () {
		// Prevent race condition from rapid toggling
		if (this.isStartingStream) return;
		this.isStartingStream = true;

		const output = document.getElementById('logs-output');
		if (!output) {
			this.isStartingStream = false;
			return;
		}

		// Get the number of lines from input
		const linesInput = document.getElementById('log-lines');
		const lines = linesInput ? parseInt(linesInput.value) || 1000 : 1000;

		// Clear output and show loading
		output.textContent = _('Loading logs...');

		// First load existing logs with non-streaming call
		const params = 'stdout=true&stderr=true&tail=' + lines;
		podmanRPC.container.logs(this.containerId, params).then((result) => {
			// Extract base64-encoded log data
			let base64Data = '';
			if (result && typeof result === 'object' && result.data) {
				base64Data = result.data;
			} else if (typeof result === 'string') {
				base64Data = result;
			}

			if (!base64Data) {
				output.textContent = '';
			} else {
				// Decode base64 to binary string
				const binaryText = atob(base64Data);

				// Strip Docker headers, convert to UTF-8, strip ANSI codes
				const withoutHeaders = this.stripDockerStreamHeaders(binaryText);
				const utf8Text = this.binaryToUtf8(withoutHeaders);
				const cleanText = this.stripAnsi(utf8Text);

				output.textContent = cleanText || '';
			}
			output.scrollTop = output.scrollHeight;

			// Start streaming for NEW logs
			// NOTE: Don't use tail=0 with follow - it causes curl to exit immediately
			// Just use follow=true to stream new logs as they arrive
			return podmanRPC.container.logsStream(
				this.containerId,
				'stdout=true&stderr=true&follow=true'
			);
		}).then((result) => {
			if (!result || !result.session_id) {
				console.error('Failed to start stream:', result);
				const checkbox = document.getElementById('log-stream-toggle');
				if (checkbox) checkbox.checked = false;
				this.isStartingStream = false;
				return;
			}

			// Store session ID and track byte offset in stream file (not displayed text length)
			this.logStreamSessionId = result.session_id;
			this.logStreamFileOffset = 0; // Start reading from beginning of stream file

			// Start polling for logs
			this.pollLogsStatus();
			this.isStartingStream = false;
		}).catch((err) => {
			console.error('Stream error:', err);
			output.textContent = _('Failed to start log stream: %s').format(err.message);
			const checkbox = document.getElementById('log-stream-toggle');
			if (checkbox) checkbox.checked = false;
			this.isStartingStream = false;
		});
	},

	/**
	 * Stop log streaming and cleanup backend resources
	 */
	stopLogStream: function () {
		// Store session ID for cleanup before clearing
		const sessionId = this.logStreamSessionId;

		// Clear session ID first to prevent poll function from running again
		this.logStreamSessionId = null;

		// Remove poll function if registered
		if (this.logPollFn) {
			try {
				poll.remove(this.logPollFn);
			} catch (e) {
				// Ignore errors if poll function was already removed
			}
			this.logPollFn = null;
		}

		// Cleanup backend resources (kill curl process, remove temp files)
		if (sessionId) {
			podmanRPC.container.logsStop(sessionId).catch((err) => {
				console.error('Failed to cleanup log stream:', err);
			});
		}
	},

	/**
	 * Poll log stream status and append new log data using byte offset tracking
	 */
	pollLogsStatus: function () {
		const outputEl = document.getElementById('logs-output');
		const view = this;

		// Define poll function and store reference for later removal
		this.logPollFn = function () {
			// Check if session still exists (user may have stopped it)
			if (!view.logStreamSessionId) {
				view.stopLogStream();
				return Promise.resolve();
			}

			// MUST return a Promise
			// Read from current offset to get only NEW data
			return podmanRPC.container.logsStatus(view.logStreamSessionId, view
				.logStreamFileOffset).then((status) => {
				// Check for output
				if (status.output && status.output.length > 0 && outputEl) {
					// Backend returns base64-encoded data - decode it first
					let binaryText = '';
					try {
						binaryText = atob(status.output);
					} catch (e) {
						console.error('Base64 decode error in streaming:', e);
						return;
					}

					// Update file offset BEFORE processing (in case of errors)
					view.logStreamFileOffset += binaryText.length;

					// Strip Docker headers, convert to UTF-8, strip ANSI codes
					const withoutHeaders = view.stripDockerStreamHeaders(binaryText);
					const utf8Text = view.binaryToUtf8(withoutHeaders);
					const cleanOutput = view.stripAnsi(utf8Text);

					// Append the new content
					if (cleanOutput.length > 0) {
						outputEl.textContent += cleanOutput;
						outputEl.scrollTop = outputEl.scrollHeight;
					}
				}

				// Check for completion
				if (status.complete) {
					view.stopLogStream();

					const checkbox = document.getElementById('log-stream-toggle');
					if (checkbox) checkbox.checked = false;

					if (!status.success && outputEl) {
						outputEl.textContent += '\n\n' + _(
							'Log stream ended with error');
					}
				}
			}).catch((err) => {
				console.error('Poll error:', err);
				view.stopLogStream();

				if (outputEl) {
					outputEl.textContent += '\n\n' + _('Error polling log stream: %s')
						.format(err.message);
				}

				const checkbox = document.getElementById('log-stream-toggle');
				if (checkbox) checkbox.checked = false;
			});
		};

		// Add the poll using stored function reference
		poll.add(this.logPollFn, constants.POLL_INTERVAL);
	},

	/**
	 * Cleanup poll functions when view is destroyed
	 */
	cleanup: function () {
		this.stopLogStream();
	}
});
