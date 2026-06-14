'use strict';

'require baseclass';

'require podman.model.Model as Model';

const SecretRPC = {
	inspect: Model.declareRPC({
		object: 'podman',
		method: 'secret_inspect',
		params: ['name']
	}),

	remove: Model.declareRPC({
		object: 'podman',
		method: 'secret_remove',
		params: ['name']
	}),
};

const Secret = Model.base.extend({
	__name__: 'Podman.Model.Secret',

	getID() {
		return this.ID;
	},

	getName() {
		return this.Spec?.Name;
	},

	getDriver() {
		return this.Spec?.Driver?.Name;
	},

	getLabels() {
		return this.Spec?.Labels ?? {};
	},

	async inspect() {
		return SecretRPC.inspect(this.getName());
	},

	async remove() {
		return SecretRPC.remove(this.getName());
	},
});

return baseclass.extend({
	getSingleton(secret) {
		return Secret.extend(secret).instantiate([]);
	},
});
