'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as podmanUI';
'require podman.form as podmanForm';
'require podman.list as List';
'require podman.openwrt-network as openwrtNetwork';

/**
 * @module view.podman.networks
 * @description Network management view using proper LuCI form components
 */
return view.extend({
    handleSaveApply: null,
    handleSave: null,
    handleReset: null,

    map: null,
    listHelper: null,

    /**
     * Load network data on view initialization
     * @returns {Promise<Object>} Network data wrapped in object
     */
    load: async () => {
        return podmanRPC.network.list()
            .then((networks) => {
                return { networks: networks || [] };
            })
            .catch((err) => {
                return { error: err.message || _('Failed to load networks') };
            });
    },

    /**
     * Render the networks view using form components
     * @param {Object} data - Data from load()
     * @returns {Element} Networks view element
     */
    render: function(data) {
        // Handle errors from load()
        if (data && data.error) {
            return utils.renderError(data.error);
        }

        // Initialize list helper with full data object
        this.listHelper = new List.Util({
            itemName: 'network',
            rpc: podmanRPC.network,
            data: data,
            view: this
        });

        this.map = new form.JSONMap(this.listHelper.data, _('Networks'));

        const section = this.map.section(form.TableSection, 'networks', '', _('Manage Podman networks'));
        section.anonymous = true;

        let o;

        // Checkbox column for selection
        o = section.option(podmanForm.field.SelectDummyValue, 'name', new ui.Checkbox(0, { hiddenname: 'all' }).render());

        // Name column with integration alert icon
        o = section.option(form.DummyValue, 'Name', _('Name'));
        o.cfgvalue = (sectionId) => {
            const network = this.map.data.data[sectionId];
            const name = network.name || network.Name || _('Unknown');

            return E('span', {}, [
                E('a', {
                    href: '#',
                    click: (ev) => {
                        ev.preventDefault();
                        this.handleInspect(name);
                    }
                }, E('strong', {}, name)),
                ' ',
                E('span', {
                    'id': 'integration-icon-' + name,
                    'style': 'display: none;' // Hidden until status checked
                })
            ]);
        };

        // Driver column
        o = section.option(podmanForm.field.DataDummyValue, 'Driver', _('Driver'));

        // Subnet column
        o = section.option(form.DummyValue, 'Subnet', _('Subnet'));
        o.cfgvalue = (sectionId) => {
            const network = this.map.data.data[sectionId];
            // Handle Podman API format (lowercase)
            if (network.subnets && network.subnets.length > 0) {
                return network.subnets[0].subnet || _('N/A');
            }
            // Handle Docker-compat format (uppercase)
            else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
                return network.IPAM.Config[0].Subnet || _('N/A');
            }
            return _('N/A');
        };

        // Gateway column
        o = section.option(form.DummyValue, 'Gateway', _('Gateway'));
        o.cfgvalue = (sectionId) => {
            const network = this.map.data.data[sectionId];
            // Handle Podman API format (lowercase)
            if (network.subnets && network.subnets.length > 0) {
                return network.subnets[0].gateway || _('N/A');
            }
            // Handle Docker-compat format (uppercase)
            else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
                return network.IPAM.Config[0].Gateway || _('N/A');
            }
            return _('N/A');
        };

        // Created column
        o = section.option(podmanForm.field.DataDummyValue, 'Created', _('Created'));
        o.cfgformatter = (created) => utils.formatDate(new Date(created).getTime() / 1000);

        // Create toolbar using helper
        const toolbar = this.listHelper.createToolbar({
            onDelete: () => this.handleDeleteSelected(),
            onRefresh: () => this.handleRefresh(),
            onCreate: () => this.handleCreateNetwork()
        });

        return this.map.render().then((mapRendered) => {
            const viewContainer = E('div', { 'class': 'podman-view-container' });

            // Add toolbar outside map (persists during refresh)
            viewContainer.appendChild(toolbar.container);
            // Add map content
            viewContainer.appendChild(mapRendered);
            // Setup "select all" checkbox using helper
            this.listHelper.setupSelectAll(mapRendered);

            // Check OpenWrt integration completeness for each network (async)
            this.checkIntegrationStatus();

            return viewContainer;
        });
    },

    /**
     * Check OpenWrt integration status for all networks and update icons
     */
    checkIntegrationStatus: function() {
        const networks = this.listHelper.getDataArray();
        (networks || []).forEach((network) => {
            const name = network.name || network.Name;
            openwrtNetwork.isIntegrationComplete(name).then((result) => {
                const iconEl = document.getElementById('integration-icon-' + name);
                if (iconEl && !result.complete) {
                    // Show alert icon for incomplete integration
                    iconEl.innerHTML = '';
                    iconEl.appendChild(E('a', {
                        'href': '#',
                        'class': 'alert-icon',
                        'style': 'color: #f90; text-decoration: none; cursor: pointer;',
                        'title': _('OpenWrt integration incomplete. Click to setup. Missing: %s').format(result.missing.join(', ')),
                        'click': (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            this.handleSetupIntegration(network);
                        }
                    }, '⚠'));
                    iconEl.style.display = 'inline';
                }
            }).catch(() => {
                // Ignore errors (network might not have subnet/gateway configured)
            });
        });
    },

    /**
     * Get selected network names from checkboxes
     * @returns {Array<string>} Array of network names
     */
    getSelectedNetworks: function() {
        return this.listHelper.getSelected((network) => network.name || network.Name);
    },

    /**
     * Delete selected networks with OpenWrt integration cleanup
     */
    handleDeleteSelected: function() {
        const selected = this.getSelectedNetworks();

        if (selected.length === 0) {
            podmanUI.warningTimeNotification(_('No networks selected'));
            return;
        }

        // Check which networks have OpenWrt integration
        const checkPromises = selected.map((name) =>
            openwrtNetwork.hasIntegration(name).then((exists) => ({
                name: name,
                hasOpenwrt: exists
            })).catch(() => ({
                name: name,
                hasOpenwrt: false
            }))
        );

        Promise.all(checkPromises).then((checks) => {
            const withOpenwrt = checks.filter((c) => c.hasOpenwrt);

            let confirmMsg = _('Are you sure you want to remove %d network(s)?\n\n%s')
                .format(selected.length, selected.join(', '));

            if (withOpenwrt.length > 0) {
                confirmMsg += '\n\n' + _('Note: %d network(s) have OpenWrt integration that will also be removed (bridge, firewall zone, and rules).')
                    .format(withOpenwrt.length);
            }

            if (!confirm(confirmMsg)) return;

            podmanUI.showSpinningModal(_('Deleting Networks'), _('Deleting %d selected network(s)...').format(selected.length));
            
            // Delete networks and their OpenWrt integrations
            const deletePromises = selected.map((name) => {
                const check = checks.find((c) => c.name === name);
                const bridgeName = name + '0'; // Assume default bridge name

                // Remove Podman network first
                return podmanRPC.network.remove(name, false).then((result) => {
                    if (result && result.error) {
                        return { name: name, error: result.error };
                    }

                    // If OpenWrt integration exists, remove it
                    if (check && check.hasOpenwrt) {
                        return openwrtNetwork.removeIntegration(name, bridgeName).then(() => {
                            return { name: name, success: true, openwrtRemoved: true };
                        }).catch((err) => {
                            return { name: name, success: true, openwrtError: err.message };
                        });
                    }

                    return { name: name, success: true };
                }).catch((err) => {
                    return { name: name, error: err.message };
                });
            });

            Promise.all(deletePromises).then((results) => {
                ui.hideModal();

                const errors = results.filter((r) => r.error);
                const openwrtErrors = results.filter((r) => r.openwrtError);

                if (errors.length > 0) {
                    podmanUI.errorNotification(_('Failed to delete %d network(s)').format(errors.length));
                } else if (openwrtErrors.length > 0) {
                    podmanUI.warningNotification(_('Networks deleted but %d OpenWrt integration(s) failed to remove').format(openwrtErrors.length));
                } else {
                    podmanUI.successTimeNotification(_('Successfully deleted %d network(s)').format(selected.length));
                }

                this.handleRefresh(true);
            }).catch((err) => {
                ui.hideModal();
                podmanUI.errorNotification(_('Failed to delete networks: %s').format(err.message));
            });
        });
    },

    /**
     * Refresh network list
     */
    handleRefresh: function(clearSelections) {
        this.listHelper.refreshTable(clearSelections).then(() => {
            // Re-check integration status after table refresh
            this.checkIntegrationStatus();
        });
    },

    /**
     * Show create network dialog
     */
    handleCreateNetwork: function() {
        const form = new podmanForm.Network();
        form.submit = () => this.handleRefresh();
        form.render();
    },

    /**
     * Show network details
     * @param {string} name - Network name
     */
    handleInspect: function(name) {
        this.listHelper.showInspect(name);
    },

    /**
     * Setup OpenWrt integration for a network that doesn't have it
     * @param {Object} network - Network object from Podman
     */
    handleSetupIntegration: function(network) {
        const name = network.name || network.Name;

        // Extract subnet and gateway from Podman network data
        let subnet, gateway;

        // Try Podman API format (lowercase)
        if (network.subnets && network.subnets.length > 0) {
            subnet = network.subnets[0].subnet;
            gateway = network.subnets[0].gateway;
        }
        // Try Docker-compat format (uppercase)
        else if (network.IPAM && network.IPAM.Config && network.IPAM.Config.length > 0) {
            subnet = network.IPAM.Config[0].Subnet;
            gateway = network.IPAM.Config[0].Gateway;
        }

        // Validate we have the required data
        if (!subnet || !gateway) {
            podmanUI.errorNotification(_('Cannot setup OpenWrt integration: Network "%s" does not have subnet and gateway configured').format(name));
            return;
        }

        const bridgeName = name + '0'; // Default bridge name

        // Show confirmation modal
        ui.showModal(_('Setup OpenWrt Integration'), [
            E('p', {}, _('Setup OpenWrt integration for network "%s"?').format(name)),
            E('p', {}, [
                E('strong', {}, _('Details:')),
                E('br'),
                _('Network: %s').format(name), E('br'),
                _('Subnet: %s').format(subnet), E('br'),
                _('Gateway: %s').format(gateway), E('br'),
                _('Bridge: %s').format(bridgeName)
            ]),
            E('p', {}, _('This will create:')),
            E('ul', {}, [
                E('li', {}, _('Bridge device (%s)').format(bridgeName)),
                E('li', {}, _('Network interface with static IP')),
                E('li', {}, _('Add to shared "podman" firewall zone')),
                E('li', {}, _('DNS access rule (if first network)'))
            ]),
            new podmanUI.ModalButtons({
                confirmText: _('Setup'),
                onConfirm: () => {
                    ui.hideModal();
                    this.executeSetupIntegration(name, bridgeName, subnet, gateway);
                }
            }).render()
        ]);
    },

    /**
     * Execute OpenWrt integration setup
     * @param {string} name - Network name
     * @param {string} bridgeName - Bridge interface name
     * @param {string} subnet - Network subnet
     * @param {string} gateway - Gateway IP
     */
    executeSetupIntegration: function(name, bridgeName, subnet, gateway) {
        podmanUI.showSpinningModal(_('Setting up Integration'), _('Creating OpenWrt integration for network "%s"...').format(name));

        openwrtNetwork.createIntegration(name, {
            bridgeName: bridgeName,
            subnet: subnet,
            gateway: gateway
        }).then(() => {
            ui.hideModal();
            podmanUI.successTimeNotification(_('OpenWrt integration for network "%s" created successfully').format(name));

            // Update icon in place - hide alert icon
            const iconEl = document.getElementById('integration-icon-' + name);
            if (iconEl) {
                iconEl.style.display = 'none';
                iconEl.innerHTML = '';
            }
        }).catch((err) => {
            ui.hideModal();
            podmanUI.errorNotification(_('Failed to setup OpenWrt integration: %s').format(err.message));
        });
    }
});
