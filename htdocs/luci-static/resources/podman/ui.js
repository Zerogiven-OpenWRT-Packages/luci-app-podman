/**
 * @module podman.ui
 * @description Custom UI components for LuCI Podman application.
 * Provides reusable button components and list view helpers to eliminate code duplication
 * and ensure consistent UX across all views.
 *
 * @exports {Object} PUI - Object containing all UI components
 * @property {UIButton} Button - Standard button component
 * @property {UIMultiButton} MultiButton - Dropdown combo button component
 * @property {UIListViewHelper} ListViewHelper - Comprehensive list view helper
 *
 * @usage
 * 'require podman.ui as pui';
 *
 * // Create button
 * new pui.Button(_('Start'), () => this.handleStart(), 'positive').render()
 *
 * // Create multi-button menu
 * new pui.MultiButton({}, 'add')
 *     .addItem(_('Option 1'), () => this.handler1())
 *     .addItem(_('Option 2'), () => this.handler2())
 *     .render()
 *
 * // Initialize list helper
 * this.listHelper = new pui.ListViewHelper({
 *     prefix: 'volumes',
 *     itemName: 'volume',
 *     rpc: podmanRPC.volume,
 *     data: data  // Pass full data object
 * });
 */
'use strict';
'require baseclass';
'require ui';
'require podman.utils as utils';

/**
 * @class UIButton
 * @description Creates a standard LuCI button with consistent styling.
 *
 * @example
 * // Action button with callback
 * new pui.Button(_('Start'), () => this.handleStart(id), 'positive').render()
 *
 * @example
 * // Navigation button with URL
 * new pui.Button(_('Back'), L.url('admin/podman/containers')).render()
 *
 * @example
 * // Button with HTML entity symbol
 * new pui.Button('&#9658;', () => this.handleStart(), 'positive').render()
 */
const UIButton = baseclass.extend({
    /**
     * Initialize button
     * @param {string} text - Button label text (can include HTML entities)
     * @param {string|function} href - URL string for navigation or callback function
     * @param {string} [cssClass] - Button style class: 'positive', 'negative', 'remove', 'save', 'apply', 'neutral'
     */
    __init__: function(text, href, cssClass) {
        this.text = text;
        this.href = href;
        this.cssClass = cssClass;
    },

    /**
     * Render button as DOM element
     * @returns {HTMLElement} Button element
     */
    render: function() {
        return E('button', {
            'class': this.cssClass ? 'cbi-button cbi-button-' + this.cssClass : 'cbi-button',
            'click': typeof this.href === 'function'
                ? this.href
                : L.bind(function(ev) {
                    ev.preventDefault();
                    window.location.href = this.href;
                }, this)
        }, this.text || '');
    }
});

/**
 * @class UIMultiButton
 * @description Creates a dropdown button menu using LuCI's ComboButton component.
 * Useful for grouping 2+ related actions that would clutter the UI.
 *
 * @example
 * // Create button with method chaining
 * const createButton = new pui.MultiButton({}, 'add')
 *     .addItem(_('Create Container'), () => this.handleCreateContainer())
 *     .addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
 *     .addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
 *     .render();
 *
 * @example
 * // With navigation URLs
 * const exportButton = new pui.MultiButton({}, 'save')
 *     .addItem(_('Export as JSON'), () => this.exportJson())
 *     .addItem(_('Export as YAML'), () => this.exportYaml())
 *     .render();
 */
const UIMultiButton = baseclass.extend({
    cssClass : '',
    items: [],

    /**
     * Initialize multi-button
     * @param {array|object} [items] - Initial items (usually omit and use addItem())
     * @param {string} [cssClass] - Button style class (same as UIButton)
     */
    __init__: function(items, cssClass) {
        if (Array.isArray(items)) {
            items.forEach((item) => {
                this.addItem(item.text, item.href);
            });
        }

        this.cssClass = cssClass;
    },

    /**
     * Add menu item
     * @param {string} text - Menu item label
     * @param {string|function} href - URL or callback function
     * @returns {UIMultiButton} Returns this for method chaining
     */
    addItem: function(text, href) {
        this.items.push({text, href});

        return this;
    },

    /**
     * Render multi-button as DOM element
     * @returns {HTMLElement} ComboButton element
     */
    render: function () {
        if (this.items.length <= 0) {
            return '';
        }

        const texts = {};
        const classes = {};
        const href = {};

        this.items.forEach((item, index) => {
            texts['item'+index] = item.text;
            href['item'+index] = item.href;
            classes['item'+index] = this.cssClass ? 'cbi-button cbi-button-' + this.cssClass : 'cbi-button';
        });

        return (new ui.ComboButton(
			texts.item0,
			texts,
			{
				classes,
				click: function (ev, choice) {
                    if (!href[choice]) {
                        return;
                    }

                    ev.preventDefault();

                    if (typeof href[choice] === 'function') {
                        href[choice]();

                        return;
                    }

                    window.location.href = href[choice];
				},
			}
		)).render();
    }
});

