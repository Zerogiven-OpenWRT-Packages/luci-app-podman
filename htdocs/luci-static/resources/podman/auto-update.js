'use strict';

'require baseclass';
'require podman.rpc as podmanRPC';

/**
 * Auto-update module for containers with io.containers.autoupdate label.
 * Implements custom container update since Podman's built-in auto-update requires systemd.
 */
return baseclass.extend({
	/**
	 * Poll interval for streaming operations (ms)
	 */
	POLL_INTERVAL: 1000,

	/**
	 * Get all containers with auto-update label.
	 * @returns {Promise<Array>} Containers with auto-update enabled
	 */
	getAutoUpdateContainers: function() {
		return podmanRPC.container.list('all=true').then((containers) => {
			return (containers || []).filter((c) => {
				return c.Labels && c.Labels['io.containers.autoupdate'];
			}).map((c) => ({
				id: c.Id,
				name: (c.Names && c.Names[0]) || c.Id.substring(0, 12),
				image: c.Image,
				imageId: c.ImageID,
				running: c.State === 'running',
				autoUpdatePolicy: c.Labels['io.containers.autoupdate']
			}));
		});
	},

	/**
	 * Pull image using streaming API (non-blocking).
	 * This avoids XHR timeouts for large images or slow connections.
	 * @param {string} image - Image name to pull
	 * @param {Function} onProgress - Optional progress callback (output)
	 * @returns {Promise<boolean>} True if pull succeeded
	 */
	pullImageStreaming: function(image, onProgress) {
		const self = this;

		return podmanRPC.image.pullStream(image).then((result) => {
			if (!result || !result.session_id) {
				throw new Error(_('Failed to start image pull'));
			}

			return self.waitForPullComplete(result.session_id, onProgress);
		});
	},

	/**
	 * Wait for streaming pull to complete by polling status.
	 * @param {string} sessionId - Pull session ID
	 * @param {Function} onProgress - Optional progress callback (output)
	 * @returns {Promise<boolean>} True if pull succeeded
	 */
	waitForPullComplete: function(sessionId, onProgress) {
		const self = this;
		let offset = 0;

		const checkStatus = () => {
			return podmanRPC.image.pullStatus(sessionId, offset).then((status) => {
				if (status.output) {
					offset += status.output.length;
					if (onProgress) {
						onProgress(status.output);
					}
				}

				if (status.complete) {
					return status.success;
				}

				// Not complete yet, wait and poll again
				return new Promise((resolve, reject) => {
					setTimeout(() => {
						checkStatus().then(resolve).catch(reject);
					}, self.POLL_INTERVAL);
				});
			});
		};

		return checkStatus();
	},

	/**
	 * Check for updates for the given containers.
	 * Uses streaming pull to avoid XHR timeouts.
	 * @param {Array} containers - Containers to check
	 * @param {Function} onProgress - Progress callback (container, idx, total, pullProgress)
	 * @returns {Promise<Array>} Containers with update status
	 */
	checkForUpdates: function(containers, onProgress) {
		const self = this;
		const results = [];
		let idx = 0;
		const total = containers.length;

		const checkNext = () => {
			if (idx >= containers.length) {
				return Promise.resolve(results);
			}

			const container = containers[idx];
			idx++;

			if (onProgress) {
				onProgress(container, idx, total, null);
			}

			// Pull the image using streaming API to avoid timeout
			return self.pullImageStreaming(container.image, (pullOutput) => {
				if (onProgress) {
					onProgress(container, idx, total, pullOutput);
				}
			})
				.then((success) => {
					if (!success) {
						throw new Error(_('Failed to pull image'));
					}

					return podmanRPC.image.inspect(container.image);
				})
				.then((newImage) => {
					const hasUpdate = container.imageId !== newImage.Id;
					results.push({
						name: container.name,
						image: container.image,
						running: container.running,
						currentImageId: container.imageId,
						newImageId: newImage.Id,
						hasUpdate: hasUpdate
					});
					return checkNext();
				})
				.catch((err) => {
					// Pull failed - record error but continue
					results.push({
						name: container.name,
						image: container.image,
						running: container.running,
						hasUpdate: false,
						error: err.message || String(err)
					});
					return checkNext();
				});
		};

		return checkNext();
	},

	/**
	 * Update a single container.
	 * @param {string} name - Container name
	 * @param {boolean} wasRunning - Whether container was running before update
	 * @param {string} oldImageId - Image ID before update (to remove after successful update)
	 * @param {Function} onStep - Step callback (step, message)
	 * @returns {Promise<Object>} Update result with success flag and createCommand
	 */
	updateContainer: async function(name, wasRunning, oldImageId, onStep) {
		let createCommand = null;

		const step = (stepNum, msg) => {
			if (onStep) onStep(stepNum, msg);
		};

		// Step 1: Get CreateCommand from inspect
		step(1, _('Getting container configuration...'));

		return podmanRPC.container.inspect(name)
			.then((inspectData) => {
				if (!inspectData || !inspectData.Config || !inspectData.Config.CreateCommand) {
					throw new Error(_('Container does not have CreateCommand'));
				}
				createCommand = inspectData.Config.CreateCommand;

				// Step 2: Stop if running
				if (wasRunning) {
					step(2, _('Stopping container...'));
					return podmanRPC.container.stop(name);
				}
				return Promise.resolve();
			})
			.then(() => {
				// Step 3: Remove old container
				step(3, _('Removing old container...'));
				return podmanRPC.container.remove(name, true);
			})
			.then(() => {
				// Step 4: Recreate using original command
				step(4, _('Creating new container...'));
				return podmanRPC.container.recreate(JSON.stringify(createCommand));
			})
			.then((result) => {
				if (result && result.error) {
					throw new Error(result.error + (result.details ? ': ' + result.details : ''));
				}

				// Step 5: Start if was running
				if (wasRunning) {
					step(5, _('Starting container...'));
					return podmanRPC.container.start(name);
				}
				return Promise.resolve();
			})
			.then(() => {
				// Step 6: Remove old image (cleanup dangling image)
				if (oldImageId) {
					step(6, _('Cleaning up old image...'));
					return podmanRPC.image.remove(oldImageId, false).catch(() => {
						// Ignore errors - image might be used by another container
					});
				}
				return Promise.resolve();
			})
			.then(() => {
				step(7, _('Update complete'));
				return {
					success: true,
					name: name,
					createCommand: createCommand
				};
			})
			.catch((err) => {
				return {
					success: false,
					name: name,
					error: err.message || String(err),
					createCommand: createCommand
				};
			});
	},

	/**
	 * Update multiple containers.
	 * @param {Array} containers - Containers to update (with name, running, currentImageId properties)
	 * @param {Function} onContainerStart - Callback when starting a container update
	 * @param {Function} onContainerStep - Callback for container step progress
	 * @param {Function} onContainerComplete - Callback when container update completes
	 * @returns {Promise<Object>} Summary with successes, failures arrays
	 */
	updateContainers: function(containers, onContainerStart, onContainerStep, onContainerComplete) {
		const successes = [];
		const failures = [];
		let idx = 0;

		const updateNext = () => {
			if (idx >= containers.length) {
				return Promise.resolve({
					successes: successes,
					failures: failures,
					total: containers.length
				});
			}

			const container = containers[idx];
			idx++;

			if (onContainerStart) {
				onContainerStart(container, idx, containers.length);
			}

			return this.updateContainer(
				container.name,
				container.running,
				container.currentImageId,
				(step, msg) => {
					if (onContainerStep) {
						onContainerStep(container, step, msg);
					}
				}
			).then((result) => {
				if (result.success) {
					successes.push(result);
				} else {
					failures.push(result);
				}

				if (onContainerComplete) {
					onContainerComplete(container, result);
				}

				return updateNext();
			});
		};

		return updateNext();
	},

	/**
	 * Format CreateCommand array for display (copyable text).
	 * @param {Array} command - CreateCommand array
	 * @returns {string} Formatted command string
	 */
	formatCreateCommand: function(command) {
		if (!command || !Array.isArray(command)) {
			return '';
		}

		// Join with proper escaping for shell
		return command.map((arg) => {
			// If arg contains spaces or special chars, quote it
			if (/[\s"'\\$`!]/.test(arg)) {
				// Use single quotes and escape any single quotes in the arg
				return "'" + arg.replace(/'/g, "'\\''") + "'";
			}
			return arg;
		}).join(' ');
	}
});
