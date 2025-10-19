'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';
'require podman.form as pform';

/**
 * @module view.podman.images
 * @description Image management view using proper LuCI form components
 */
return view.extend({
    handleSaveApply: null,
    handleSave: null,
    handleReset: null,

    map: null,
    listHelper: null,

    /**
     * Load image data on view initialization
     * @returns {Promise<Object>} Image data wrapped in object
     */
    load: async () => {
        return podmanRPC.image.list()
            .then((images) => {
                // Expand images with multiple tags into separate records
                const expandedImages = [];
                (images || []).forEach((image) => {
                    const repoTags = image.RepoTags || ['<none>:<none>'];
                    repoTags.forEach((tag) => {
                        // Create a copy of the image for each tag
                        expandedImages.push({
                            ...image,
                            _displayTag: tag,
                            _originalImage: image
                        });
                    });
                });
                return { images: expandedImages };
            })
            .catch((err) => {
                return { error: err.message || _('Failed to load images') };
            });
    },

    /**
     * Render the images view using form components
     * @param {Object} data - Data from load()
     * @returns {Element} Images view element
     */
    render: function (data) {
        // Handle errors from load()
        if (data && data.error) {
            return utils.renderError(data.error);
        }

        // Initialize list helper with full data object
        this.listHelper = new pui.ListViewHelper({
            prefix: 'images',
            itemName: 'image',
            rpc: podmanRPC.image,
            data: data,
            view: this
        });

        this.map = new form.JSONMap(this.listHelper.data, _('Images'));

        const section = this.map.section(form.TableSection, 'images', '', _('Manage Podman images'));
        section.anonymous = true;

        let o;

        // Checkbox column for selection
        o = section.option(pform.field.SelectDummyValue, 'Id', new ui.Checkbox(0, { hiddenname: 'all' }).render());

        // Repository column
        o = section.option(form.DummyValue, 'Repository', _('Repository'));
        o.cfgvalue = (sectionId) => {
            const image = this.map.data.data[sectionId];
            const tag = image._displayTag || '<none>:<none>';
            const parts = tag.split(':');
            return E('strong', {}, parts[0] || '<none>');
        };

        // Tag column
        o = section.option(form.DummyValue, 'Tag', _('Tag'));
        o.cfgvalue = (sectionId) => {
            const image = this.map.data.data[sectionId];
            const tag = image._displayTag || '<none>:<none>';
            const parts = tag.split(':');
            return parts[1] || '<none>';
        };

        // Image ID column
        o = section.option(form.DummyValue, 'ImageId', _('Image ID'));
        o.cfgvalue = (sectionId) => {
            const image = this.map.data.data[sectionId];
            return E('a', {
                href: '#',
                click: (ev) => {
                    ev.preventDefault();
                    this.handleInspect(image.Id);
                }
            }, utils.truncate(image.Id ? image.Id.substring(7, 19) : '', 10));
        };

        // Size column
        o = section.option(pform.field.DataDummyValue, 'Size', _('Size'));
        o.cfgformatter = utils.formatBytes;
        // Created column
        o = section.option(pform.field.DataDummyValue, 'Created', _('Created'));
        o.cfgformatter = utils.formatDate;

        // Create toolbar using helper
        const toolbar = this.listHelper.createToolbar({
            onDelete: () => this.handleDeleteSelected(),
            onRefresh: () => this.handleRefresh(),
            customButtons: [
                { text: _('Pull Latest'), handler: () => this.handlePullLatestSelected(), cssClass: 'positive' }
            ]
        });

        return Promise.all([
            new pform.Image().render(() => this.refreshTable(false)),
            this.map.render(),
        ]).then((rendered) => {
            const formRendered = rendered[0];
            const mapRendered = rendered[1];
            const viewContainer = E('div', { 'class': 'podman-view-container' });

            // Add pull section first
            viewContainer.appendChild(formRendered);
            // Add toolbar outside map (persists during refresh)
            viewContainer.appendChild(toolbar.container);
            // Add map content
            viewContainer.appendChild(mapRendered);

            // Setup "select all" checkbox using helper
            this.listHelper.setupSelectAll(mapRendered);

            return viewContainer;
        });

        // return this.map.render().then((mapRendered) => {
        // 	const viewContainer = E('div', { 'class': 'podman-view-container' });

        // 	// Add pull section first
        // 	viewContainer.appendChild(pullSection);
        // 	// Add toolbar outside map (persists during refresh)
        // 	viewContainer.appendChild(toolbar.container);
        // 	// Add map content
        // 	viewContainer.appendChild(mapRendered);

        // 	// Setup "select all" checkbox using helper
        // 	this.listHelper.setupSelectAll(mapRendered);

        // 	return viewContainer;
        // });
    },

    /**
     * Refresh table data without full page reload
     * @param {boolean} clearSelections - Whether to clear checkbox selections after refresh
     */
    refreshTable: function (clearSelections) {
        return this.listHelper.refreshTable(clearSelections);
    },

    /**
     * Get selected image objects from checkboxes
     * @returns {Array<Object>} Array of {id, name} objects for selected images
     */
    getSelectedImages: function () {
        return this.listHelper.getSelected((image) => {
            return {
                id: image.Id,
                name: image._displayTag || '<none>:<none>'
            };
        });
    },

    /**
     * Delete selected images
     */
    handleDeleteSelected: function () {
        utils.handleBulkDelete({
            selected: this.getSelectedImages(),
            itemName: 'image',
            // Use repo:tag instead of ID to remove individual tags
            deletePromiseFn: (img) => podmanRPC.image.remove(img.name, false),
            formatItemName: (img) => img.name,
            onSuccess: () => this.refreshTable(true)
        });
    },

    /**
     * Pull latest version of selected images
     */
    handlePullLatestSelected: function () {
        const selected = this.getSelectedImages();

        if (selected.length === 0) {
            pui.simpleTimeNotification(_('No images selected'), 'warning');
            return;
        }

        const imageNames = selected.map((img) => img.name).join(', ');
        if (!confirm(_('Pull latest version of %d image(s)?\n\n%s').format(selected.length, imageNames)))
            return;

        ui.showModal(_('Pulling Images'), [
            E('p', { 'class': 'spinning' }, _('Pulling latest version of %d image(s)...').format(selected.length))
        ]);

        const pullPromises = selected.map((img) => {
            return podmanRPC.image.pull(img.name);
        });

        Promise.all(pullPromises).then((results) => {
            ui.hideModal();
            const errors = results.filter((r) => r && r.error);
            if (errors.length > 0) {
                pui.errorNotification(_('Failed to pull %d image(s)').format(errors.length));
            } else {
                pui.successTimeNotification(_('Successfully pulled %d image(s)').format(selected.length));
            }
            this.refreshTable(false);
        }).catch((err) => {
            ui.hideModal();
            ui.addNotification(null, E('p', _('Failed to pull some images: %s').format(err.message)), 'error');
        });
    },

    /**
     * Refresh image list
     */
    handleRefresh: function () {
        this.refreshTable(false);
    },

    /**
     * Inspect an image and show details in modal
     * @param {string} id - Image ID
     */
    handleInspect: function (id) {
        this.listHelper.showInspect(id);
    }
});
