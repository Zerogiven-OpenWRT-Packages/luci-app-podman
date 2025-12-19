'use strict';

'require baseclass';
'require poll';
'require ui';
'require form';
'require uci';
'require network';
'require session';

'require podman.rpc as podmanRPC';
'require podman.utils as utils';

'require podman.form.container as FormContainer';
'require podman.form.image as FormImage';
'require podman.form.network as FormNetwork';
'require podman.form.network-connect as FormNetworkConnect';
'require podman.form.pod as FormPod';
'require podman.form.resource as FormResource';
'require podman.form.secret as FormSecret';
'require podman.form.volume as FormVolume';

/**
 * Provides inline editing for single values
 */
const FormEditableField = baseclass.extend({
	map: null,

	/**
	 * Render editable field
	 * @param {Object} options - Field options
	 * @param {string} options.title - Field title/label
	 * @param {string} options.value - Current value
	 * @param {string} [options.datatype] - LuCI datatype for validation
	 * @param {string} [options.placeholder] - Placeholder text
	 * @param {Function} options.onUpdate - Update callback (newValue) => void
	 * @param {string} [options.type] - Field type: 'text' (default), 'select', 'flag'
	 * @param {Array} [options.choices] - For select type: [{value, label}]
	 * @returns {Promise<HTMLElement>} Rendered form element
	 */
	render: async function (options) {
		this.options = options;

		const data = {
			field: {
				value: options.value || ''
			}
		};

		this.map = new form.JSONMap(data, '');
		const section = this.map.section(form.NamedSection, 'field', 'field');
		section.anonymous = true;
		section.addremove = false;

		let field;

		if (options.type === 'select') {
			field = section.option(form.ListValue, 'value', options.title);
			if (options.choices && Array.isArray(options.choices)) {
				options.choices.forEach((choice) => {
					field.value(choice.value, choice.label || choice.value);
				});
			}
		} else if (options.type === 'flag') {
			field = section.option(form.Flag, 'value', options.title);
		} else {
			field = section.option(form.Value, 'value', options.title);
			if (options.placeholder) field.placeholder = options.placeholder;
		}

		if (options.datatype) field.datatype = options.datatype;
		if (options.description) field.description = options.description;

		const btn = section.option(form.Button, '_update', ' ');
		btn.inputtitle = _('Update');
		btn.inputstyle = 'apply';
		btn.onclick = () => this.handleUpdate();

		return this.map.render();
	},

	/**
	 * Handle field update
	 */
	handleUpdate: function () {
		this.map.save().then(() => {
			const newValue = this.map.data.data.field.value;

			if (this.options.onUpdate) {
				this.options.onUpdate(newValue);
			}
		}).catch(() => {});
	}
});

/**
 *
 */
const FormSelectDummyValue = form.DummyValue.extend({
	/**
	 * Render checkbox for row selection
	 * @param {string} sectionId - Section identifier
	 * @returns {HTMLElement} Checkbox element
	 */
	cfgvalue: function(sectionId) {
		return new ui.Checkbox(0, { hiddenname: sectionId }).render();
	}
});

/**
 *
 */
const FormDataDummyValue = form.DummyValue.extend({
	containerProperty: '',
	cfgdefault: _('Unknown'),
	cfgtitle: null,
	cfgformatter: (cfg) => cfg,

	/**
	 * Extract and format data from container object
	 * @param {string} sectionId - Section identifier
	 * @returns {HTMLElement} Formatted data element
	 */
	cfgvalue: function(sectionId) {
		const property = this.containerProperty || this.option;
		if (!property) return '';

		const container = this.map.data.data[sectionId];
		const cfg = container &&
			container[property] || container[property.toLowerCase()] ?
			container[property] || container[property.toLowerCase()] :
			this.cfgdefault;

		let cfgtitle = null;

		if (this.cfgtitle) {
			cfgtitle = this.cfgtitle(cfg);
		}

		return E('span', {
			title: cfgtitle
		}, this.cfgformatter(cfg));
	}
});

/**
 *
 */
const FormLinkDataDummyValue = form.DummyValue.extend({
	text: (_data) => '',
	click: (_data) => null,
	linktitle: (_data) => null,

	/**
	 * Render clickable link with data from container object
	 * @param {string} sectionId - Section identifier
	 * @returns {HTMLElement} Link element
	 */
	cfgvalue: function(sectionId) {
		const data = this.map.data.data[sectionId];
		return E('a', {
			href: '#',
			title: this.linktitle(data),
			click: (ev) => {
				ev.preventDefault();
				this.click(data);
			}
		}, this.text(data));
	}
});

/**
 *
 */
const PodmanForm = baseclass.extend({
	Container: FormContainer,
	Image: FormImage,
	Network: FormNetwork,
	Pod: FormPod,
	Secret: FormSecret,
	Volume: FormVolume,
	Resource: FormResource,
	NetworkConnect: FormNetworkConnect,
	EditableField: FormEditableField,
	field: {
		DataDummyValue: FormDataDummyValue,
		LinkDataDummyValue: FormLinkDataDummyValue,
		SelectDummyValue: FormSelectDummyValue,
	},
});

return PodmanForm;
