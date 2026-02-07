'use strict';

'require baseclass';
'require ui';
'require dom';
'require podman.utils as utils';
'require podman.constants as c';

/**
 * Custom UI components and notification helpers for Podman LuCI application.
 * Provides wrappers for buttons, modals, tables, sections, tabs, and notifications.
 */
const UINotifications = baseclass.extend({
	__name__: 'Notifications',

	/**
	 * Show spinning modal with loading indicator.
	 * @param {string} title - Modal title
	 * @param {string} text - Loading message
	 */
	showSpinningModal: function(title, text) {
		ui.showModal(title, [E('p', { 'class': 'spinning' }, text)]);
	},

	/**
	 * Show persistent notification.
	 * @param {string} text - Message text
	 * @param {string} [type] - Type (info, warning, error)
	 */
	simpleNotification: function (text, type) {
		ui.addNotification(null, E('p', text), type || 'info');
	},

	infoNotification: function (text) {
		ui.addNotification(null, E('p', text), 'info');
	},

	/**
	 * Show persistent warning.
	 * @param {string} text - Warning message
	 */
	warningNotification: function (text) {
		ui.addNotification(null, E('p', text), 'warning');
	},

	/**
	 * Show persistent error.
	 * @param {string} text - Error message
	 */
	errorNotification: function (text) {
		ui.addNotification(null, E('p', text), 'error');
	},

	/**
	 * Show auto-dismiss notification.
	 * @param {string} text - Message text
	 * @param {string} [type] - Type (info, warning, success)
	 */
	simpleTimeNotification: function (text, type) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, type || 'info');
	},

	/**
	 * Show auto-dismiss info message.
	 * @param {string} text - Info message
	 */
	infoTimeNotification: function (text) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'info');
	},

	/**
	 * Show auto-dismiss warning.
	 * @param {string} text - Warning message
	 */
	warningTimeNotification: function (text) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'warning');
	},

	/**
	 * Show auto-dismiss success message.
	 * @param {string} text - Success message
	 */
	successTimeNotification: function (text) {
		ui.addTimeLimitedNotification(null, E('p', text), c.NOTIFICATION_TIMEOUT, 'success');
	},
});

const Notification = new UINotifications();

/**
 * Standard LuCI button with consistent styling.
 */
