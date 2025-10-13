'use strict';
'require ui';
'require form';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.run-command-parser as RunCommandParser';

/**
 * @file Container creation form module using LuCI.form
 * @module podman.container-form
 * @description Provides a modal-based form for creating containers
 */

return L.Class.extend({
	render: function(onSuccess) {
		podmanRPC.image.list().then((images) => {
			this.showModal(images || [], onSuccess);
		}).catch((err) => {
			ui.addNotification(null, E('p', _('Failed to load images: %s').format(err.message)), 'error');
		});
	},

	showModal: function(images, onSuccess) {
		let field;

		const formData = {
			container: {
				name: null,
				image: null,
				command: null,
				ports: null,
				env: null,
				volumes: null,
				network: 'bridge',
				restart: 'no',
				privileged: false,
				interactive: false,
				tty: false,
				remove: false,
				autoupdate: false,
				start: true,
				workdir: null,
				hostname: null,
				labels: null,
				cpus: null,
				memory: null
			}
		};

		const map = new form.JSONMap(formData, _('Create Container'), '');
		const section = map.section(form.NamedSection, 'container', 'container');

		// Container Name
		field = section.option(form.Value, 'name', _('Container Name'));
		field.placeholder = _('my-container (optional)');
		field.optional = true;
		field.datatype = 'maxlength(253)';
		field.description = _('Leave empty to auto-generate');

		// Image Selection
		field = section.option(form.ListValue, 'image', _('Image'));
		field.value('', _('-- Select Image --'));
		if (images && Array.isArray(images)) {
			images.forEach((img) => {
				if (img.RepoTags && img.RepoTags.length > 0) {
					img.RepoTags.forEach((tag) => {
						if (tag !== '<none>:<none>') {
							field.value(tag, tag);
						}
					});
				}
			});
		}
		field.validate = (_section_id, value) => {
			if (!value) return _('Please select an image');
			return true;
		};
		field.description = _('Container image to use');

		// Command
		field = section.option(form.Value, 'command', _('Command'));
		field.placeholder = '/bin/sh';
		field.optional = true;
		field.description = _('Command to run (space-separated)');

		// Port Mappings
		field = section.option(form.TextValue, 'ports', _('Port Mappings'));
		field.placeholder = _('8080:80\n8443:443');
		field.rows = 3;
		field.optional = true;
		field.description = _('One per line, format: host:container');

		// Environment Variables
		field = section.option(form.TextValue, 'env', _('Environment Variables'));
		field.placeholder = _('VAR1=value1\nVAR2=value2');
		field.rows = 4;
		field.optional = true;
		field.description = _('One per line, format: KEY=value');

		// Volumes
		field = section.option(form.TextValue, 'volumes', _('Volumes'));
		field.placeholder = _('/host/path:/container/path\nvolume-name:/data');
		field.rows = 4;
		field.optional = true;
		field.description = _('One per line, format: source:destination');

		// Network Mode
		field = section.option(form.ListValue, 'network', _('Network Mode'));
		field.value('bridge', 'bridge');
		field.value('host', 'host');
		field.value('none', 'none');
		field.default = 'bridge';

		// Restart Policy
		field = section.option(form.ListValue, 'restart', _('Restart Policy'));
		field.value('no', _('No'));
		field.value('always', _('Always'));
		field.value('on-failure', _('On Failure'));
		field.value('unless-stopped', _('Unless Stopped'));
		field.default = 'no';

		// Privileged Mode
		field = section.option(form.Flag, 'privileged', _('Privileged Mode'));
		field.default = field.disabled;

		// Interactive
		field = section.option(form.Flag, 'interactive', _('Interactive (-i)'));
		field.default = field.disabled;

		// TTY
		field = section.option(form.Flag, 'tty', _('Allocate TTY (-t)'));
		field.default = field.disabled;

		// Auto Remove
		field = section.option(form.Flag, 'remove', _('Auto Remove (--rm)'));
		field.default = field.disabled;

		// Auto-Update
		field = section.option(form.Flag, 'autoupdate', _('Auto-Update'));
		field.default = field.disabled;
		field.description = _('Automatically update container when newer image is available. Adds label: io.containers.autoupdate=registry');

		// Start after creation
		field = section.option(form.Flag, 'start', _('Start after creation'));
		field.default = field.enabled;
		field.description = _('Automatically start the container after it is created');

		// Working Directory
		field = section.option(form.Value, 'workdir', _('Working Directory'));
		field.placeholder = '/app';
		field.optional = true;

		// Hostname
		field = section.option(form.Value, 'hostname', _('Hostname'));
		field.placeholder = 'container-host';
		field.optional = true;
		field.datatype = 'hostname';

		// Labels
		field = section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = _('key1=value1\nkey2=value2');
		field.rows = 3;
		field.optional = true;
		field.description = _('One per line, format: key=value');

		// CPU Limit
		field = section.option(form.Value, 'cpus', _('CPU Limit'));
		field.placeholder = '1.0';
		field.optional = true;
		field.datatype = 'ufloat';
		field.description = _('Number of CPUs (e.g., 0.5, 1.0, 2.0)');

		// Memory Limit
		field = section.option(form.Value, 'memory', _('Memory Limit'));
		field.placeholder = '512m';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (!/^\d+(?:\.\d+)?\s*[kmg]?$/i.test(value)) {
				return _('Invalid format. Use: 512m, 1g, etc.');
			}
			return true;
		};
		field.description = _('Memory limit (e.g., 512m, 1g)');

		map.render().then((formElement) => {
			ui.showModal('', [
				formElement,
				E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-negative',
						'click': () => {
							ui.hideModal();
							map.reset();
						}
					}, _('Cancel')),
					' ',
					E('button', { 'class': 'cbi-button cbi-button-positive', 'click': L.bind(this.handleCreate, this, map, onSuccess) }, _('Create'))
				])
			]);

			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[name="name"]');
				if (nameInput) nameInput.focus();
			});
		});
	},

	handleCreate: function(map, onSuccess) {
		map.parse().then(() => {
			const container = map.data.data.container;
			const spec = { image: container.image };

			if (container.name) spec.name = container.name;
			if (container.command) {
				spec.command = container.command.split(/\s+/).filter((c) => c.length > 0);
			}

			// Parse port mappings
			if (container.ports) {
				spec.portmappings = [];
				container.ports.split('\n').forEach((line) => {
					line = line.trim();
					if (!line) return;
					const parts = line.split(':');
					if (parts.length === 2) {
						const hostPort = parseInt(parts[0], 10);
						const containerPort = parseInt(parts[1], 10);
						if (!isNaN(hostPort) && !isNaN(containerPort)) {
							spec.portmappings.push({
								host_port: hostPort,
								container_port: containerPort,
								protocol: 'tcp'
							});
						}
					}
				});
			}

			// Parse environment variables
			if (container.env) {
				spec.env = {};
				container.env.split('\n').forEach((line) => {
					const parts = line.split('=');
					if (parts.length >= 2) {
						const key = parts[0].trim();
						const value = parts.slice(1).join('=').trim();
						if (key) spec.env[key] = value;
					}
				});
			}

			// Parse volumes
			if (container.volumes) {
				spec.mounts = [];
				container.volumes.split('\n').forEach((line) => {
					const parts = line.trim().split(':');
					if (parts.length >= 2) {
						spec.mounts.push({
							source: parts[0],
							destination: parts[1],
							type: 'bind'
						});
					}
				});
			}

			// Network configuration
			if (container.network === 'host') {
				spec.netns = { nsmode: 'host' };
			} else if (container.network === 'none') {
				spec.netns = { nsmode: 'none' };
			}

			// Other options
			if (container.restart !== 'no') spec.restart_policy = container.restart;
			if (container.privileged === '1') spec.privileged = true;
			if (container.interactive === '1') spec.stdin = true;
			if (container.tty === '1') spec.terminal = true;
			if (container.remove === '1') spec.remove = true;
			if (container.workdir) spec.work_dir = container.workdir;
			if (container.hostname) spec.hostname = container.hostname;

			// Parse labels
			if (container.labels || container.autoupdate === '1') {
				spec.labels = {};
				if (container.labels) {
					container.labels.split('\n').forEach((line) => {
						const parts = line.split('=');
						if (parts.length >= 2) {
							const key = parts[0].trim();
							const value = parts.slice(1).join('=').trim();
							if (key) spec.labels[key] = value;
						}
					});
				}
				if (container.autoupdate === '1') {
					spec.labels['io.containers.autoupdate'] = 'registry';
				}
			}

			// Resource limits
			if (container.cpus) {
				spec.resource_limits = spec.resource_limits || {};
				spec.resource_limits.cpu = { quota: parseFloat(container.cpus) * 100000 };
			}
			if (container.memory) {
				const memBytes = this.parseMemory(container.memory);
				if (memBytes > 0) {
					spec.resource_limits = spec.resource_limits || {};
					spec.resource_limits.memory = { limit: memBytes };
				}
			}

			ui.hideModal();
			map.reset();

			utils.showLoadingModal(_('Creating Container'), _('Creating container from image %s...').format(container.image));

			podmanRPC.container.create(JSON.stringify(spec)).then((result) => {
				if (result && result.error) {
					ui.hideModal();
					ui.addNotification(null, E('p', _('Failed to create container: %s').format(result.error)), 'error');
					return;
				}

				// Check if we should start the container
				const shouldStart = container.start === '1';

				if (shouldStart && result && result.Id) {
					// Start the container
					utils.showLoadingModal(_('Starting Container'), _('Starting container...'));

					podmanRPC.container.start(result.Id).then((startResult) => {
						ui.hideModal();
						if (startResult && startResult.error) {
							ui.addNotification(null, E('p', _('Container created but failed to start: %s').format(startResult.error)), 'warning');
						} else {
							ui.addTimeLimitedNotification(null, E('p', _('Container created and started successfully')), 2000);
						}
						if (onSuccess) onSuccess();
					}).catch((err) => {
						ui.hideModal();
						ui.addNotification(null, E('p', _('Container created but failed to start: %s').format(err.message)), 'warning');
						if (onSuccess) onSuccess();
					});
				} else {
					ui.hideModal();
					ui.addTimeLimitedNotification(null, E('p', _('Container created successfully')), 2000);
					if (onSuccess) onSuccess();
				}
			}).catch((err) => {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed to create container: %s').format(err.message)), 'error');
			});
		}).catch(() => {});
	},

	parseMemory: function(memStr) {
		const match = memStr.match(/^(\d+(?:\.\d+)?)\s*([kmg]?)$/i);
		if (!match) return 0;

		const value = parseFloat(match[1]);
		const unit = match[2].toLowerCase();
		const multipliers = { '': 1, 'k': 1024, 'm': 1024 * 1024, 'g': 1024 * 1024 * 1024 };

		return Math.floor(value * (multipliers[unit] || 1));
	},

	/**
	 * Show import from run command modal
	 * @param {Function} onSuccess - Callback on success
	 */
	showImportFromRunCommand: function(onSuccess) {

		const content = [
			E('p', {}, _('Paste a docker or podman run command below:')),
			E('textarea', {
				'id': 'run-command-input',
				'class': 'cbi-input-textarea',
				'rows': 8,
				'style': 'width: 100%; font-family: monospace;',
				'placeholder': 'docker run -d --name my-container -p 8080:80 -e ENV_VAR=value nginx:latest'
			}),
			E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'click': () => {
						ui.hideModal();
					}
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-positive',
					'click': L.bind(function() {
						const input = document.getElementById('run-command-input');
						const command = input ? input.value.trim() : '';

						if (!command) {
							ui.addNotification(null, E('p', _('Please enter a run command')), 'warning');
							return;
						}

						try {
							const spec = RunCommandParser.parse(command);
							ui.hideModal();
							this.createFromSpec(spec, onSuccess);
						} catch(err) {
							ui.addNotification(null, E('p', _('Failed to parse command: %s').format(err.message)), 'error');
						}
					}, this)
				}, _('Import'))
			])
		];

		ui.showModal(_('Import from Run Command'), content);

		// Focus the textarea
		requestAnimationFrame(() => {
			const textarea = document.getElementById('run-command-input');
			if (textarea) textarea.focus();
		});
	},

	/**
	 * Create container from a spec object
	 * @param {Object} spec - Container specification
	 * @param {Function} onSuccess - Callback on success
	 */
	createFromSpec: function(spec, onSuccess) {
		utils.showLoadingModal(_('Creating Container'), _('Creating container from image %s...').format(spec.image));

		podmanRPC.container.create(JSON.stringify(spec)).then((result) => {
			ui.hideModal();

			if (result && result.error) {
				ui.addNotification(null, E('p', _('Failed to create container: %s').format(result.error)), 'error');
				return;
			}

			ui.addTimeLimitedNotification(null, E('p', _('Container created successfully')), 2000);
			if (onSuccess) onSuccess();
		}).catch((err) => {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to create container: %s').format(err.message)), 'error');
		});
	}
});
