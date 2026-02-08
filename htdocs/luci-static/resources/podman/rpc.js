'use strict';

'require baseclass';
'require rpc';

/**
 * Centralized interface to Podman API operations via luci.podman RPC.
 * Provides methods for containers, images, pods, volumes, networks, secrets, and system.
 */
return baseclass.extend({
	/**
	 * Container management methods.
	 */
	container: {
		/**
		 * List containers.
		 * @param {string} query - Query params (e.g., 'all=true')
		 * @returns {Promise<Array>} Container list
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'containers_list',
			params: ['query'],
			expect: {
				data: []
			}
		}),

		/**
		 * Inspect container.
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Container details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'container_inspect',
			params: ['id']
		}),

		/**
		 * Start container.
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Result
		 */
		start: rpc.declare({
			object: 'luci.podman',
			method: 'container_start',
			params: ['id']
		}),

		/**
		 * Stop container.
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Result
		 */
		stop: rpc.declare({
			object: 'luci.podman',
			method: 'container_stop',
			params: ['id']
		}),

		/**
		 * Restart container.
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Result
		 */
		restart: rpc.declare({
			object: 'luci.podman',
			method: 'container_restart',
			params: ['id']
		}),

		/**
		 * Remove container.
		 * @param {string} id - Container ID
		 * @param {boolean} force - Force removal
		 * @param {boolean} depend - Remove dependencies (e.g., pod containers)
		 * @returns {Promise<Object>} Result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'container_remove',
			params: ['id', 'force', 'depend']
		}),

		/**
		 * Get statistics
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Container stats
		 */
		stats: rpc.declare({
			object: 'luci.podman',
			method: 'container_stats',
			params: ['id']
		}),

		/**
		 * Create container
		 * @param {string} data - Container specification JSON (SpecGenerator)
		 * @returns {Promise<Object>} Result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'container_create',
			params: ['data']
		}),

		/**
		 * Rename container
		 * @param {string} id - Container ID
		 * @param {string} name - New container name
		 * @returns {Promise<Object>} Result
		 */
		rename: rpc.declare({
			object: 'luci.podman',
			method: 'container_rename',
			params: ['id', 'name']
		}),

		/**
		 * Update container
		 * @param {string} id - Container ID
		 * @param {string} data - Update specification JSON
		 * @returns {Promise<Object>} Result
		 */
		update: rpc.declare({
			object: 'luci.podman',
			method: 'container_update',
			params: ['id', 'data']
		}),

		/**
		 * Run health check
		 * @param {string} id - Container ID
		 * @returns {Promise<Object>} Health check result with Status, FailingStreak, and Log
		 */
		healthcheck: rpc.declare({
			object: 'luci.podman',
			method: 'container_healthcheck_run',
			params: ['id']
		}),

		/**
		 * Get process list
		 * @param {string} id - Container ID
		 * @param {string} ps_args - ps command arguments (optional, e.g., 'aux')
		 * @returns {Promise<Object>} Process list with Titles and Processes arrays
		 */
		top: rpc.declare({
			object: 'luci.podman',
			method: 'container_top',
			params: ['id', 'ps_args']
		}),

		/**
		 * Recreate container from its original create command.
		 * Used for auto-update feature to recreate containers with updated images.
		 * @param {string} command - JSON string of command array (e.g., '["podman","run",...]')
		 * @returns {Promise<Object>} Result with success flag or error
		 */
		recreate: rpc.declare({
			object: 'luci.podman',
			method: 'container_recreate',
			params: ['command']
		})
	},

	/**
	 * Image management methods.
	 
	 */
	image: {
		/**
		 * List images.
		 * @returns {Promise<Array>} List of image objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'images_list',
			params: [],
			expect: {
				data: []
			},
			filter: function(data) {
				// Expand multi-tag images into separate entries
				const expandedImages = [];
				(data || []).forEach((image) => {
					const repoTags = image.RepoTags || ['<none>:<none>'];
					repoTags.forEach((tag) => {
						expandedImages.push({
							...image,
							_displayTag: tag,
							_originalImage: image
						});
					});
				});
				// Sort by repository:tag alphabetically
				expandedImages.sort((a, b) => {
					const tagA = a._displayTag || '';
					const tagB = b._displayTag || '';
					return tagA.localeCompare(tagB);
				});
				return expandedImages;
			}
		}),

		/**
		 * Inspect image.
		 * @param {string} id - Image ID
		 * @returns {Promise<Object>} Image details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'image_inspect',
			params: ['id']
		}),

		/**
		 * Remove image.
		 * @param {string} id - Image ID
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'image_remove',
			params: ['id', 'force']
		}),

		/**
		 * Inspect remote image manifest without pulling.
		 * @param {string} image - Image name (e.g., 'docker.io/library/nginx:latest')
		 * @returns {Promise<Object>} Manifest with architecture entries
		 */
		manifestInspect: rpc.declare({
			object: 'luci.podman',
			method: 'image_manifest_inspect',
			params: ['image']
		}),

	},

	/**
	 * Pod management methods.
	 
	 */
	pod: {
		/**
		 * List pods.
		 * @returns {Promise<Array>} List of pod objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'pods_list',
			params: [],
			expect: {
				data: []
			}
		}),

		/**
		 * Inspect pod.
		 * @param {string} name - Pod name
		 * @returns {Promise<Object>} Pod details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'pod_inspect',
			params: ['name']
		}),

		/**
		 * Start pod.
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Result
		 */
		start: rpc.declare({
			object: 'luci.podman',
			method: 'pod_start',
			params: ['id']
		}),

		/**
		 * Stop pod.
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Result
		 */
		stop: rpc.declare({
			object: 'luci.podman',
			method: 'pod_stop',
			params: ['id']
		}),

		/**
		 * Restart pod.
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Result
		 */
		restart: rpc.declare({
			object: 'luci.podman',
			method: 'pod_restart',
			params: ['id']
		}),

		/**
		 * Pause pod.
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Result
		 */
		pause: rpc.declare({
			object: 'luci.podman',
			method: 'pod_pause',
			params: ['id']
		}),

		/**
		 * Unpause pod.
		 * @param {string} id - Pod ID
		 * @returns {Promise<Object>} Result
		 */
		unpause: rpc.declare({
			object: 'luci.podman',
			method: 'pod_unpause',
			params: ['id']
		}),

		/**
		 * Remove pod.
		 * @param {string} name - Pod name
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'pod_remove',
			params: ['name', 'force']
		}),

		/**
		 * Create pod.
		 * @param {string} data - Pod configuration JSON
		 * @returns {Promise<Object>} Result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'pod_create',
			params: ['data']
		}),

		/**
		 * Get statistics.
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
	 * Volume management methods.
	 
	 */
	volume: {
		/**
		 * List volumes.
		 * @returns {Promise<Array>} List of volume objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'volumes_list',
			params: [],
			expect: {
				data: []
			}
		}),

		/**
		 * Inspect volume.
		 * @param {string} name - Volume name
		 * @returns {Promise<Object>} Volume details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'volume_inspect',
			params: ['name']
		}),

		/**
		 * Remove volume.
		 * @param {string} name - Volume name
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'volume_remove',
			params: ['name', 'force']
		}),

		/**
		 * Create volume.
		 * @param {string} data - Volume configuration JSON
		 * @returns {Promise<Object>} Result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'volume_create',
			params: ['data']
		}),

		/**
		 * Import volume from tar.
		 * @param {string} name - Volume name
		 * @param {string} data - Base64-encoded tar data
		 * @param {boolean} compressed - Whether the data is gzip compressed
		 * @returns {Promise<Object>} Import result
		 */
		importVolume: rpc.declare({
			object: 'luci.podman',
			method: 'volume_import',
			params: ['name', 'data', 'compressed']
		})
	},

	/**
	 * Network management methods.
	 
	 */
	network: {
		/**
		 * List networks.
		 * @returns {Promise<Array>} List of network objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'networks_list',
			params: [],
			expect: {
				data: []
			},
			filter: function(data) {
				// Sort by name alphabetically
				return (data || []).sort((a, b) => {
					const nameA = a.name || a.Name || '';
					const nameB = b.name || b.Name || '';
					return nameA.localeCompare(nameB);
				});
			}
		}),

		/**
		 * Inspect network.
		 * @param {string} name - Network name
		 * @returns {Promise<Object>} Network details
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'network_inspect',
			params: ['name']
		}),

		/**
		 * Remove network.
		 * @param {string} name - Network name
		 * @param {boolean} force - Force removal
		 * @returns {Promise<Object>} Result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'network_remove',
			params: ['name', 'force']
		}),

		/**
		 * Create network.
		 * @param {string} data - Network configuration JSON
		 * @returns {Promise<Object>} Result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'network_create',
			params: ['data']
		}),

		/**
		 * Connect container to network.
		 * @param {string} name - Network name
		 * @param {string} data - Connection parameters JSON
		 * @returns {Promise<Object>} Result
		 */
		connect: rpc.declare({
			object: 'luci.podman',
			method: 'network_connect',
			params: ['name', 'data']
		}),

		/**
		 * Disconnect container from network.
		 * @param {string} name - Network name
		 * @param {string} data - Disconnection parameters JSON
		 * @returns {Promise<Object>} Result
		 */
		disconnect: rpc.declare({
			object: 'luci.podman',
			method: 'network_disconnect',
			params: ['name', 'data']
		})
	},

	/**
	 * Secret management methods.
	 
	 */
	secret: {
		/**
		 * List secrets.
		 * @returns {Promise<Array>} List of secret objects
		 */
		list: rpc.declare({
			object: 'luci.podman',
			method: 'secrets_list',
			params: [],
			expect: {
				data: []
			}
		}),

		/**
		 * Inspect secret (metadata only).
		 * @param {string} name - Secret name
		 * @returns {Promise<Object>} Secret metadata
		 */
		inspect: rpc.declare({
			object: 'luci.podman',
			method: 'secret_inspect',
			params: ['name']
		}),

		/**
		 * Create secret.
		 * @param {string} name - Secret name
		 * @param {string} data - Secret data (will be base64 encoded by backend)
		 * @returns {Promise<Object>} Result
		 */
		create: rpc.declare({
			object: 'luci.podman',
			method: 'secret_create',
			params: ['name', 'data']
		}),

		/**
		 * Remove secret.
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
	 * System information methods.
	 
	 */
	system: {
		/**
		 * Get version information.
		 * @returns {Promise<Object>} Version object with Version, ApiVersion, GoVersion, Os, Arch
		 */
		version: rpc.declare({
			object: 'luci.podman',
			method: 'version',
			params: []
		}),

		/**
		 * Get system information.
		 * @returns {Promise<Object>} System info object with host details
		 */
		info: rpc.declare({
			object: 'luci.podman',
			method: 'info',
			params: []
		}),

		/**
		 * Get disk usage.
		 * @returns {Promise<Object>} Disk usage data for images, containers, volumes
		 */
		df: rpc.declare({
			object: 'luci.podman',
			method: 'system_df',
			params: []
		}),

		/**
		 * Prune unused resources.
		 * @param {boolean} all - Remove all unused images, not just dangling ones
		 * @param {boolean} volumes - Prune volumes
		 * @returns {Promise<Object>} Prune results
		 */
		prune: rpc.declare({
			object: 'luci.podman',
			method: 'system_prune',
			params: ['all', 'volumes']
		})
	},

	/**
	 * Init script management methods for container auto-start on boot.
	 */
	initScript: {
		/**
		 * Generate init script for container.
		 * @param {string} name - Container name
		 * @returns {Promise<Object>} Result with path
		 */
		generate: rpc.declare({
			object: 'luci.podman',
			method: 'init_script_generate',
			params: ['name']
		}),

		/**
		 * Show init script content.
		 * @param {string} name - Container name
		 * @returns {Promise<Object>} Result with content
		 */
		show: rpc.declare({
			object: 'luci.podman',
			method: 'init_script_show',
			params: ['name']
		}),

		/**
		 * Get init script status.
		 * @param {string} name - Container name
		 * @returns {Promise<Object>} Status with exists and enabled flags
		 */
		status: rpc.declare({
			object: 'luci.podman',
			method: 'init_script_status',
			params: ['name']
		}),

		/**
		 * Enable or disable init script.
		 * @param {string} name - Container name
		 * @param {boolean} enabled - Enable (true) or disable (false)
		 * @returns {Promise<Object>} Result
		 */
		setEnabled: rpc.declare({
			object: 'luci.podman',
			method: 'init_script_set_enabled',
			params: ['name', 'enabled']
		}),

		/**
		 * Remove init script.
		 * @param {string} name - Container name
		 * @returns {Promise<Object>} Result
		 */
		remove: rpc.declare({
			object: 'luci.podman',
			method: 'init_script_remove',
			params: ['name']
		})
	}
});