/**
 * @class UIListViewHelper
 * @description Comprehensive helper class that encapsulates all common list view operations,
 * eliminating code duplication across list views. Provides consistent UX and centralized
 * bug fixes for checkbox selection, bulk operations, inspect modals, and toolbar creation.
 *
 * @example
 * // Basic usage in a list view
 * render: function(data) {
 *     // Initialize list helper with full data object
 *     this.listHelper = new pui.ListViewHelper({
 *         prefix: 'volumes',
 *         itemName: 'volume',
 *         rpc: podmanRPC.volume,
 *         data: data,  // Pass full { volumes: [] } object
 *         view: this
 *     });
 *
 *     // Use this.listHelper.data as single source of truth
 *     this.map = new form.JSONMap(this.listHelper.data, _('Volumes'));
 *
 *     // Create toolbar
 *     const toolbar = this.listHelper.createToolbar({
 *         onDelete: () => this.handleDeleteSelected(),
 *         onRefresh: () => this.handleRefresh(),
 *         onCreate: () => this.handleCreate()
 *     });
 *
 *     // Use in render chain
 *     return this.map.render().then((rendered) => {
 *         const header = rendered.querySelector('.cbi-section');
 *         if (header) {
 *             header.insertBefore(toolbar.container, header.firstChild);
 *         }
 *         this.listHelper.setupSelectAll(rendered);
 *         return rendered;
 *     });
 * }
 *
 * @example
 * // Advanced toolbar with custom buttons
 * const toolbar = this.listHelper.createToolbar({
 *     onDelete: () => this.handleRemove(),
 *     customButtons: [
 *         { text: '&#9658;', handler: () => this.handleStart(), cssClass: 'positive' },
 *         { text: '&#9724;', handler: () => this.handleStop(), cssClass: 'negative' }
 *     ]
 * });
 * // Add additional button
 * const createMenu = new pui.MultiButton({}, 'add')
 *     .addItem(_('Create'), () => this.handleCreate())
 *     .addItem(_('Import'), () => this.handleImport())
 *     .render();
 * toolbar.addButton(createMenu);
 */
