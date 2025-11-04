/**
 * Custom UI components for LuCI Podman application
 * @module podman.ui
 */
'use strict';
'require baseclass';
'require ui';
'require podman.utils as utils';
'require podman.constants as c';

const UINotifications = baseclass.extend({
	__name__: 'Notifications',

	showSpinningModal: function(title, text) {
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
 * @param {string} text - Button text
 * @param {string|Function} href - URL or click handler
 * @param {string} [cssClass] - Button style (positive, negative, remove, save, apply, neutral)
 * @param {string} [tooltip] - Tooltip text
 */
const UIButton = baseclass.extend({
	__init__: function(text, href, cssClass, tooltip) {
		this.text = text;
		this.href = href;
		this.cssClass = cssClass;
		this.tooltip = tooltip;
	},

	render: function() {
		const attrs = {
			'class': this.cssClass ? 'cbi-button cbi-button-' + this.cssClass : 'cbi-button',
			'click': typeof this.href === 'function' ? this.href : (ev) => {
				ev.preventDefault();
				window.location.href = this.href;
			}
		};

		if (this.tooltip) {
			attrs.title = this.tooltip;
		}

		return E('button', attrs, this.text || '');
	}
});

/**
 * Dropdown button menu using ComboButton
 * @param {Array|Object} items - Initial items (optional)
 * @param {string} [cssClass] - Button style
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
		this.items.push({
			text,
			href
		});
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
			classes['item' + index] = this.cssClass ? 'cbi-button cbi-button-' + this
				.cssClass : 'cbi-button';
		});

		return (new ui.ComboButton(
			texts.item0,
			texts, {
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
 * @param {Object} options - Button configuration
 */
const UIModalButtons = baseclass.extend({
	__init__: function (options) {
		this.options = options;
	},

	render: function() {
		const wrappedOnConfirm = (ev) => {
			const modal = ev.target.closest('.modal');
			if (modal && modal.querySelectorAll('.cbi-input-invalid').length > 0) return;
			if (this.options.onConfirm) {
				this.options.onConfirm(ev);
			}
		};

		return E('div', {
			'class': 'right',
			'style': 'margin-top: 15px;'
		}, [
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
