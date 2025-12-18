'use strict';

'require baseclass';
'require ui';
'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

/**
 * Container utility functions for bulk operations
 */
return baseclass.extend({
	/**
	 * Start one or more containers
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @returns {Promise} Operation result
	 */
	startContainers: async function (ids) {
		return this.callContainers(
			ids,
			podmanRPC.container.start,
			_('Starting %d %s...'),
			_('Started %d %s successfully'),
			_('Failed to start %d %s'),
		);
	},

	/**
	 * Stop one or more containers
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @returns {Promise} Operation result
	 */
	stopContainers: async function (ids) {
		return this.callContainers(
			ids,
			podmanRPC.container.stop,
			_('Stopping %d %s...'),
			_('Stopped %d %s successfully'),
			_('Failed to stop %d %s'),
		);
	},

	/**
	 * Restart one or more containers
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @returns {Promise} Operation result
	 */
	restartContainers: async function (ids) {
		return this.callContainers(
			ids,
			podmanRPC.container.restart,
			_('Restarting %d %s...'),
			_('Restarted %d %s successfully'),
			_('Failed to restart %d %s'),
		);
	},

	/**
	 * Run health checks on one or more containers
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @returns {Promise} Operation result
	 */
	healthCheckContainers: async function (ids) {
		return this.callContainers(
			ids,
			podmanRPC.container.healthcheck,
			_('Running health checks on %d %s...'),
			_('Health checks completed successfully'),
			_('Failed to run health checks on %d %s'),
		);
	},

	/**
	 * Remove one or more containers
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @param {boolean} [force] - Force removal (default: true)
	 * @param {boolean} [volumes] - Remove volumes (default: true)
	 * @returns {Promise} Operation result
	 */
	removeContainers: async function (ids, force, volumes) {
		// Default to force=true and volumes=true
		const forceRemove = force !== undefined ? force : true;
		const removeVolumes = volumes !== undefined ? volumes : true;

		if (!Array.isArray(ids)) {
			ids = [ids];
		}

		if (ids.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format(_('Containers').toLowerCase()));
			return;
		}

		// Fetch container names before deletion for init script cleanup
		const containerData = await Promise.all(
			ids.map((id) =>
				podmanRPC.container.inspect(id)
					.then((data) => ({ id, name: data.Name }))
					.catch(() => ({ id, name: null }))
			)
		);

		const removeText = _('Removing %d %s...').format(
			ids.length,
			N_(ids.length, 'Container', 'Containers').toLowerCase()
		);

		podmanUI.showSpinningModal(removeText, removeText);

		// Delete containers
		const promises = ids.map((id) => podmanRPC.container.remove(id, forceRemove, removeVolumes));
		return Promise.all(promises).then((results) => {
			if (!results || results.some((r) => r === undefined || r === null)) {
				ui.hideModal();
				return;
			}

			ui.hideModal();

			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				podmanUI.errorNotification(_('Failed to remove %d %s').format(
					errors.length,
					N_(errors.length, 'Container', 'Containers').toLowerCase()
				));
				return;
			}

			// Cleanup init scripts for successfully deleted containers
			const cleanupPromises = containerData
				.filter((c) => c.name)
				.map((c) =>
					podmanRPC.initScript.remove(c.name)
						.catch(() => {}) // Ignore errors if init script doesn't exist
				);

			Promise.all(cleanupPromises).then(() => {
				podmanUI.successTimeNotification(_('Removed %d %s successfully').format(
					ids.length,
					N_(ids.length, 'Container', 'Containers').toLowerCase()
				));
			});
		}).catch((err) => {
			ui.hideModal();
			if (err && err.message && !err.message.match(/session|auth|login/i)) {
				podmanUI.errorNotification(`${_('Failed to remove %d %s').format(
					ids.length,
					N_(ids.length, 'Container', 'Containers').toLowerCase()
				)}: ${err.message}`);
			}
		});
	},

	/**
	 * Generic handler for bulk container operations
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @param {Function} rpcCall - RPC function to call for each container
	 * @param {string} textLoad - Modal text during operation
	 * @param {string} textSuccess - Success notification text
	 * @param {string} textFailed - Error text for partial failures
	 * @returns {Promise} Operation result
	 */
	callContainers: async function (ids, rpcCall, textLoad, textSuccess, textFailed) {
		if (!Array.isArray(ids)) {
			ids = [ids];
		}

		if (ids.length === 0) {
			podmanUI.warningTimeNotification(_('No %s selected').format(_('Containers').toLowerCase()));
			return;
		}

		textLoad = textLoad.format(
			ids.length,
			N_(ids.length, 'Container', 'Containers').toLowerCase()
		);

		podmanUI.showSpinningModal(textLoad, textLoad);

		const promises = ids.map((id) => rpcCall(id));
		return Promise.all(promises).then((results) => {
			if (!results || results.some((r) => r === undefined || r === null)) {
				ui.hideModal();
				return;
			}

			ui.hideModal();

			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				podmanUI.errorNotification(textFailed.format(
					ids.length,
					N_(ids.length, 'Container', 'Containers').toLowerCase()
				));

				return;
			}

			podmanUI.successTimeNotification(textSuccess.format(
				ids.length,
				N_(ids.length, 'Container', 'Containers').toLowerCase()
			));
		}).catch((err) => {
			ui.hideModal();
			if (err && err.message && !err.message.match(/session|auth|login/i)) {
				podmanUI.errorNotification(
					textFailed.format(
						ids.length,
						N_(ids.length, 'Container', 'Containers').toLowerCase()
					) + ': ' + err.message
				);
			}
		});
	}
});
