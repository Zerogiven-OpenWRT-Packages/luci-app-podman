'use strict';

'require baseclass';
'require podman.model.Model as Model';
'require podman.model.Container as Container';
'require podman.model.Image as Image';
'require podman.model.Network as Network';
'require podman.model.Volume as Volume';
'require podman.model.Secret as Secret';
'require podman.model.Pod as Pod';

return baseclass.extend({
	/**
	 * Container methods.
	 */
	containers: {
		list: Model.declareRPC({
			object: 'podman',
			method: 'containers_list',
			params: ['query'],
			expect: {
				data: []
			},
			filter: (containers) => containers
				.map((container) => Container.getSingleton(container))
				.sort((containerA, containerB) => containerA
					.getName()
					.localeCompare(containerB.getName()))
		}),

		create: Model.declareRPC({
			object: 'podman',
			method: 'container_create',
			params: ['data']
		}),
	},

	/**
	 * Image methods.
	 */
	images: {
		list: Model.declareRPC({
			object: 'podman',
			method: 'images_list',
			params: [],
			expect: {
				data: []
			},
			filter: (images) => images
				.map((image) => Image.getSingleton(image))
				.sort((imageA, imageB) => imageA.getDisplayTag().localeCompare(imageB.getDisplayTag())),
		}),
	},

	/**
	 * Pod methods.
	 */
	pods: {
		list: Model.declareRPC({
			object: 'podman',
			method: 'pods_list',
			params: [],
			expect: {
				data: []
			},
			filter: (pods) => pods
				.map((pod) => Pod.getSingleton(pod))
				.sort((a, b) => a.getName().localeCompare(b.getName()))
		}),

		create: Model.declareRPC({
			object: 'podman',
			method: 'pod_create',
			params: ['data']
		}),
	},

	/**
	 * Network management methods.
	 */
	networks: {
		list: Model.declareRPC({
			object: 'podman',
			method: 'networks_list',
			params: [],
			expect: {
				data: []
			},
			filter: (networks) => networks
				.map((network) => Network.getSingleton(network))
				.sort((networkA, networkB) => networkA.getName().localeCompare(networkB.getName())),
		}),

		create: Model.declareRPC({
			object: 'podman',
			method: 'network_create',
			params: ['data']
		}),
	},

	/**
	 * Volume management methods.
	 */
	volumes: {
		list: Model.declareRPC({
			object: 'podman',
			method: 'volumes_list',
			params: [],
			expect: {
				data: []
			},
			filter: (volumes) => volumes
				.map((volume) => Volume.getSingleton(volume))
				.sort((volumeA, volumeB) => volumeA.getName().localeCompare(volumeB.getName()))
		}),

		create: Model.declareRPC({
			object: 'podman',
			method: 'volume_create',
			params: ['data']
		}),

		import: Model.declareRPC({
			object: 'podman',
			method: 'volume_import',
			params: ['name', 'compressed']
		}),
	},

	/**
	 * Secret management methods.
	 */
	secrets: {
		list: Model.declareRPC({
			object: 'podman',
			method: 'secrets_list',
			params: [],
			expect: {
				data: []
			},
			filter: (secrets) => secrets
				.map((secret) => Secret.getSingleton(secret))
				.sort((secretA, secretB) => secretA.getName().localeCompare(secretB.getName()))
		}),

		create: Model.declareRPC({
			object: 'podman',
			method: 'secret_create',
			params: ['name', 'data', 'labels']
		}),
	},

	/**
	 * System information methods.
	 */
	system: {
		version: Model.declareRPC({
			object: 'podman',
			method: 'version',
			params: []
		}),

		info: Model.declareRPC({
			object: 'podman',
			method: 'info',
			params: []
		}),

		df: Model.declareRPC({
			object: 'podman',
			method: 'system_df',
			params: []
		}),

		prune: Model.declareRPC({
			object: 'podman',
			method: 'system_prune',
			params: ['all', 'volumes']
		}),

		debug: Model.declareRPC({
			object: 'podman',
			method: 'system_debug',
			params: []
		})
	},
});
