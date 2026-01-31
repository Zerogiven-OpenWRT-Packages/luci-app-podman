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
			}).catch((err) => {
				// Cleanup orphaned pull session on error
				podmanRPC.image.pullStop(sessionId).catch(() => {
					// Ignore cleanup errors
				});
				throw err;
			});
		};

		return checkStatus();
	},

	/**
	 * Check for updates by comparing manifests (without pulling images).
	 * @param {Array} containers - Containers to check
	 * @param {Function} onProgress - Progress callback (container, idx, total, status)
	 * @returns {Promise<Array>} Containers with update status
	 */
	checkForUpdates: async function(containers, onProgress) {
		const results = [];

		for (let idx = 0; idx < containers.length; idx++) {
			const container = containers[idx];

			if (onProgress) {
				onProgress(container, idx + 1, containers.length, null);
			}

			try {
				// Step 1: Get local image info (includes Architecture and Digest)
				const localImage = await podmanRPC.image.inspect(container.image);
				const localDigest = this.extractDigest(localImage);
				const localArch = localImage.Architecture || 'amd64';
				const localOs = localImage.Os || 'linux';

				// Step 2: Fetch remote manifest (NO PULL!)
				const manifest = await podmanRPC.image.manifestInspect(container.image);

				// Step 3: Find matching architecture in remote manifest
				const remoteDigest = this.findArchDigest(manifest, localArch, localOs);

				// Step 4: Compare digests
				const hasUpdate = remoteDigest && localDigest &&
					remoteDigest !== localDigest;

				results.push({
					name: container.name,
					image: container.image,
					running: container.running,
					currentImageId: container.imageId,
					hasUpdate: hasUpdate,
					currentDigest: localDigest,
					remoteDigest: remoteDigest
				});
			} catch (err) {
				results.push({
					name: container.name,
					image: container.image,
					running: container.running,
					hasUpdate: false,
					error: err.message || String(err)
				});
			}
		}

		return results;
	},

	/**
	 * Extract digest from local image for comparison.
	 * @param {Object} imageData - Image inspect data
	 * @returns {string|null} Digest string
	 */
	extractDigest: function(imageData) {
		// Use Digest field (this is the manifest digest)
		if (imageData.Digest) {
			return imageData.Digest;
		}
		// Fallback to RepoDigests
		if (imageData.RepoDigests && imageData.RepoDigests.length > 0) {
			for (const rd of imageData.RepoDigests) {
				if (rd.includes('@sha256:')) {
					return rd.split('@')[1];
				}
			}
		}
		return null;
	},

	/**
	 * Find digest for matching architecture in manifest.
	 * @param {Object} manifest - Remote manifest data
	 * @param {string} arch - Architecture to match (e.g., 'arm64')
	 * @param {string} os - OS to match (e.g., 'linux')
	 * @returns {string|null} Matching digest
	 */
	findArchDigest: function(manifest, arch, os) {
		if (!manifest || !manifest.manifests) {
			// Single-arch image, use main digest
			return manifest.digest || null;
		}

		// Find matching platform (same arch + os as local image)
		const entry = manifest.manifests.find((m) =>
			m.platform &&
			m.platform.architecture === arch &&
			m.platform.os === os
		);

		return entry ? entry.digest : null;
	},

	/**
	 * Update a single container.
	 * @param {string} name - Container name
	 * @param {string} image - Image name to pull
	 * @param {boolean} wasRunning - Whether container was running before update
	 * @param {string} oldImageId - Image ID before update (to remove after successful update)
	 * @param {Function} onStep - Step callback (step, message)
	 * @param {Function} onPullProgress - Pull progress callback (output)
	 * @returns {Promise<Object>} Update result with success flag and createCommand
	 */
	updateContainer: async function(name, image, wasRunning, oldImageId, onStep, onPullProgress) {
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

				// Step 2: Pull the new image
				step(2, _('Pulling new image...'));
				return this.pullImageStreaming(image, onPullProgress);
			})
			.then((pullSuccess) => {
				if (!pullSuccess) {
					throw new Error(_('Failed to pull image'));
				}

				// Step 3: Stop if running
				if (wasRunning) {
					step(3, _('Stopping container...'));
					return podmanRPC.container.stop(name);
				}
				return Promise.resolve();
			})
			.then(() => {
				// Step 4: Remove old container
				step(4, _('Removing old container...'));
				return podmanRPC.container.remove(name, true);
			})
			.then(() => {
				// Step 5: Recreate using original command (now uses newly pulled image)
				step(5, _('Creating new container...'));
				return podmanRPC.container.recreate(JSON.stringify(createCommand));
			})
			.then((result) => {
				if (result && result.error) {
					throw new Error(result.error + (result.details ? ': ' + result.details : ''));
				}

				// Step 6: Start if was running
				if (wasRunning) {
					step(6, _('Starting container...'));
					return podmanRPC.container.start(name);
				}
				return Promise.resolve();
			})
			.then(() => {
				// Step 7: Remove old image (cleanup dangling image)
				if (oldImageId) {
					step(7, _('Cleaning up old image...'));
					return podmanRPC.image.remove(oldImageId, false).catch(() => {
						// Ignore errors - image might be used by another container
					});
				}
				return Promise.resolve();
			})
			.then(() => {
				step(8, _('Update complete'));
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
	 * @param {Array} containers - Containers to update (with name, image, running, currentImageId properties)
	 * @param {Function} onContainerStart - Callback when starting a container update
	 * @param {Function} onContainerStep - Callback for container step progress
	 * @param {Function} onContainerComplete - Callback when container update completes
	 * @param {Function} onPullProgress - Callback for image pull progress
	 * @returns {Promise<Object>} Summary with successes, failures arrays
	 */
	updateContainers: function(containers, onContainerStart, onContainerStep, onContainerComplete, onPullProgress) {
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
				container.image,
				container.running,
				container.currentImageId,
				(step, msg) => {
					if (onContainerStep) {
						onContainerStep(container, step, msg);
					}
				},
				onPullProgress
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
	}
});
