'require baseclass';
'require ui';
'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';

return baseclass.extend({
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

    callContainers: async function (ids, rpcCall, titleLoad, textLoad, textSuccess, textNoIds, textFailed, textFailedPromise) {
        if (!Array.isArray(ids)) {
            ids = [ ids ];
        }

        if (ids.length === 0) {
            podmanUI.warningTimeNotification(textNoIds);
            return;
        }

        podmanUI.showSpinningModal(titleLoad, textLoad.format(ids.length));

        const promises = ids.map((id) => rpcCall(id));
        return Promise.all(promises).then((results) => {
            // Don't show success notification if any result is undefined/null
            // This can happen when session expires and redirect occurs
            if (!results || results.some((r) => r === undefined || r === null)) {
                ui.hideModal();
                return;
            }

            ui.hideModal();

            const errors = results.filter((r) => r && r.error);
            if (errors.length > 0) {
                podmanUI.errorNotification(textFailed.format(errors.length));
            } else {
                podmanUI.successTimeNotification(textSuccess.format(ids.length));
            }

            // this.refreshTable(false);
        }).catch((err) => {
            ui.hideModal();
            // Don't show error if it's an authentication/session issue
            // LuCI will handle redirect to login page
            if (err && err.message && !err.message.match(/session|auth|login/i)) {
                podmanUI.errorNotification(textFailedPromise.format(err.message));
            }
        });
    }
});
