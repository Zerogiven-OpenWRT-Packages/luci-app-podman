'use strict';
'require view';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.form as pform';
'require ui';
'require podman.container-form as ContainerForm';

/**
 * @module view.podman.containers
 * @description Container management view using proper LuCI form components
 */
return view.extend({
    handleSaveApply: null,
    handleSave: null,
    handleReset: null,

    map: null,
    listHelper: null,

    /**
     * Load container data on view initialization
     * @returns {Promise<Object>} Container data wrapped in object
     */
    load: async () => {
        return podmanRPC.container.list('all=true')
            .then((containers) => { 
                return { containers: containers || [] };
            })
            .catch((err) => {
                return { error: err.message || _('Failed to load containers') };
            });
    },

    /**
     * Render the containers view using form components
     * @param {Object} data - Data from load()
     * @returns {Element} Container view element
     */
    render: function (data) {
        // Handle errors from load()
        if (data && data.error) {
            return utils.renderError(data.error);
        }

        // Initialize list helper with full data object
        this.listHelper = new pui.ListViewHelper({
            prefix: 'containers',
            itemName: 'container',
            rpc: podmanRPC.container,
            data: data,
            view: this
        });

        this.map = new form.JSONMap(this.listHelper.data, _('Containers'));

        const section = this.map.section(form.TableSection, 'containers', '', _('Manage Podman containers'));
        section.anonymous = true;

        let o;

        // Checkbox column for selection
        o = section.option(pform.field.SelectDummyValue, 'ID', new ui.Checkbox(0, { hiddenname: 'all' }).render());

        // Name column
        o = section.option(form.DummyValue, 'Names', _('Name'));
        o.cfgvalue = (sectionId) => {
            const container = this.map.data.data[sectionId];

            if (container.Names && container.Names[0]) {
                return container.Names[0];
            }
            return container.Id.substring(0, 12);
        };

        // Id column
        o = section.option(form.DummyValue, 'Id', _('Id'));
        o.cfgvalue = (sectionId) => {
            const containerId = this.map.data.data[sectionId].Id;
            return E('a', {
                href: L.url('admin/podman/container', containerId)
            }, utils.truncate(containerId, 10));
        };

        // Image column
        o = section.option(pform.field.DataDummyValue, 'Image', _('Image'));
        // Status column
        o = section.option(pform.field.DataDummyValue, 'State', _('Status'));
        // Created column
        o = section.option(pform.field.DataDummyValue, 'Created', _('Created'));
        o.cfgformatter = utils.formatDate;

        // Create toolbar using helper with custom buttons
        const toolbar = this.listHelper.createToolbar({
            onDelete: () => this.handleRemove(),
            onRefresh: undefined, // No refresh button for containers
            onCreate: undefined, // Create handled by MultiButton below
            customButtons: [
                {
                    text: '&#9658;', // Play symbol
                    handler: () => this.handleStart(),
                    cssClass: 'positive'
                },
                {
                    text: '&#9724;', // Stop symbol
                    handler: () => this.handleStop(),
                    cssClass: 'negative'
                }
            ]
        });

        // Add create menu button at the beginning of the toolbar
        const createButton = new pui.MultiButton({}, 'add')
            .addItem(_('Create Container'), () => this.handleCreateContainer())
            .addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
            .addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
            .render();

        toolbar.prependButton(createButton);

        return this.map.render().then((mapRendered) => {
            const viewContainer = E('div', { 'class': 'podman-view-container' });

            // Add toolbar outside map (persists during refresh)
            viewContainer.appendChild(toolbar.container);
            // Add map content
            viewContainer.appendChild(mapRendered);
            // Setup "select all" checkbox using helper
            this.listHelper.setupSelectAll(mapRendered);

            return viewContainer;
        });
    },

    /**
     * Refresh table data without full page reload
     * @param {boolean} clearSelections - Whether to clear checkbox selections after refresh
     */
    refreshTable: function (clearSelections) {
        return this.listHelper.refreshTable(clearSelections);
    },

    /**
     * Get selected container IDs from checkboxes
     * @returns {Array<string>} Array of selected container IDs
     */
    getSelectedContainerIds: function () {
        return this.listHelper.getSelected((container) => container.Id);
    },

    handleCreateContainer: function () {
        new pform.Container().render(() => this.refreshTable(false));
    },

    handleImportFromRunCommand: function () {
        new pform.Container().showImportFromRunCommand(() => this.refreshTable(false));
    },

    handleImportFromCompose: function () {
        // Feature not yet implemented
    },

    /**
     * Handle container start action for selected containers
     */
    handleStart: function () {
        const selected = this.getSelectedContainerIds();
        
        if (selected.length === 0) {
            pui.simpleTimeNotification(_('No containers selected'), 'warning');
            return;
        }

        pui.showSpinningModal(_('Starting Containers'), _('Starting %d container(s)...').format(selected.length));

        const promises = selected.map((id) => podmanRPC.container.start(id));
        Promise.all(promises).then((results) => {
            ui.hideModal();

            const errors = results.filter((r) => r && r.error);
            if (errors.length > 0) {
                pui.simpleNotification(_('Failed to start %d container(s)').format(errors.length), 'error');
            } else {
                pui.simpleTimeNotification(_('Started %d container(s) successfully').format(selected.length), 'info');
            }

            this.refreshTable(false);
        }).catch((err) => {
            ui.hideModal();
            pui.simpleNotification(_('Failed to start containers: %s').format(err.message), 'error');
        });
    },

    /**
     * Handle container stop action for selected containers
     */
    handleStop: function () {
        const selected = this.getSelectedContainerIds();

        if (selected.length === 0) {
            pui.simpleTimeNotification(_('No containers selected'), 'warning');
            return;
        }

        pui.showSpinningModal(_('Stopping Containers'), _('Stopping %d container(s)...').format(selected.length));

        const promises = selected.map((id) => podmanRPC.container.stop(id));
        Promise.all(promises).then((results) => {
            ui.hideModal();

            const errors = results.filter((r) => r && r.error);
            if (errors.length > 0) {
                pui.errorNotification(_('Failed to stop %d container(s)').format(errors.length));
            } else {
                pui.successTimeNotification(_('Stopped %d container(s) successfully').format(selected.length));
            }

            this.refreshTable(false);
        }).catch((err) => {
            ui.hideModal();
            pui.errorNotification(_('Failed to stop containers: %s').format(err.message));
        });
    },

    /**
     * Handle container remove action for selected containers
     */
    handleRemove: function () {
        utils.handleBulkDelete({
            selected: this.getSelectedContainerIds(),
            itemName: 'container',
            deletePromiseFn: (id) => podmanRPC.container.remove(id, false),
            onSuccess: () => this.refreshTable(true)
        });
    }
});