const UIListViewHelper = baseclass.extend({
    /**
     * Initialize list view helper
     * @param {Object} options - Configuration options
     * @param {string} options.prefix - Checkbox name prefix (e.g., 'containers', 'images')
     * @param {string} options.itemName - Singular item name (e.g., 'container', 'image')
     * @param {Object} options.rpc - RPC module reference (e.g., podmanRPC.container)
     * @param {Object|Array} options.data - Data object from load() (e.g., { containers: [] }) or array
     * @param {Object} [options.view] - View context reference
     */
    __init__: function(options) {
        this.prefix = options.prefix;
        this.itemName = options.itemName;
        this.rpc = options.rpc;
        this.data = options.data;
        this.view = options.view;

        // Determine the data key for accessing the array
        // Try prefix first, fallback to first key in object
        if (this.data && typeof this.data === 'object' && !Array.isArray(this.data)) {
            if (this.data[this.prefix]) {
                this.dataKey = this.prefix;
            } else {
                // Fallback: use first key
                const keys = Object.keys(this.data);
                if (keys.length > 0) {
                    this.dataKey = keys[0];
                }
            }
        }
    },

    /**
     * Get the data array from the data object
     * @returns {Array} The array of items
     */
    getDataArray: function() {
        if (!this.data) return [];

        // If data is already an array, return it
        if (Array.isArray(this.data)) {
            return this.data;
        }

        // If data is an object, extract array using dataKey
        if (this.dataKey && this.data[this.dataKey]) {
            return this.data[this.dataKey];
        }

        return [];
    },

    /**
     * Setup "select all" checkbox functionality for table views.
     * Connects the header checkbox to all row checkboxes for bulk selection.
     *
     * @param {HTMLElement} rendered - Rendered table container from map.render()
     *
     * @example
     * return this.map.render().then((rendered) => {
     *     this.listHelper.setupSelectAll(rendered);
     *     return rendered;
     * });
     */
    setupSelectAll: function(rendered) {
        utils.setupSelectAllCheckbox(rendered, this.prefix);
    },

    /**
     * Get selected items from checkboxes using an extractor function.
     * Provides type-safe item extraction for various data structures.
     *
     * @param {Function} extractFn - Function to extract desired data from each selected item.
     *                                Receives (item, sectionId) and returns the extracted value.
     * @returns {Array} Array of extracted values from selected items
     *
     * @example
     * // Extract simple property
     * getSelectedVolumes: function() {
     *     return this.listHelper.getSelected((volume) => volume.Name);
     * }
     *
     * @example
     * // Extract complex object
     * getSelectedImages: function() {
     *     return this.listHelper.getSelected((image) => ({
     *         id: image.Id,
     *         name: image.RepoTags[0]
     *     }));
     * }
     */
    getSelected: function(extractFn) {
        return utils.getSelectedFromCheckboxes(this.prefix, this.getDataArray(), extractFn);
    },

    /**
     * Create standard toolbar with buttons for list views.
     * Returns an object with container element and helper methods.
     *
     * @param {Object} options - Toolbar configuration
     * @param {Function|null} [options.onDelete] - Delete handler. If null, uses default bulk delete.
     *                                             Set to undefined to skip delete button entirely.
     * @param {Function} [options.onCreate] - Create handler. Undefined = no create button.
     * @param {Function} [options.onRefresh] - Refresh handler. Undefined = no refresh button.
     * @param {Array<Object>} [options.customButtons] - Additional custom buttons before refresh/create.
     *                                                   Each: {text, handler, cssClass}
     * @returns {Object} Toolbar object with:
     *   - container {HTMLElement} - The toolbar container (use with insertBefore)
     *   - buttons {Array} - Array of button elements (for advanced manipulation)
     *   - addButton {Function} - Helper to append buttons at the end: addButton(buttonElement)
     *   - prependButton {Function} - Helper to prepend buttons at the beginning: prependButton(buttonElement)
     *
     * @example
     * // Simple toolbar
     * const toolbar = this.listHelper.createToolbar({
     *     onDelete: () => this.handleDeleteSelected(),
     *     onRefresh: () => window.location.reload(),
     *     onCreate: () => this.handleCreate()
     * });
     * header.insertBefore(toolbar.container, header.firstChild);
     *
     * @example
     * // Toolbar with custom buttons and additional menu at the beginning
     * const toolbar = this.listHelper.createToolbar({
     *     onDelete: () => this.handleRemove(),
     *     onRefresh: undefined,  // Skip refresh button
     *     onCreate: undefined,   // Will add custom create menu
     *     customButtons: [
     *         { text: '&#9658;', handler: () => this.handleStart(), cssClass: 'positive' },
     *         { text: '&#9724;', handler: () => this.handleStop(), cssClass: 'negative' }
     *     ]
     * });
     *
     * // Add multi-button menu at the beginning (before Delete button)
     * const createMenu = new pui.MultiButton({}, 'add')
     *     .addItem(_('Create'), () => this.handleCreate())
     *     .addItem(_('Import'), () => this.handleImport())
     *     .render();
     * toolbar.prependButton(createMenu);  // Creates order: Create, Delete, Play, Stop
     *
     * // Or append at the end with: toolbar.addButton(createMenu);
     *
     * header.insertBefore(toolbar.container, header.firstChild);
     */
    createToolbar: function(options) {
        const buttons = [];

        // Create button (first for prominence)
        if (options.onCreate !== undefined) {
            buttons.push(new UIButton(
                _('Create %s').format(this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1)),
                options.onCreate,
                'add'
            ).render());
            buttons.push(' ');
        }

        // Delete button
        if (options.onDelete !== undefined) {
            buttons.push(new UIButton(
                _('Delete Selected'),
                options.onDelete || (() => this.handleBulkDelete()),
                'remove'
            ).render());
            buttons.push(' ');
        }

        // Custom buttons
        if (options.customButtons) {
            options.customButtons.forEach((btn) => {
                buttons.push(new UIButton(btn.text, btn.handler, btn.cssClass).render());
                buttons.push(' ');
            });
        }

        // Refresh button (last)
        if (options.onRefresh !== undefined) {
            buttons.push(new UIButton(
                _('Refresh'),
                options.onRefresh || (() => window.location.reload()),
                'apply'
            ).render());
        }

        const container = E('div', { 'style': 'margin-bottom: 10px;' }, buttons);

        return {
            container: container,
            buttons: buttons,
            // Helper method to add buttons at the end of toolbar
            addButton: function(button) {
                container.appendChild(document.createTextNode(' '));
                container.appendChild(button);
            },
            // Helper method to add buttons at the beginning of toolbar
            prependButton: function(button) {
                if (container.firstChild) {
                    container.insertBefore(document.createTextNode(' '), container.firstChild);
                    container.insertBefore(button, container.firstChild);
                } else {
                    container.appendChild(button);
                }
            }
        };
    },

    /**
     * Handle bulk delete with default implementation using utils.handleBulkDelete.
     * Automatically uses getSelected() and rpc.remove() with proper error handling.
     *
     * @param {Object} [options] - Override options for bulk delete operation
     * @param {Array} [options.selected] - Override selected items (default: uses getSelected())
     * @param {string} [options.itemName] - Override item name (default: uses this.itemName)
     * @param {Function} [options.deletePromiseFn] - Override delete function
     *
     * @example
     * // Use default implementation (called automatically if onDelete is null)
     * const toolbar = this.listHelper.createToolbar({
     *     onDelete: null  // Uses handleBulkDelete with defaults
     * });
     *
     * @example
     * // Custom implementation with override
     * handleDeleteSelected: function() {
     *     this.listHelper.handleBulkDelete({
     *         selected: this.getSelectedVolumes(),
     *         deletePromiseFn: (name) => podmanRPC.volume.remove(name, true)  // force=true
     *     });
     * }
     */
    handleBulkDelete: function(options) {
        const deleteOptions = Object.assign({
            selected: this.getSelected((item) => item),
            itemName: this.itemName,
            deletePromiseFn: (item) => {
                const id = item.Id || item.ID || item.Name || item.name || item;
                return this.rpc.remove(id, false);
            }
        }, options || {});

        utils.handleBulkDelete(deleteOptions);
    },

    /**
     * Show inspect modal for an item with JSON data display.
     * Fetches item details via rpc.inspect() and displays in a modal.
     *
     * @param {string} identifier - Item identifier (ID or name)
     * @param {Array<string>} [hiddenFields] - Fields to hide/mask (e.g., ['SecretData', 'Password'])
     * @param {Function} [closeButtonFn] - Custom close button renderer function
     *
     * @example
     * // Simple inspect (from click handler)
     * handleInspect: function(name) {
     *     this.listHelper.showInspect(name);
     * }
     *
     * @example
     * // Hide sensitive fields
     * handleInspect: function(name) {
     *     this.listHelper.showInspect(name, ['SecretData', 'PrivateKey']);
     * }
     *
     * @example
     * // In table column definition
     * o = section.option(form.DummyValue, 'Name', _('Name'));
     * o.cfgvalue = (sectionId) => {
     *     const item = getData(sectionId);
     *     return E('a', {
     *         href: '#',
     *         click: (ev) => {
     *             ev.preventDefault();
     *             this.handleInspect(item.Name);
     *         }
     *     }, E('strong', {}, item.Name));
     * };
     * o.rawhtml = true;
     */
    showInspect: function(identifier, hiddenFields, closeButtonFn) {
        ui.showModal(_('Loading %s Details').format(this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1)), [
            E('p', { 'class': 'spinning' }, _('Fetching information...'))
        ]);

        this.rpc.inspect(identifier).then((data) => {
            ui.hideModal();

            if (!data) {
                ui.addNotification(null, E('p', _('No data received')), 'error');
                return;
            }

            utils.showInspectModal(
                _('%s Information').format(this.itemName.charAt(0).toUpperCase() + this.itemName.slice(1)),
                data,
                hiddenFields,
                closeButtonFn
            );
        }).catch((err) => {
            ui.hideModal();
            ui.addNotification(null, E('p', _('Failed to inspect: %s').format(err.message)), 'error');
        });
    },

    /**
     * Refresh table data without full page reload.
     * Reloads data via view.load(), updates map sections, and optionally clears selections.
     *
     * @param {boolean} clearSelections - Whether to clear checkbox selections after refresh
     *
     * @example
     * // Refresh after creating/updating item (keep selections)
     * handleCreateVolume: function() {
     *     VolumeForm.render(() => this.listHelper.refreshTable(false));
     * }
     *
     * @example
     * // Refresh after bulk delete (clear selections)
     * handleDeleteSelected: function() {
     *     utils.handleBulkDelete({
     *         selected: this.getSelectedVolumes(),
     *         itemName: 'volume',
     *         deletePromiseFn: (name) => podmanRPC.volume.remove(name, false),
     *         onSuccess: () => this.listHelper.refreshTable(true)
     *     });
     * }
     *
     * @example
     * // Manual refresh button
     * handleRefresh: function() {
     *     this.listHelper.refreshTable(false);
     * }
     */
    refreshTable: function(clearSelections) {
        if (!this.view) {
            console.error('ListViewHelper: view reference is required for refreshTable()');
            return Promise.reject(new Error('view reference required'));
        }

        const indicatorId = 'podman-refresh-' + this.prefix;
        ui.showIndicator(indicatorId, _('Refreshing %s...').format(this.prefix));

        return this.view.load().then((data) => {
            // Update listHelper data reference - single source of truth
            this.data = data;
console.log('data', data);
            // Get the data array
            const itemsArray = this.getDataArray();
console.log('itemsArray', itemsArray);
            const config_name = this.view.map.config;

            // Remove all existing sections
            const existingSections = this.view.map.data.sections(config_name, this.prefix);
            existingSections.forEach((section) => {
                this.view.map.data.remove(config_name, section['.name']);
            });

            // Add new sections from fresh data
            (itemsArray || []).forEach(() => {
                this.view.map.data.add(config_name, this.prefix);
            });

            return this.view.map.save(null, true);
        }).then(() => {
            // Always setup checkboxes after refresh, optionally clear them
            const container = document.querySelector('.podman-view-container');
            if (container) {
                this.setupSelectAll(container);

                // Clear all checkboxes if requested
                if (clearSelections) {
                    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach((cb) => {
                        cb.checked = false;
                    });
                }
            }
            ui.hideIndicator(indicatorId);
        }).catch((err) => {
            ui.hideIndicator(indicatorId);
            ui.addNotification(null, E('p', _('Failed to refresh: %s').format(err.message)), 'error');
        });
    }
});

const PUI = baseclass.extend({
    Button: UIButton,
    MultiButton: UIMultiButton,
    ListViewHelper: UIListViewHelper,
    showSpinningModal: (title, text) => {
        ui.showModal(title, [ E('p', { 'class': 'spinning' }, text) ]);
    },
    simpleNotification: (text, type = '') => {
        ui.addNotification(null, E('p', text), type);
    },
    warningNotification: (text) => {
        ui.addNotification(null, E('p', text), 'warning');
    },
    errorNotification: (text) => {
        ui.addNotification(null, E('p', text), 'error');
    },
    simpleTimeNotification: (text, type = '', duration = 3000) => {
        ui.addTimeLimitedNotification(null, E('p', text), duration, type);
    },
    infoTimeNotification: (text, duration = 3000) => {
        ui.addTimeLimitedNotification(null, E('p', text), duration, 'info');
    },
    warningTimeNotification: (text, duration = 3000) => {
        ui.addTimeLimitedNotification(null, E('p', text), duration, 'warning');
    },
    successTimeNotification: (text, duration = 3000) => {
        ui.addTimeLimitedNotification(null, E('p', text), duration, 'success');
    },
});

return PUI;
