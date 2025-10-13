'use strict';
'require rpc';

/**
 * @file Podman RPC API
 * @module podman.rpc
 * @description Shared RPC method declarations for the Podman LuCI application.
 *
 * This module provides a centralized interface to all Podman API operations
 * through the luci.podman RPC object. Import this module in views to access
 * Podman API methods.
 *
 * @example
 * 'require podman.rpc as podmanRPC';
 *
 * podmanRPC.container.list('all=true').then(function(containers) {
 *     console.log(containers);
 * });
 *
 * podmanRPC.image.pull('nginx:latest').then(function(result) {
 *     console.log('Image pulled:', result);
 * });
 */

return L.Class.extend({
	/**
	 * Container management methods
	 * @namespace container
	 */
	container: {
		/**
		 * List containers
		 * @param {string} query - Query parameters (e.g., 'all=true')
		 * @returns {Promise<Array>} List of container objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'containers_list',
			params: ['query'],
			expect: { data: [] }
		}),

		/**
		 * Inspect a container
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Container details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'container_inspect',
			params: ['id']
		}),

		/**
		 * Start a container
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Operation result
		 */
		start: rpc.declare({
			object: 'luci.podman',
			method: 'container_start',
			params: ['id']
		}),

		/**
		 * Stop a container
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Operation result
		 */
		stop: rpc.declare({
			object: 'luci.podman',
			method: 'container_stop',
			params: ['id']
		}),

		/**
		 * Restart a container
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Operation result
		 */
		restart: rpc.declare({
			object: 'luci.podman',
			method: 'container_restart',
			params: ['id']
		}),

		/**
		 * Remove a container
		 * @param {string} id - Container ID
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Operation result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'container_remove',
			params: ['id', 'force']
		}),

		/**
		 * Get container logs
		 * @param {string} id - Container ID
		 * @param {string} params - Log parameters (e.g., 'stdout=true&stderr=true&tail=100')
		 * @returns {Promise<string>} Container logs
		 */
		logs: rpc.declare({
			object: 'luci.podman',
			method: 'container_logs',
			params: ['id', 'params']
		}),

		/**
		 * Get container statistics
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Container stats
		 */
		stats: rpc.declare({
			object: 'luci.podman',
			method: 'container_stats',
			params: ['id']
		}),

		/**
		 * Create a container
		 * @param {string} data - Container specification JSON (SpecGenerator)
		 * @returns {Promise<Object>} Creation result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'container_create',
			params: ['data']
		}),

		/**
		 * Rename a container
		 * @param {string} id - Container ID
		 * @param {string} name - New container name
		 * @returns {Promise<Object>} Operation result
		 */
		rename: rpc.declare({
			object: 'luci.podman',
			method: 'container_rename',
			params: ['id', 'name']
		}),

		/**
		 * Update a container
		 * @param {string} id - Container ID
		 * @param {string} data - Update specification JSON
		 * @returns {Promise<Object>} Operation result
		 */
		update: rpc.declare({
			object: 'luci.podman',
			method: 'container_update',
			params: ['id', 'data']
		})
	},

	/**
	 * Image management methods
	 * @namespace image
	 */
	image: {
		/**
		 * List images
		 * @returns {Promise<Array>} List of image objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'images_list',
			params: [],
			expect: { data: [] }
		}),

		/**
		 * Inspect an image
		 * @param {string} id - Image ID
		 * @returns {Promise<Object>} Image details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'image_inspect',
			params: ['id']
		}),

		/**
		 * Remove an image
		 * @param {string} id - Image ID
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Operation result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'image_remove',
			params: ['id', 'force']
		}),

		/**
		 * Pull an image (blocking)
		 * @param {string} image - Image name (e.g., 'nginx:latest')
		 * @returns {Promise<Object>} Pull result
		 */
		pull: rpc.declare({
			object: 'luci.podman',
			method: 'image_pull',
			params: ['image']
		}),

		/**
		 * Start streaming image pull
		 * @param {string} image - Image name (e.g., 'nginx:latest')
		 * @returns {Promise<Object>} Session object with session_id
		 */
		pullStream: rpc.declare({
			object: 'luci.podman',
			method: 'image_pull_stream',
			params: ['image']
		}),

		/**
		 * Get image pull status
		 * @param {string} session_id - Pull session ID
		 * @param {number} offset - Output offset for streaming
		 * @returns {Promise<Object>} Status object with output, complete, and success flags
		 */
		pullStatus: rpc.declare({
			object: 'luci.podman',
			method: 'image_pull_status',
			params: ['session_id', 'offset']
		})
	},

	/**
	 * Pod management methods
	 * @namespace pod
	 */
	pod: {
		/**
		 * List pods
		 * @returns {Promise<Array>} List of pod objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'pods_list',
			params: [],
			expect: { data: [] }
		}),

		/**
		 * Inspect a pod
		 * @param {string} name - Pod name
		 * @returns {Promise<Object>} Pod details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'pod_inspect',
			params: ['name']
		}),

		/**
		 * Start a pod
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Operation result
		 */
		start: rpc.declare({
			object: 'luci.podman',
			method: 'pod_start',
			params: ['id']
		}),

		/**
		 * Stop a pod
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Operation result
		 */
		stop: rpc.declare({
			object: 'luci.podman',
			method: 'pod_stop',
			params: ['id']
		}),

		/**
		 * Restart a pod
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Operation result
		 */
		restart: rpc.declare({
			object: 'luci.podman',
			method: 'pod_restart',
			params: ['id']
		}),

		/**
		 * Pause a pod
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Operation result
		 */
		pause: rpc.declare({
			object: 'luci.podman',
			method: 'pod_pause',
			params: ['id']
		}),

		/**
		 * Unpause a pod
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Operation result
		 */
		unpause: rpc.declare({
			object: 'luci.podman',
			method: 'pod_unpause',
			params: ['id']
		}),

		/**
		 * Remove a pod
		 * @param {string} name - Pod name
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Operation result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'pod_remove',
			params: ['name', 'force']
		}),

		/**
		 * Create a pod
		 * @param {string} data - Pod configuration JSON
		 * @returns {Promise<Object>} Creation result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'pod_create',
			params: ['data']
		}),

		/**
		 * Get pod statistics
		 * @param {string} name - Pod name
		 * @returns {Promise<Object>} Pod stats
		 */
		stats: rpc.declare({
			object: 'luci.podman',
			method: 'pod_stats',
			params: ['name']
		})
	},

	/**
	 * Volume management methods
	 * @namespace volume
	 */
	volume: {
		/**
		 * List volumes
		 * @returns {Promise<Array>} List of volume objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'volumes_list',
			params: [],
			expect: { data: [] }
		}),

		/**
		 * Inspect a volume
		 * @param {string} name - Volume name
		 * @returns {Promise<Object>} Volume details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'volume_inspect',
			params: ['name']
		}),

		/**
		 * Remove a volume
		 * @param {string} name - Volume name
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Operation result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'volume_remove',
			params: ['name', 'force']
		}),

		/**
		 * Create a volume
		 * @param {string} data - Volume configuration JSON
		 * @returns {Promise<Object>} Creation result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'volume_create',
			params: ['data']
		})
	},

	/**
	 * Network management methods
	 * @namespace network
	 */
	network: {
		/**
		 * List networks
		 * @returns {Promise<Array>} List of network objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'networks_list',
			params: [],
			expect: { data: [] }
		}),

		/**
		 * Inspect a network
		 * @param {string} name - Network name
		 * @returns {Promise<Object>} Network details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'network_inspect',
			params: ['name']
		}),

		/**
		 * Remove a network
		 * @param {string} name - Network name
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Operation result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'network_remove',
			params: ['name', 'force']
		}),

		/**
		 * Create a network
		 * @param {string} data - Network configuration JSON
		 * @returns {Promise<Object>} Creation result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'network_create',
			params: ['data']
		}),

		/**
		 * Connect a container to a network
		 * @param {string} name - Network name
		 * @param {string} data - Connection parameters JSON
		 * @returns {Promise<Object>} Operation result
		 */
		connect: rpc.declare({
			object: 'luci.podman',
			method: 'network_connect',
			params: ['name', 'data']
		}),

		/**
		 * Disconnect a container from a network
		 * @param {string} name - Network name
		 * @param {string} data - Disconnection parameters JSON
		 * @returns {Promise<Object>} Operation result
		 */
		disconnect: rpc.declare({
			object: 'luci.podman',
			method: 'network_disconnect',
			params: ['name', 'data']
		})
	},

	/**
	 * Secret management methods
	 * @namespace secret
	 */
	secret: {
		/**
		 * List secrets
		 * @returns {Promise<Array>} List of secret objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'secrets_list',
			params: [],
			expect: { data: [] }
		}),

		/**
		 * Inspect a secret (metadata only, not the actual secret data)
		 * @param {string} name - Secret name
		 * @returns {Promise<Object>} Secret metadata
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'secret_inspect',
			params: ['name']
		}),

		/**
		 * Create a secret
		 * @param {string} name - Secret name
		 * @param {string} data - Secret data (will be base64 encoded by backend)
		 * @returns {Promise<Object>} Creation result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'secret_create',
			params: ['name', 'data']
		}),

		/**
		 * Remove a secret
		 * @param {string} name - Secret name
		 * @returns {Promise<Object>} Removal result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'secret_remove',
			params: ['name']
		})
	},

	/**
	 * System information methods
	 * @namespace system
	 */
	system: {
		/**
		 * Get Podman version information
		 * @returns {Promise<Object>} Version object with Version, ApiVersion, GoVersion, Os, Arch
		 */
		version: rpc.declare({
			object: 'luci.podman',
			method: 'version',
			params: []
		}),

		/**
		 * Get system information
		 * @returns {Promise<Object>} System info object with host details
		 */
		info: rpc.declare({
			object: 'luci.podman',
			method: 'info',
			params: []
		}),

		/**
		 * Get disk usage information
		 * @returns {Promise<Object>} Disk usage data for images, containers, volumes
		 */
		df: rpc.declare({
			object: 'luci.podman',
			method: 'system_df',
			params: []
		}),

		/**
		 * Prune unused resources
		 * @param {boolean} all - Remove all unused images, not just dangling ones
		 * @param {boolean} volumes - Prune volumes
		 * @returns {Promise<Object>} Prune results
		 */
		prune: rpc.declare({
			object: 'luci.podman',
			method: 'system_prune',
			params: ['all', 'volumes']
		}),

		/**
		 * Run auto-update on containers with autoupdate labels
		 * @param {boolean} dry_run - Only check for updates, don't apply
		 * @returns {Promise<Object>} Auto-update results
		 */
		autoUpdate: rpc.declare({
			object: 'luci.podman',
			method: 'auto_update',
			params: ['dry_run']
		})
	}
});
