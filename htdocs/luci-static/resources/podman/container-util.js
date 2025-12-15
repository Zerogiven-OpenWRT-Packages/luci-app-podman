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
			_('Starting %s').format(_('Containers')),
			_('Starting %d %s...').replace('%s', _('Containers').toLowerCase()),
			_('Started %d %s successfully').replace('%s', _('Containers').toLowerCase()),
			_('No %s selected').format(_('Containers').toLowerCase()),
			_('Failed to start %d %s').replace('%s', _('Containers').toLowerCase()),
			_('Failed to start containers: %s'),
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
			_('Stopping %s').format(_('Containers')),
			_('Stopping %d %s...').replace('%s', _('Containers').toLowerCase()),
			_('Stopped %d %s successfully').replace('%s', _('Containers').toLowerCase()),
			_('No %s selected').format(_('Containers').toLowerCase()),
			_('Failed to stop %d %s').replace('%s', _('Containers').toLowerCase()),
			_('Failed to stop containers: %s'),
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
			_('Restarting %s').format(_('Containers')),
			_('Restarting %d %s...').replace('%s', _('Containers').toLowerCase()),
			_('Restarted %d %s successfully').replace('%s', _('Containers').toLowerCase()),
			_('No %s selected').format(_('Containers').toLowerCase()),
			_('Failed to restart %d %s').replace('%s', _('Containers').toLowerCase()),
			_('Failed to restart containers: %s'),
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
			_('Running Health Checks'),
			_('Running health checks on %d %s...').replace('%s', _('Containers').toLowerCase()),
			_('Health checks completed successfully'),
			_('No %s selected').format(_('Containers').toLowerCase()),
			_('Failed to run health checks on %d %s').replace('%s', _('Containers').toLowerCase()),
			_('Failed to run health checks: %s'),
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

		podmanUI.showSpinningModal(_('Removing %s').format(_('Containers')), _('Removing %d %s...').format(ids.length, _('Containers').toLowerCase()));

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
				podmanUI.errorNotification(_('Failed to remove %d %s').format(errors.length, _('Containers').toLowerCase()));
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
				podmanUI.successTimeNotification(_('Removed %d %s successfully').format(ids.length, _('Containers').toLowerCase()));
			});
		}).catch((err) => {
			ui.hideModal();
			if (err && err.message && !err.message.match(/session|auth|login/i)) {
				podmanUI.errorNotification(_('Failed to remove containers: %s').format(err.message));
			}
		});
	},

	/**
	 * Generic handler for bulk container operations
	 * @param {string|Array<string>} ids - Container ID(s)
	 * @param {Function} rpcCall - RPC function to call for each container
	 * @param {string} titleLoad - Modal title during operation
	 * @param {string} textLoad - Modal text during operation
	 * @param {string} textSuccess - Success notification text
	 * @param {string} textNoIds - Warning text when no IDs provided
	 * @param {string} textFailed - Error text for partial failures
	 * @param {string} textFailedPromise - Error text for promise rejection
	 * @returns {Promise} Operation result
	 */
	callContainers: async function (ids, rpcCall, titleLoad, textLoad, textSuccess, textNoIds,
		textFailed, textFailedPromise) {
		if (!Array.isArray(ids)) {
			ids = [ids];
		}

		if (ids.length === 0) {
			podmanUI.warningTimeNotification(textNoIds);
			return;
		}

		podmanUI.showSpinningModal(titleLoad, textLoad.format(ids.length));

		const promises = ids.map((id) => rpcCall(id));
		return Promise.all(promises).then((results) => {
			if (!results || results.some((r) => r === undefined || r === null)) {
				ui.hideModal();
				return;
			}

			ui.hideModal();

			const errors = results.filter((r) => r && r.error);
			if (errors.length > 0) {
				podmanUI.errorNotification(textFailed.format(errors.length));
				return;
			}

			podmanUI.successTimeNotification(textSuccess.format(ids.length));
		}).catch((err) => {
			ui.hideModal();
			if (err && err.message && !err.message.match(/session|auth|login/i)) {
				podmanUI.errorNotification(textFailedPromise.format(err.message));
			}
		});
	}
});
