'use strict';

'require baseclass';
'require ui';
'require dom';
'require podman.utils as utils';
'require podman.constants as c';

/**
 * UI notification helpers and custom components
 */
const UINotifications = baseclass.extend({
	__name__: 'Notifications',

	/**
	 * Show spinning modal dialog
	 * @param {string} title - Modal title
	 * @param {string} text - Modal text content
	 */
	showSpinningModal: function(title, text) {
		ui.showModal(title, [E('p', { 'class': 'spinning' }, text)]);
	},

	/**
	 * Show persistent notification
	 * @param {string} text - Notification text
	 * @param {string} [type] - Notification type
	 */
	simpleNotification: function (text, type) {
		ui.addNotification(null, E('p', text), type || '');
	},

	/**
	 * Show persistent warning notification
	 * @param {string} text - Warning message
	 */
	warningNotification: function (text) {
		ui.addNotification(null, E('p', text), 'warning');
	},

	/**
	 * Show persistent error notification
	 * @param {string} text - Error message
	 */
	errorNotification: function (text) {
		ui.addNotification(null, E('p', text), 'error');
	},

	/**
	 * Show timed notification
	 * @param {string} text - Notification text
	 * @param {string} [type] - Notification type
	 */
	simpleTimeNotification: function (text, type) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, type || '');
	},

	/**
	 * Show timed info notification
	 * @param {string} text - Info message
	 */
	infoTimeNotification: function (text) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'info');
	},

	/**
	 * Show timed warning notification
	 * @param {string} text - Warning message
	 */
	warningTimeNotification: function (text) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'warning');
	},

	/**
	 * Show timed success notification
	 * @param {string} text - Success message
	 */
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
	/**
	 * Initialize button
	 * @param {string} text - Button text
	 * @param {string|Function} href - URL or click handler
	 * @param {string} [cssClass] - Button style (positive, negative, remove, save, apply, neutral)
	 * @param {string} [tooltip] - Tooltip text
	 */
	__init__: function(text, href, cssClass, tooltip) {
		this.text = text;
		this.href = href;
		this.cssClass = cssClass;
		this.tooltip = tooltip;
	},

	/**
	 * Render button element
	 * @returns {Element} Button element
	 */
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

	/**
	 * Initialize multi-button
	 * @param {Array|Object} items - Initial items (optional)
	 * @param {string} [cssClass] - Button style
	 */
	__init__: function (items, cssClass) {
		if (Array.isArray(items)) {
			items.forEach((item) => {
				this.addItem(item.text, item.href);
			});
		}

		this.cssClass = cssClass;
	},

	/**
	 * Add menu item
	 * @param {string} text - Menu item text
	 * @param {string|Function} href - URL or click handler
	 * @returns {UIMultiButton} This instance for chaining
	 */
	addItem: function (text, href) {
		this.items.push({
			text,
			href
		});
		return this;
	},

	/**
	 * Render dropdown button
	 * @returns {Element|string} ComboButton element or empty string
	 */
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
	/**
	 * Initialize modal buttons
	 * @param {Object} options - Button configuration
	 */
	__init__: function (options) {
		this.options = options;
	},

	/**
	 * Render modal footer with Cancel and Confirm buttons
	 * @returns {Element} Button container element
	 */
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

const UITable = baseclass.extend({
	options: { 'class': 'table' },

	headers: [],
	rows: [],

	__init__: function (options) {
		this.options = Object.assign(this.options, options || {});
	},

	addHeader: function(header, options) {
		this.headers.push({
			inner: header,
			options: Object.assign({ 'class': 'th' }, options || {}),
		});

		return this;
	},

	setHeaders: function(headers) {
		this.headers = headers;

		return this;
	},

	addRow: function(cells, options) {
		this.rows.push({
			cells,
			options: Object.assign({ 'class': 'tr' }, options || {}),
		});

		return this;
	},

	setRows: function(rows) {
		this.rows = rows;

		return this;
	},

	render: function() {
		let headerRow = '';

		if (Array.isArray(this.headers) && this.headers.length > 0) {
			headerRow = E('tr', {
					'class': 'tr table-titles'
				},
				this.headers.map(function (header) {
					return E('th', header.options, header.inner);
				})
			);
		}

		let rows = '';

		if (Array.isArray(this.rows) && this.rows.length > 0) {
			rows = this.rows.map(function (row) {
				return E('tr', row.options,
					row.cells.map(function (cell) {
						return E('td', Object.assign({ 'class': 'td' }, cell.options || {}), cell.inner);
					})
				);
			});
		}

		return E('table', this.options, [headerRow].concat(rows));
	}
});

const UISection = baseclass.extend({
	options: { 'class': 'cbi-section' },
	nodes: [],

	__init__: function (options) {
		this.options = Object.assign(this.options, options || {});
	},

	addNode: function(title, inner, options) {
		this.nodes.push({
			title,
			inner,
			options: Object.assign({ 'class': 'cbi-section-node' }, options || {}),
		});

		return this;
	},

	render: function() {
		const nodes = [];
		this.nodes.map(function(node) {
			nodes.push(E('h3', {}, node.title));
			nodes.push(E('div', node.options, Array.isArray(node.inner) ? node.inner : [node.inner]));
		});

		return E('div', this.options, nodes);
	}
});

const PodmanUI = UINotifications.extend({
	__name__: 'PodmanUI',

	Button: UIButton,
	MultiButton: UIMultiButton,
	ModalButtons: UIModalButtons,
	Section: UISection,
	Table: UITable,
});

return PodmanUI;
