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
			_('Starting Containers'),
			_('Starting %d container(s)...'),
			_('Started %d container(s) successfully'),
			_('No containers selected'),
			_('Failed to start %d container(s)'),
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
			_('Stopping Containers'),
			_('Stopping %d container(s)...'),
			_('Stopped %d container(s) successfully'),
			_('No containers selected'),
			_('Failed to stop %d container(s)'),
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
			podmanRPC.container.stop,
			_('Restart Containers'),
			_('Restarting %d container(s)...'),
			_('Restarted %d container(s) successfully'),
			_('No containers selected'),
			_('Failed to restart %d container(s)'),
			_('Failed to restart containers: %s'),
		);
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
