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
'require podman.constants as c';

const UINotifications = baseclass.extend({
    __name__: 'Notifications',

    // Static-like helper methods
    showSpinningModal: function (title, text) {
        ui.showModal(title, [E('p', { 'class': 'spinning' }, text)]);
    },

    simpleNotification: function (text, type) {
        ui.addNotification(null, E('p', text), type || '');
    },

    warningNotification: function (text) {
        ui.addNotification(null, E('p', text), 'warning');
    },

    errorNotification: function (text) {
        ui.addNotification(null, E('p', text), 'error');
    },

    simpleTimeNotification: function (text, type) {
        ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, type || '');
    },

    infoTimeNotification: function (text) {
        ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'info');
    },

    warningTimeNotification: function (text) {
        ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'warning');
    },

    successTimeNotification: function (text) {
        ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'success');
    },
});

const Notification = new UINotifications();

/**
 * Standard LuCI button with consistent styling
 * @example new pui.Button(_('Start'), () => this.handleStart(id), 'positive').render()
 */
const UIButton = baseclass.extend({
    __init__: function (text, href, cssClass) {
        this.text = text;
        this.href = href;
        this.cssClass = cssClass;
    },

    render: function () {
        return E('button', {
            'class': this.cssClass ? 'cbi-button cbi-button-' + this.cssClass : 'cbi-button',
            'click': typeof this.href === 'function'
                ? this.href
                : (ev) => {
                    ev.preventDefault();
                    window.location.href = this.href;
                }
        }, this.text || '');
    }
});

/**
 * Dropdown button menu using ComboButton. Useful for grouping 2+ related actions.
 * @example new pui.MultiButton({}, 'add').addItem(_('Create'), () => this.handleCreate()).render()
 */
const UIMultiButton = baseclass.extend({
    cssClass: '',
    items: [],

    __init__: function (items, cssClass) {
        if (Array.isArray(items)) {
            items.forEach((item) => {
                this.addItem(item.text, item.href);
            });
        }

        this.cssClass = cssClass;
    },

    addItem: function (text, href) {
        this.items.push({ text, href });
        return this;
    },

    render: function () {
        if (this.items.length <= 0) {
            return '';
        }

        const texts = {};
        const classes = {};
        const href = {};

        this.items.forEach((item, index) => {
            texts['item' + index] = item.text;
            href['item' + index] = item.href;
            classes['item' + index] = this.cssClass ? 'cbi-button cbi-button-' + this.cssClass : 'cbi-button';
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
 * Standardized modal footer buttons (Cancel + Confirm)
 * @example new pui.ModalButtons({ onConfirm: () => this.handleSubmit() }).render()
 */
const UIModalButtons = baseclass.extend({
    __init__: function (options) {
        this.options = options;
    },

    render: function () {
        // Wrap onConfirm to check for validation errors first
        const wrappedOnConfirm = (ev) => {
            // Find the button that was clicked and traverse up to find its form
            const button = ev.target;
            const modal = button.closest('.modal');

            if (modal) {
                // Check for validation errors within this specific form only
                const invalidFields = modal.querySelectorAll('.cbi-input-invalid');
                if (invalidFields.length > 0) {
                    // Don't proceed - validation errors are already shown to user
                    return;
                }
            }

            // No validation errors, proceed with original handler
            if (this.options.onConfirm) {
                this.options.onConfirm(ev);
            }
        };

        return E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
            new UIButton(
                this.options.cancelText || _('Cancel'),
                this.options.onCancel || ui.hideModal,
                'negative'
            ).render(),
            ' ',
            new UIButton(
                this.options.confirmText || _('OK'),
                wrappedOnConfirm,
                this.options.confirmClass || 'positive'
            ).render()
        ]);
    }
});

const PodmanUI = UINotifications.extend({
    __name__: 'PodmanUI',

    Button: UIButton,
    MultiButton: UIMultiButton,
    ModalButtons: UIModalButtons,
});

return PodmanUI;
