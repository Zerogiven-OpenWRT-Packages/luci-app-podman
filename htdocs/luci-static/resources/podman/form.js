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
 * Checkbox column for row selection in GridSection tables
 */
const FormSelectDummyValue = form.DummyValue.extend({
	__name__: 'CBI.SelectDummyValue',

	/**
	 * Render checkbox for row selection
	 * @param {string} sectionId - Section identifier
	 * @returns {HTMLElement} Checkbox element
	 */
	cfgvalue: function(sectionId) {
		return new ui.Checkbox(0, { hiddenname: sectionId }).render();
	}
});

const FormContainerMobileActionsValue = form.DummyValue.extend({
	__name__: 'CBI.ContainerMobileActionsValue',
});

/**
 * Data display column that extracts and formats a property from row data
 */
const FormDataDummyValue = form.DummyValue.extend({
	__name__: 'CBI.DataDummyValue',

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
 * Clickable link column that renders data as an anchor element
 */
const FormLinkDataDummyValue = form.DummyValue.extend({
	__name__: 'CBI.LinkDataDummyValue',

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
 * Form components registry - exports all form modules and custom field types
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
	field: {
		ContainerMobileActionsValue: FormContainerMobileActionsValue,
		DataDummyValue: FormDataDummyValue,
		LinkDataDummyValue: FormLinkDataDummyValue,
		SelectDummyValue: FormSelectDummyValue,
	},
});

return PodmanForm;