const UIButton = baseclass.extend({
	/**
	 * Initialize button.
	 * @param {string} text - Button label
	 * @param {string|Function} href - URL or click handler
	 * @param {string} [cssClass] - Style (positive, negative, remove, save, apply)
	 * @param {string} [tooltip] - Tooltip text
	 */
	__init__: function(text, href, cssClass, tooltip) {
		this.text = text;
		this.href = href;
		this.cssClass = cssClass;
		this.tooltip = tooltip;
	},

	/**
	 * Render button element.
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
 * Dropdown button menu using LuCI ComboButton.
 */
const UIMultiButton = baseclass.extend({
	cssClass: '',
	items: [],

	/**
	 * Initialize multi-button.
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
	 * Add menu item.
	 * @param {string} text - Item label
	 * @param {string|Function} href - URL or click handler
	 * @returns {UIMultiButton} This for chaining
	 */
	addItem: function (text, href) {
		this.items.push({
			text,
			href
		});
		return this;
	},

	/**
	 * Render dropdown button.
	 * @returns {Element|string} ComboButton element
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
 * Modal footer with Cancel and Confirm buttons.
 */
const UIModalButtons = baseclass.extend({
	/**
	 * Initialize modal buttons.
	 * @param {Object} options - Config (cancelText, confirmText, onCancel, onConfirm)
	 */
	__init__: function (options) {
		this.options = options;
	},

	/**
	 * Render modal footer.
	 * @returns {Element} Button container
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

/**
 * Table builder with header and row chaining.
 */
const UITable = baseclass.extend({
	options: { 'class': 'table' },

	headers: [],
	rows: [],

	/**
	 * Initialize table.
	 * @param {Object} [options] - Table options
	 */
	__init__: function (options) {
		this.headers = [];
		this.rows = [];
		this.options = Object.assign({ 'class': 'table' }, options || {});
	},

	/**
	 * Add header cell.
	 * @param {string|Element} header - Header content
	 * @param {Object} [options] - Cell options
	 * @returns {UITable} This for chaining
	 */
	addHeader: function(header, options) {
		this.headers.push({
			inner: header,
			options: Object.assign({ 'class': 'th' }, options || {}),
		});

		return this;
	},

	/**
	 * Set all headers at once.
	 * @param {Array} headers - Header array
	 * @returns {UITable} This for chaining
	 */
	setHeaders: function(headers) {
		this.headers = headers;

		return this;
	},

	/**
	 * Add data row.
	 * @param {Array} cells - Cell array
	 * @param {Object} [options] - Row options
	 * @returns {UITable} This for chaining
	 */
	addRow: function(cells, options) {
		this.rows.push({
			cells,
			options: Object.assign({ 'class': 'tr' }, options || {}),
		});

		return this;
	},

	/**
	 * Set all rows at once.
	 * @param {Array} rows - Row array
	 * @returns {UITable} This for chaining
	 */
	setRows: function(rows) {
		this.rows = rows;

		return this;
	},

	/**
	 * Add label/value row with standard styling.
	 * @param {string} label - Row label
	 * @param {string|Element} value - Row value
	 * @returns {UITable} This for chaining
	 */
	addInfoRow: function(label, value) {
		// Handle HTML values (like '<br>' tags)
		const valueContent = (typeof value === 'string' && value.indexOf('<br>') !== -1)
			? E('span', { 'innerHTML': value })
			: value;

		return this.addRow([
			{ inner: label },
			{ inner: valueContent }
		]);
	},

	/**
	 * Render table element.
	 * @returns {Element} Table element
	 */
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

/**
 * Section container with title, description, and content nodes.
 */
const UISection = baseclass.extend({
	options: { 'class': 'cbi-section' },
	nodes: [],

	/**
	 * Initialize section.
	 * @param {Object} [options] - Section options
	 */
	__init__: function (options) {
		this.nodes = [];
		this.options = Object.assign(this.options, options || {});
	},

	/**
	 * Add content node to section.
	 * @param {string} title - Node title
	 * @param {string} description - Node description
	 * @param {Element} inner - Node content
	 * @param {Object} [options] - Node options
	 * @returns {UISection} This for chaining
	 */
	addNode: function(title, description, inner, options) {
		this.nodes.push({
			title,
			description,
			inner,
			options: Object.assign({ 'class': 'cbi-section-node' }, options || {}),
		});

		return this;
	},

	/**
	 * Render section element.
	 * @returns {Element} Section element
	 */
	render: function() {
		const nodes = [];
		this.nodes.map(function(node) {
			if (node.title) {
				nodes.push(E('h3', {}, node.title));
			}
			if (node.description) {
				nodes.push(E('div', { 'class': 'cbi-section-descr' }, node.description));
			}
			nodes.push(E('div', node.options, Array.isArray(node.inner) ? node.inner : [node.inner]));
		});

		return E('div', this.options, nodes);
	}
});

/**
 * Tabbed interface using LuCI tabs API.
 */
const UITabs = baseclass.extend({
	tabs: [],
	activeTab: null,

	/**
	 * Initialize tabs container.
	 * @param {string} [activeTab] - Default active tab ID
	 */
	__init__: function (activeTab) {
		this.tabs = [];
		this.activeTab = activeTab || null;
	},

	/**
	 * Add tab pane.
	 * @param {string} id - Tab ID
	 * @param {string} title - Tab title
	 * @param {Element|string} content - Tab content
	 * @param {boolean} [active] - Force active
	 * @returns {UITabs} This for chaining
	 */
	addTab: function(id, title, content, active) {
		this.tabs.push({
			id: id,
			title: title,
			content: content,
			active: active || false
		});

		return this;
	},

	/**
	 * Render tab container and initialize LuCI tabs.
	 * @returns {Element} Tab container
	 */
	render: function() {
		const tabPanes = this.tabs.map((tab, index) => {
			const isActive = tab.active || (!this.activeTab && index === 0) || (this.activeTab === tab.id);

			const contentEl = typeof tab.content === 'string'
				? E('div', { 'id': tab.content })
				: tab.content;

			return E('div', {
				'class': 'tab-pane',
				'data-tab': tab.id,
				'data-tab-title': tab.title,
				'data-tab-active': isActive ? 'true' : null
			}, [contentEl]);
		});

		const tabContainer = E('div', {
			'class': 'cbi-section'
		}, [
			E('div', {
				'class': 'cbi-section-node'
			}, [
				E('div', {
					'class': 'tab-panes'
				}, tabPanes)
			])
		]);

		requestAnimationFrame(() => {
			const panes = tabContainer.querySelectorAll('.tab-pane');
			ui.tabs.initTabGroup(panes);
		});

		return tabContainer;
	}
});

const PodmanUI = UINotifications.extend({
	__name__: 'PodmanUI',

	Button: UIButton,
	MultiButton: UIMultiButton,
	ModalButtons: UIModalButtons,
	Section: UISection,
	Table: UITable,
	Tabs: UITabs,
});

return PodmanUI;
