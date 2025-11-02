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
'require podman.ui as pui';
'require podman.run-command-parser as RunCommandParser';
'require podman.openwrt-network as openwrtNetwork';
'require podman.ipv6 as ipv6';

const FormContainer = baseclass.extend({
	map: null,
	data: {
		container: {
			name: null,
			image: null,
			command: null,
			ports: null,
			env: null,
			volumes: null,
			network: 'bridge',
			restart: 'no',
			privileged: '0',
			interactive: '0',
			tty: '0',
			remove: '0',
			autoupdate: '0',
			start: '0',
			workdir: null,
			hostname: null,
			labels: null,
			cpus: null,
			memory: null,
			enable_healthcheck: '0',
			healthcheck_type: 'CMD',
			healthcheck_command: null,
			healthcheck_interval: null,
			healthcheck_timeout: null,
			healthcheck_start_period: null,
			healthcheck_start_interval: null,
			healthcheck_retries: null
		}
	},

	render: function () {
		// Load both images and networks
		Promise.all([
			podmanRPC.image.list(),
			podmanRPC.network.list()
		]).then((results) => {
			const images = results[0] || [];
			const networks = results[1] || [];
			this.showModal(images, networks);
		}).catch((err) => {
			pui.errorNotification(_('Failed to load data: %s').format(err.message));
		});
	},

	showModal: function (images, networks) {
		this.map = new form.JSONMap(this.data, _('Create Container'), '');

		const section = this.map.section(form.NamedSection, 'container', 'container');
		let field;

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
		field = section.option(form.ListValue, 'network', _('Network'));
		field.value('bridge', 'bridge (default)');
		field.value('host', 'host');
		field.value('none', 'none');
		// Add user-created networks
		if (networks && Array.isArray(networks)) {
			networks.forEach((net) => {
				const name = net.Name || net.name;
				// Skip system networks (already added above)
				if (name && name !== 'bridge' && name !== 'host' && name !== 'none') {
					field.value(name, name);
				}
			});
		}
		field.description = _(
			'Select network for the container. User-created networks provide better isolation and DNS resolution between containers.'
		);

		// Restart Policy
		field = section.option(form.ListValue, 'restart', _('Restart Policy'));
		field.value('no', _('No'));
		field.value('always', _('Always'));
		field.value('on-failure', _('On Failure'));
		field.value('unless-stopped', _('Unless Stopped'));

		// Privileged Mode
		field = section.option(form.Flag, 'privileged', _('Privileged Mode'));

		// Interactive
		field = section.option(form.Flag, 'interactive', _('Interactive (-i)'));

		// TTY
		field = section.option(form.Flag, 'tty', _('Allocate TTY (-t)'));

		// Auto Remove
		field = section.option(form.Flag, 'remove', _('Auto Remove (--rm)'));

		// Auto-Update
		field = section.option(form.Flag, 'autoupdate', _('Auto-Update'));
		field.description = _(
			'Automatically update container when newer image is available. Adds label: io.containers.autoupdate=registry'
		);

		// Start after creation
		field = section.option(form.Flag, 'start', _('Start after creation'));
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

		// // Memory Limit
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

		// Health Check Configuration
		field = section.option(form.Flag, 'enable_healthcheck', _('Enable Health Check'));
		field.description = _('Configure health check to monitor container health status');

		// Health Check Type
		field = section.option(form.ListValue, 'healthcheck_type', _('Health Check Type'));
		field.depends('enable_healthcheck', '1');
		field.value('CMD', 'CMD');
		field.value('CMD-SHELL', 'CMD-SHELL');
		field.description = _('CMD runs command directly, CMD-SHELL runs command in shell');

		// Health Check Command
		field = section.option(form.Value, 'healthcheck_command', _('Health Check Command'));
		field.depends('enable_healthcheck', '1');
		field.placeholder = '/bin/health-check.sh';
		field.optional = false;
		field.description = _(
			'Command to run for health check. Exit code 0 = healthy, 1 = unhealthy');

		// Health Check Interval
		field = section.option(form.Value, 'healthcheck_interval', _('Interval'));
		field.depends('enable_healthcheck', '1');
		field.placeholder = '30s';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
				return _('Invalid format. Use: 30s, 1m, 1h, etc.');
			}
			return true;
		};
		field.description = _('Time between health checks (e.g., 30s, 1m, 5m). Default: 30s');

		// Health Check Timeout
		field = section.option(form.Value, 'healthcheck_timeout', _('Timeout'));
		field.depends('enable_healthcheck', '1');
		field.placeholder = '30s';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
				return _('Invalid format. Use: 5s, 10s, 30s, etc.');
			}
			return true;
		};
		field.description = _('Maximum time for health check to complete. Default: 30s');

		// Health Check Start Period
		field = section.option(form.Value, 'healthcheck_start_period', _('Start Period'));
		field.depends('enable_healthcheck', '1');
		field.placeholder = '0s';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
				return _('Invalid format. Use: 30s, 1m, 5m, etc.');
			}
			return true;
		};
		field.description = _(
			'Grace period before health checks count toward failures. Default: 0s');

		// Health Check Start Interval
		field = section.option(form.Value, 'healthcheck_start_interval', _('Start Interval'));
		field.depends('enable_healthcheck', '1');
		field.placeholder = '5s';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
				return _('Invalid format. Use: 5s, 10s, etc.');
			}
			return true;
		};
		field.description = _('Interval during start period (podman 4.8+). Default: 5s');

		// Health Check Retries
		field = section.option(form.Value, 'healthcheck_retries', _('Retries'));
		field.depends('enable_healthcheck', '1');
		field.placeholder = '3';
		field.optional = true;
		field.datatype = 'uinteger';
		field.description = _(
			'Number of consecutive failures before marking unhealthy. Default: 3');

		this.map.render().then((formElement) => {
			ui.showModal('', [
				formElement,
				new pui.ModalButtons({
					confirmText: _('Create'),
					onConfirm: () => this.handleCreate(),
					onCancel: () => {
						ui.hideModal();
						this.map.reset();
					}
				}).render()
			]);

			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[name="name"]');
				if (nameInput) nameInput.focus();
			});
		});
	},

	handleCreate: function () {
		this.map.save().then(() => {
			const container = this.map.data.data.container;
			const spec = {
				image: container.image
			};

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
				spec.volumes = [];
				container.volumes.split('\n').forEach((line) => {
					const parts = line.trim().split(':');
					if (parts.length >= 2) {
						if (parts[0].indexOf('/') > -1) {
							spec.mounts.push({
								source: parts[0],
								destination: parts[1],
							});
						} else {
							spec.volumes.push({
								name: parts[0],
								dest: parts[1],
							});
						}
					}
				});
			}

			// Network configuration
			if (container.network === 'host') {
				spec.netns = {
					nsmode: 'host'
				};
			} else if (container.network === 'none') {
				spec.netns = {
					nsmode: 'none'
				};
			} else if (container.network && container.network !== 'bridge') {
				// User-created network - add to networks array
				spec.networks = {};
				spec.networks[container.network] = {};
			}
			// If bridge or not specified, Podman uses default bridge network

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
				spec.resource_limits.cpu = {
					quota: parseFloat(container.cpus) * 100000
				};
			}
			if (container.memory) {
				const memBytes = utils.parseMemory(container.memory);
				if (memBytes > 0) {
					spec.resource_limits = spec.resource_limits || {};
					spec.resource_limits.memory = {
						limit: memBytes
					};
				}
			}

			// Health check configuration
			if (container.enable_healthcheck === '1' && container.healthcheck_command) {
				const healthConfig = {
					Test: [container.healthcheck_type, container.healthcheck_command]
				};

				// Add optional duration fields (converted to nanoseconds)
				if (container.healthcheck_interval) {
					healthConfig.Interval = utils.parseDuration(container
						.healthcheck_interval);
				}
				if (container.healthcheck_timeout) {
					healthConfig.Timeout = utils.parseDuration(container
						.healthcheck_timeout);
				}
				if (container.healthcheck_start_period) {
					healthConfig.StartPeriod = utils.parseDuration(container
						.healthcheck_start_period);
				}
				if (container.healthcheck_start_interval) {
					healthConfig.StartInterval = utils.parseDuration(container
						.healthcheck_start_interval);
				}
				if (container.healthcheck_retries) {
					healthConfig.Retries = parseInt(container.healthcheck_retries);
				}

				spec.healthconfig = healthConfig;
			}

			ui.hideModal();
			this.map.reset();

			pui.showSpinningModal(_('Creating Container'), _(
				'Creating container from image %s...').format(container.image));

			podmanRPC.container.create(JSON.stringify(spec)).then((result) => {
				if (result && result.error) {
					ui.hideModal();
					pui.errorNotification(_('Failed to create container: %s')
						.format(result.error));
					return;
				}

				// Check if we should start the container
				// Handle different value types from LuCI Flag component
				const shouldStart = container.start === '1' || container.start ===
					true || container.start === 1;

				if (shouldStart && result && result.Id) {
					// Start the container
					pui.showSpinningModal(_('Starting Container'), _(
						'Starting container...'));

					podmanRPC.container.start(result.Id).then((startResult) => {
						ui.hideModal();
						if (startResult && startResult.error) {
							pui.warningNotification(_(
								'Container created but failed to start: %s'
							).format(startResult.error));
						} else {
							pui.successTimeNotification(_(
								'Container created and started successfully'
							));
						}

						this.submit();
					}).catch((err) => {
						ui.hideModal();
						pui.errorNotification(_(
							'Container created but failed to start: %s'
						).format(err.message));
						this.submit();
					});
				} else {
					ui.hideModal();
					pui.successTimeNotification(_(
						'Container created successfully'));
					this.submit();
				}
			}).catch((err) => {
				ui.hideModal();
				pui.errorNotification(_('Failed to create container: %s').format(
					err.message));
			});
		}).catch(() => {});
	},

	/**
	 * Show import from run command modal
	 */
	showImportFromRunCommand: function () {

		const content = [
			E('p', {}, _('Paste a docker or podman run command below:')),
			E('textarea', {
				'id': 'run-command-input',
				'class': 'cbi-input-textarea',
				'rows': 8,
				'style': 'width: 100%; font-family: monospace;',
				'placeholder': 'docker run -d --name my-container -p 8080:80 -e ENV_VAR=value nginx:latest'
			}),
			new pui.ModalButtons({
				confirmText: _('Import'),
				onConfirm: () => {
					const input = document.getElementById('run-command-input');
					const command = input ? input.value.trim() : '';

					if (!command) {
						pui.warningNotification(_('Please enter a run command'));
						return;
					}

					try {
						const spec = RunCommandParser.parse(command);
						ui.hideModal();
						this.createFromSpec(spec);
					} catch (err) {
						pui.errorNotification(_('Failed to parse command: %s').format(
							err.message));
					}
				}
			}).render()
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
	 */
	createFromSpec: function (spec) {
		pui.showSpinningModal(_('Creating Container'), _('Creating container from image %s...')
			.format(spec.image));

		podmanRPC.container.create(JSON.stringify(spec)).then((result) => {
			if (result && result.error) {
				ui.hideModal();
				pui.errorNotification(_('Failed to create container: %s').format(result
					.error));
				return;
			}

			// Check if we should start the container
			// Start if: interactive mode (-it), remove flag (--rm), or explicitly detached (-d)
			const shouldStart = spec.remove || spec.stdin || spec.terminal || spec.detach;

			if (shouldStart && result && result.Id) {
				// Start the container
				pui.showSpinningModal(_('Starting Container'), _(
					'Starting container...'));

				podmanRPC.container.start(result.Id).then((startResult) => {
					ui.hideModal();
					if (startResult && startResult.error) {
						pui.warningNotification(_(
								'Container created but failed to start: %s')
							.format(startResult.error));
					} else {
						pui.successTimeNotification(_(
							'Container created and started successfully'));
					}
					this.submit();
				}).catch((err) => {
					ui.hideModal();
					pui.warningNotification(_(
							'Container created but failed to start: %s')
						.format(err.message));
					this.submit();
				});
			} else {
				ui.hideModal();
				pui.successTimeNotification(_('Container created successfully'));
				this.submit();
			}
		}).catch((err) => {
			ui.hideModal();
			pui.errorNotification(_('Failed to create container: %s').format(err
				.message));
		});
	},

	submit: () => {},
});

const FormImage = baseclass.extend({
	__name__: 'Form.Image',
	map: null,
	pollFn: null,

	data: {
		image: {
			registry: '',
			image: ''
		}
	},

	render: function () {
		this.map = new form.JSONMap(this.data, _('Pull Image'), _(
			'Fetch a container image using Podman.'));
		const s = this.map.section(form.NamedSection, 'image', '');

		// Registry dropdown
		const oReg = s.option(form.ListValue, 'registry', _('Registry'));
		oReg.value('', 'docker.io');
		oReg.value('quay.io/', 'quay.io');
		oReg.value('ghcr.io/', 'ghcr.io');
		oReg.value('gcr.io/', 'gcr.io');

		// Image name
		const oImg = s.option(form.Value, 'image', _('Image'));
		oImg.placeholder = 'nginx:latest';
		oImg.rmempty = false;

		const btn = s.option(form.Button, '_pull', ' ');
		btn.inputstyle = 'add';
		btn.inputtitle = _('Pull Image');
		btn.onclick = (ev) => {
			const button = ev.target;
			const formContainer = button.closest('.cbi-section, .cbi-map');
			if (formContainer) {
				const invalidFields = formContainer.querySelectorAll('.cbi-input-invalid');
				if (invalidFields.length > 0) {
					return;
				}
			}

			this.handlePullExecute();
		};

		return this.map.render();
	},

	/**
	 * Execute image pull with streaming progress
	 */
	handlePullExecute: function () {
		this.map.save().then(() => {
			const registry = this.map.data.data.image.registry;
			const image = this.map.data.data.image.image;

			if (!image) {
				pui.errorNotification(_('Please enter an image name'));
				return;
			}

			// If registry is empty (docker.io default), add the prefix
			const imageName = registry ? registry + image : 'docker.io/library/' + image;

			ui.showModal(_('Pulling Image'), [
				E('p', {
					'class': 'spinning'
				}, _('Starting image pull...')),
				E('pre', {
					'id': 'pull-output',
					'style': 'max-height: 300px; overflow-y: auto; overflow-x: auto; background: #000; color: #0f0; padding: 10px; min-height: 100px; white-space: pre;'
				}, '')
			]);

			podmanRPC.image.pullStream(imageName).then((result) => {
				if (!result || !result.session_id) {
					ui.hideModal();
					pui.errorNotification(_('Failed to start image pull'));
					return;
				}

				this.pollPullStatus(result.session_id);
			}).catch((err) => {
				ui.hideModal();
				pui.errorNotification(_('Failed to pull image: %s').format(err
					.message));
			});
		});
	},

	/**
	 * Parse Docker/Podman JSON stream output
	 * @param {string} output - Raw output string
	 * @returns {string} Cleaned output
	 */
	parseJsonStream: function (output) {
		let cleanOutput = '';
		const lines = output.split('\n');

		lines.forEach((line) => {
			line = line.trim();
			if (!line) return;

			let hasValidJson = false;

			// Strategy 1: Try parsing the entire line as a single JSON object
			try {
				const obj = JSON.parse(line);
				if (obj.stream) {
					cleanOutput += obj.stream;
					hasValidJson = true;
				} else if (obj.images && obj.images.length > 0) {
					cleanOutput += 'Image ID: ' + obj.id + '\n';
					hasValidJson = true;
				}
			} catch (e) {
				// Strategy 2: Line might contain multiple JSON objects like: {...} {...}
				const parts = line.split(/\}\s*\{/);
				if (parts.length > 1) {
					parts.forEach((part, idx) => {
						if (idx > 0) part = '{' + part;
						if (idx < parts.length - 1) part = part + '}';

						try {
							const obj = JSON.parse(part);
							if (obj.stream) {
								cleanOutput += obj.stream;
								hasValidJson = true;
							} else if (obj.images && obj.images.length > 0) {
								cleanOutput += 'Image ID: ' + obj.id + '\n';
								hasValidJson = true;
							}
						} catch (e2) {
							// Not valid JSON
						}
					});
				}
			}

			// If no valid JSON was extracted, treat as plain text
			if (!hasValidJson) {
				cleanOutput += line + '\n';
			}
		});

		return cleanOutput;
	},

	/**
	 * Poll image pull status and update progress using poll.add()
	 * @param {string} sessionId - Pull session ID
	 */
	pollPullStatus: function (sessionId) {
		const outputEl = document.getElementById('pull-output');
		let offset = 0;

		this.pollFn = () => {
			return podmanRPC.image.pullStatus(sessionId, offset).then((status) => {
				// Check for output
				if (status.output && outputEl) {
					const cleanOutput = this.parseJsonStream(status.output);
					outputEl.textContent += cleanOutput;
					outputEl.scrollTop = outputEl.scrollHeight;
					offset += status.output.length;
				}

				// Check for completion
				if (status.complete) {
					poll.remove(this.pollFn);

					if (!status.success) {
						if (outputEl) {
							outputEl.textContent += '\n\nPull failed!';
						}

						const modalContent = document.querySelector('.modal');
						if (modalContent) {
							const closeBtn = modalContent.querySelector(
								'.cbi-button');
							if (!closeBtn) {
								const btnContainer = E(
									'div', {
										'class': 'right',
										'style': 'margin-top: 10px;'
									},
									[
										new pui.Button(_('Close'), () => {
											ui
												.hideModal();
										}).render()
									]);
								modalContent.appendChild(btnContainer);
							}
						}

						pui.errorNotification(_('Failed to pull image'));

						return;
					}

					if (outputEl) {
						outputEl.textContent += '\n\nImage pulled successfully!';
					}

					const modalContent = document.querySelector('.modal');
					if (modalContent) {
						const closeBtn = modalContent.querySelector('.cbi-button');
						if (!closeBtn) {
							const btnContainer = E(
								'div', {
									'class': 'right',
									'style': 'margin-top: 10px;'
								},
								[
									new pui.Button(_('Close'), () => {
										ui
											.hideModal();
									}, 'positive').render()
								]);
							modalContent.appendChild(btnContainer);
						}
					}

					pui.successTimeNotification(_('Image pulled successfully'));

					this.map.reset();
					this.submit();
				}
			}).catch((err) => {
				poll.remove(this.pollFn);
				if (outputEl) {
					outputEl.textContent += '\n\nError: ' + err.message;
				}
				pui.errorNotification(_('Failed to pull image: %s').format(err
					.message));
			});
		};

		poll.add(this.pollFn, 1); // Poll every 1 second
	},

	submit: () => {},
});

const FormNetwork = baseclass.extend({
	map: null,
	data: {
		network: {
			name: null,
			driver: 'bridge',
			subnet: null,
			gateway: null,
			ip_range: null,
			ipv6: '0',
			internal: '0',
			labels: null,
			setup_openwrt: '1',
		}
	},

	render: function () {
		this.map = new form.JSONMap(this.data, _('Create Network'), '');
		const section = this.map.section(form.NamedSection, 'network', 'network');

		let field;

		// Network Name
		field = section.option(form.Value, 'name', _('Network Name'));
		field.placeholder = _('my-network');
		field.datatype = 'maxlength(253)';
		field.description = _('Name for the network');
		field.rmempty = false;

		// Driver
		field = section.option(form.ListValue, 'driver', _('Driver'));
		field.value('bridge', 'bridge');
		field.value('macvlan', 'macvlan');
		field.value('ipvlan', 'ipvlan');
		field.description = _('Network driver');

		// IPv4 Subnet
		field = section.option(form.Value, 'subnet', _('IPv4 Subnet (CIDR)'));
		field.placeholder = '10.89.0.0/24';
		field.datatype = 'cidr4';
		field.description = _('IPv4 subnet in CIDR notation');
		field.rmempty = false;

		// IPv4 Gateway
		field = section.option(form.Value, 'gateway', _('IPv4 Gateway'));
		field.placeholder = '10.89.0.1';
		field.optional = true;
		field.datatype = 'ip4addr';
		field.description = _('IPv4 gateway address');

		// IP Range
		field = section.option(form.Value, 'ip_range', _('IP Range (CIDR)'));
		field.placeholder = '10.89.0.0/28';
		field.optional = true;
		field.datatype = 'cidr4';
		field.description = _('Allocate container IP from this range');

		// IPv6
		field = section.option(form.Flag, 'ipv6', _('Enable IPv6'));
		field.description = _('Enable IPv6 networking');

		// Internal
		field = section.option(form.Flag, 'internal', _('Internal Network'));
		field.description = _('Restrict external access to the network');

		// OpenWrt Integration
		field = section.option(form.Flag, 'setup_openwrt', _('Setup OpenWrt Integration'));
		field.description = _(
			'Automatically configure OpenWrt network interface, bridge, and firewall zone. <strong>Highly recommended</strong> for proper container networking on OpenWrt.'
		);

		// Bridge Name
		field = section.option(form.Value, 'bridge_name', _('Bridge Interface Name'));
		field.placeholder = _('Leave empty to auto-generate');
		field.optional = true;
		field.datatype = 'netdevname';
		field.depends('setup_openwrt', '1');
		field.description = _(
			'Name of the bridge interface (e.g., podman0, mynet0). Leave empty to use: &lt;network-name&gt;0. Note: If the generated name conflicts with an existing interface, OpenWrt will auto-increment it.'
		);

		// Labels
		field = section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = _('key1=value1\nkey2=value2');
		field.rows = 3;
		field.optional = true;
		field.description = _('Labels in key=value format, one per line');

		this.map.render().then((formElement) => {
			ui.showModal('', [
				formElement,
				new pui.ModalButtons({
					confirmText: _('Create'),
					onConfirm: () => this.handleCreate(),
					onCancel: () => {
						ui.hideModal();
						this.map.reset();
					}
				}).render()
			]);

			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[name="name"]');
				if (nameInput) nameInput.focus();
			});
		});
	},

	handleCreate: function () {
		const ulaPrefix = uci.get('network', 'globals', 'ula_prefix');

		this.map.save().then(() => {
			const podnetwork = this.map.data.data.network;
			const setupOpenwrt = podnetwork.setup_openwrt === '1';
			const bridgeName = podnetwork.bridge_name || (podnetwork.name + '0');

			// Validate OpenWrt integration if requested
			if (setupOpenwrt && !podnetwork.subnet) {
				pui.errorNotification(_(
					'OpenWrt integration requires subnet to be specified'));
				return;
			}

			if (!podnetwork.gateway && podnetwork.subnet) {
				const regex = new RegExp('(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.)(\\d{1,3})',
					'gm')
				podnetwork.gateway = podnetwork.subnet.replace(regex, (m, g1, g2) => g1 +
					(Number(g2) + 1)).replace(/\/\d+$/, '');
			}

			const payload = {
				name: podnetwork.name,
				driver: podnetwork.driver || 'bridge',
				network_interface: bridgeName // Set the bridge interface name for Podman
			};

			// Build IPAM config if subnet provided
			if (podnetwork.subnet) {
				payload.subnets = [{
					subnet: podnetwork.subnet
				}];
				if (podnetwork.gateway) payload.subnets[0].gateway = podnetwork.gateway;
				if (podnetwork.ip_range) payload.subnets[0].lease_range = {
					start_ip: '',
					end_ip: ''
				};
			}

			payload.ipv6_enabled = false;
			if (podnetwork.ipv6 === '1') {
				const ipv6obj = ipv6.deriveUlaFromIpv4(podnetwork.subnet, ulaPrefix);

				podnetwork.ipv6subnet = ipv6obj.ipv6subnet;
				podnetwork.ipv6gateway = ipv6obj.ipv6gateway;

				payload.ipv6_enabled = true;

				if (podnetwork.subnet) {
					payload.subnets.push({
						subnet: ipv6obj.ipv6subnet
					});
					if (podnetwork.gateway) payload.subnets[1].gateway = ipv6obj
						.ipv6gateway;
					// if (podnetwork.ip_range) payload.subnets[1].lease_range = { start_ip: '', end_ip: '' };
				}
			}

			payload.internal = podnetwork.internal === '1';

			// Parse labels
			if (podnetwork.labels) {
				payload.labels = {};
				podnetwork.labels.split('\n').forEach((line) => {
					const parts = line.split('=');
					if (parts.length >= 2) {
						const key = parts[0].trim();
						const value = parts.slice(1).join('=').trim();
						if (key) payload.labels[key] = value;
					}
				});
			}

			ui.hideModal();
			this.map.reset();

			pui.showSpinningModal(_('Creating Network'), _('Creating network...'));

			// Create Podman network first
			podmanRPC.network.create(JSON.stringify(payload)).then((result) => {
				// Check for various error formats
				if (result && result.error) {
					ui.hideModal();
					pui.errorNotification(_('Failed to create network: %s')
						.format(result.error));
					return Promise.reject(new Error(
						'Podman network creation failed'));
				}
				if (result && result.message && result.response >= 400) {
					ui.hideModal();
					pui.errorNotification(_('Failed to create network: %s')
						.format(result.message));
					return Promise.reject(new Error(
						'Podman network creation failed'));
				}
				if (result && result.cause) {
					ui.hideModal();
					pui.errorNotification(_('Failed to create network: %s')
						.format(result.cause));
					return Promise.reject(new Error(
						'Podman network creation failed'));
				}

				// If OpenWrt integration requested, set it up
				if (setupOpenwrt) {
					ui.hideModal();
					pui.showSpinningModal(_('Creating Network'), _(
						'Setting up OpenWrt integration...'));

					return openwrtNetwork.createIntegration(podnetwork.name, {
						bridgeName: bridgeName,
						subnet: podnetwork.subnet,
						gateway: podnetwork.gateway,
						ipv6subnet: podnetwork.ipv6subnet || null,
						ipv6gateway: podnetwork.ipv6gateway || null,
					}).then(() => {
						return {
							podmanCreated: true,
							openwrtCreated: true
						};
					}).catch((err) => {
						// Podman network created, but OpenWrt integration failed
						return {
							podmanCreated: true,
							openwrtCreated: false,
							openwrtError: err.message
						};
					});
				} else {
					return {
						podmanCreated: true,
						openwrtCreated: false
					};
				}
			}).then((status) => {
				ui.hideModal();

				if (status.podmanCreated && status.openwrtCreated) {
					pui.successTimeNotification(_(
						'Network and OpenWrt integration created successfully'
					));
				} else if (status.podmanCreated && !status.openwrtCreated &&
					status.openwrtError) {
					pui.warningNotification(_(
						'Network created but OpenWrt integration failed: %s. You may need to configure OpenWrt manually.'
					).format(status.openwrtError));
				} else if (status.podmanCreated) {
					pui.successTimeNotification(_(
						'Network created successfully'));
				}

				this.submit();
			}).catch((err) => {
				ui.hideModal();
				if (err.message !== 'Podman network creation failed') {
					pui.errorNotification(_('Failed to create network: %s')
						.format(err.message));
				}
			});
		}).catch(() => {});
	},

	submit: () => {},
});

const FormPod = baseclass.extend({
	map: null,
	data: {
		pod: {
			name: null,
			hostname: null,
			ports: null,
			labels: null
		}
	},
	render: function () {
		this.map = new form.JSONMap(this.data, _('Create Pod'), '');
		const section = this.map.section(form.NamedSection, 'pod', 'pod');
		let field;

		// Pod Name
		field = section.option(form.Value, 'name', _('Pod Name'));
		field.placeholder = _('my-pod');
		field.datatype = 'maxlength(253)';
		field.description = _('Name for the pod');

		// Hostname
		field = section.option(form.Value, 'hostname', _('Hostname'));
		field.placeholder = _('pod-hostname');
		field.optional = true;
		field.datatype = 'hostname';
		field.description = _('Hostname to assign to the pod');

		// Port Mappings
		field = section.option(form.TextValue, 'ports', _('Port Mappings'));
		field.placeholder = _('8080:80\n8443:443');
		field.rows = 4;
		field.optional = true;
		field.description = _('Publish ports, one per line (host:container format)');

		// Labels
		field = section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = _('key1=value1\nkey2=value2');
		field.rows = 3;
		field.optional = true;
		field.description = _('Labels in key=value format, one per line');

		this.map.render().then((formElement) => {
			ui.showModal('', [
				formElement,
				new pui.ModalButtons({
					confirmText: _('Create'),
					onConfirm: () => this.handleCreate(),
					onCancel: () => {
						ui.hideModal();
						this.map.reset();
					}
				}).render()
			]);

			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[name="name"]');
				if (nameInput) nameInput.focus();
			});
		});
	},

	handleCreate: function () {
		this.map.save().then(() => {
			const pod = this.map.data.data.pod;
			const payload = {
				name: pod.name
			};

			if (pod.hostname) payload.hostname = pod.hostname;

			// Parse port mappings
			if (pod.ports) {
				payload.portmappings = [];
				pod.ports.split('\n').forEach((line) => {
					line = line.trim();
					if (!line) return;
					const parts = line.split(':');
					if (parts.length === 2) {
						const hostPort = parseInt(parts[0].trim(), 10);
						const containerPort = parseInt(parts[1].trim(), 10);
						if (!isNaN(hostPort) && !isNaN(containerPort)) {
							payload.portmappings.push({
								host_port: hostPort,
								container_port: containerPort,
								protocol: 'tcp'
							});
						}
					}
				});
			}

			// Parse labels
			if (pod.labels) {
				payload.labels = {};
				pod.labels.split('\n').forEach((line) => {
					const parts = line.split('=');
					if (parts.length >= 2) {
						const key = parts[0].trim();
						const value = parts.slice(1).join('=').trim();
						if (key) payload.labels[key] = value;
					}
				});
			}

			ui.hideModal();
			this.map.reset();

			pui.showSpinningModal(_('Creating Pod'), _('Creating pod...'));

			podmanRPC.pod.create(JSON.stringify(payload)).then((result) => {
				ui.hideModal();
				if (result && result.error) {
					pui.errorNotification(_('Failed to create pod: %s').format(
						result.error));
					return;
				}
				pui.successTimeNotification(_('Pod created successfully'));

				this.submit();
			}).catch((err) => {
				ui.hideModal();
				pui.errorNotification(_('Failed to create pod: %s').format(err
					.message));
			});
		}).catch(() => {});
	},

	submit: () => {},
});

const FormSecret = baseclass.extend({
	__name__: 'FormSecret',
	map: null,
	data: {
		secret: {
			name: null,
			data: null
		}
	},

	/**
	 * Render the secret creation modal
	 */
	render: function () {
		let field;

		this.map = new form.JSONMap(this.data, _('Create Secret'), '');
		const section = this.map.section(form.NamedSection, 'secret', 'secret');

		// Secret Name
		field = section.option(form.Value, 'name', _('Secret Name'));
		field.placeholder = _('my-secret');
		field.datatype = 'rangelength(1,253)';
		field.validate = (_section_id, value) => {
			if (!/^[a-zA-Z0-9_\-]+$/.test(value)) {
				return _(
					'Secret name can only contain letters, numbers, underscores, and hyphens'
				);
			}
			return true;
		};
		field.description = _(
			'1-253 characters: letters, numbers, underscore (_), hyphen (-) only');

		// Secret Data
		field = section.option(form.TextValue, 'data', _('Secret Data'));
		field.placeholder = _('Enter secret data (password, token, key, etc.)');
		field.rows = 6;
		field.datatype = 'minlength(1)';
		field.description = _('The sensitive data to store securely');

		this.map.render().then((formElement) => {
			const modalContent = [
				formElement,

				// Security Notice
				E('div', {
					'class': 'cbi-section'
				}, [
					E('div', {
							'style': 'background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; border-radius: 4px; margin-top: 10px;'
						},
						[
							E('strong', {}, _('Security Notice:')),
							E('ul', {
								'style': 'margin: 10px 0 0 20px;'
							}, [
								E('li', {}, _(
									'Secret data is stored encrypted')),
								E('li', {}, _(
									'Once created, secret data cannot be viewed or retrieved'
								)),
								E('li', {}, _(
									'Secrets can only be used by containers, not displayed'
								)),
								E('li', {}, _(
									'To update a secret, delete and recreate it'
								))
							])
						])
				]),

				// Modal buttons
				new pui.ModalButtons({
					confirmText: _('Create'),
					onConfirm: () => this.handleCreate(),
					onCancel: () => {
						ui.hideModal();
						this.map.reset();
					}
				}).render()
			];

			ui.showModal('', modalContent);

			// Focus on name input
			requestAnimationFrame(() => {
				const nameInput = document.querySelector(
					'input[data-name="name"]');

				if (nameInput) {
					nameInput.focus();
				}
			});
		});
	},

	/**
	 * Handle secret creation
	 */
	handleCreate: function () {
		// Parse and validate the form
		this.map.save().then(() => {
			// Get the form data
			const secretName = this.map.data.data.secret.name;
			const secretData = this.map.data.data.secret.data;

			// Additional validation already done by form validators
			if (!secretName || !secretData) {
				return;
			}

			ui.hideModal();
			this.map.reset();

			pui.showSpinningModal(_('Creating Secret'), _('Creating secret...'));

			podmanRPC.secret.create(secretName, secretData).then((result) => {
				ui.hideModal();

				// Check for various error formats
				if (result && result.error) {
					pui.errorNotification(_('Failed to create secret: %s').format(
						result.error));
					return;
				}
				if (result && result.message && result.response >= 400) {
					pui.errorNotification(_('Failed to create secret: %s').format(
						result.message));
					return;
				}
				if (result && result.cause) {
					pui.errorNotification(_('Failed to create secret: %s').format(
						result.cause));
					return;
				}

				pui.successTimeNotification(_('Secret created successfully'));

				this.submit();
			}).catch((err) => {
				ui.hideModal();
				let errorMsg = err.message || err.toString();
				// Try to parse JSON error if present
				try {
					if (typeof err === 'string' && err.indexOf('{') >= 0) {
						const jsonError = JSON.parse(err.substring(err.indexOf(
							'{')));
						errorMsg = jsonError.message || jsonError.cause ||
							errorMsg;
					}
				} catch (e) {
					// Ignore parse errors
				}
				pui.errorNotification(_('Failed to create secret: %s').format(
					errorMsg));
			});
		}).catch((err) => {
			// Validation failed - errors are already shown by the form
		});
	},

	submit: () => {},
});

/**
 * 
 */
const FormVolume = baseclass.extend({
	__name__: 'FormVolume',
	map: null,
	data: {
		volume: {
			name: null,
			driver: 'local',
			options: null,
			labels: null
		}
	},

	render: function () {
		let field;

		this.map = new form.JSONMap(this.data, _('Create Volume'), '');
		const section = this.map.section(form.NamedSection, 'volume', 'volume');

		// Volume Name
		field = section.option(form.Value, 'name', _('Volume Name'));
		field.placeholder = _('my-volume (optional)');
		field.optional = true;
		field.datatype = 'maxlength(253)';
		field.description = _('Volume name. Leave empty to auto-generate.');

		// Driver
		field = section.option(form.ListValue, 'driver', _('Driver'));
		field.value('local', 'local');
		field.value('image', 'image');
		field.description = _('Volume driver to use');

		// Mount Options
		field = section.option(form.Value, 'options', _('Mount Options'));
		field.placeholder = _('type=tmpfs,device=tmpfs,o=size=100m');
		field.optional = true;
		field.description = _(
			'Driver-specific options (comma-separated, e.g., type=tmpfs,o=size=100m)');

		// Labels
		field = section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = _('key1=value1\nkey2=value2');
		field.rows = 3;
		field.optional = true;
		field.description = _('Labels in key=value format, one per line');

		this.map.render().then((formElement) => {
			ui.showModal('', [
				formElement,
				new pui.ModalButtons({
					confirmText: _('Create'),
					onConfirm: () => this.handleCreate(),
					onCancel: () => {
						ui.hideModal();
						this.map.reset();
					}
				}).render()
			]);

			requestAnimationFrame(() => {
				const nameInput = document.querySelector('input[name="name"]');
				if (nameInput) nameInput.focus();
			});
		});
	},

	handleCreate: function () {
		this.map.save().then(() => {
			const volume = this.map.data.data.volume;
			const payload = {
				Name: volume.name || ''
			};

			if (volume.driver) payload.Driver = volume.driver;

			// Parse options
			if (volume.options) {
				payload.Options = {};
				volume.options.split(',').forEach((opt) => {
					const parts = opt.split('=');
					if (parts.length === 2) {
						payload.Options[parts[0].trim()] = parts[1].trim();
					}
				});
			}

			// Parse labels
			if (volume.labels) {
				payload.Labels = {};
				volume.labels.split('\n').forEach((line) => {
					const parts = line.split('=');
					if (parts.length >= 2) {
						const key = parts[0].trim();
						const value = parts.slice(1).join('=').trim();
						if (key) payload.Labels[key] = value;
					}
				});
			}

			ui.hideModal();
			this.map.reset();

			pui.showSpinningModal(_('Creating Volume'), _('Creating volume...'));

			podmanRPC.volume.create(JSON.stringify(payload)).then((result) => {
				ui.hideModal();
				if (result && result.error) {
					pui.errorNotification(_('Failed to create volume: %s').format(
						result.error));
					return;
				}
				pui.successTimeNotification(_('Volume created successfully'));
				this.submit();
			}).catch((err) => {
				ui.hideModal();
				pui.errorNotification(_('Failed to create volume: %s').format(err
					.message));
			});
		}).catch(() => {});
	},

	submit: () => {},
});

/**
 * Form component for container resource editing using LuCI form API
 * @class FormResourceEditor
 * @description Provides inline resource limit editing for container detail view
 *
 * @example
 * // In container.js renderResourcesTab()
 * new pform.ResourceEditor().render(this.containerId, this.containerData).then((rendered) => {
 *     document.getElementById('tab-resources-content').appendChild(rendered);
 * });
 */
const FormResourceEditor = baseclass.extend({
	map: null,
	containerId: null,

	/**
	 * Render the resource editor form
	 * @param {string} containerId - Container ID
	 * @param {Object} containerData - Container inspect data
	 * @returns {Promise<HTMLElement>} Rendered form element
	 */
	render: function (containerId, containerData) {
		this.containerId = containerId;
		const hostConfig = containerData.HostConfig || {};

		// Extract current resource values
		const data = {
			resources: {
				cpuLimit: hostConfig.CpuQuota > 0 ? (hostConfig.CpuQuota / 100000).toFixed(
					2) : '',
				cpuShares: hostConfig.CpuShares || '',
				memory: hostConfig.Memory > 0 ? utils.formatBytes(hostConfig.Memory, 0) : '',
				memorySwap: hostConfig.MemorySwap > 0 ? utils.formatBytes(hostConfig
					.MemorySwap, 0) : '',
				blkioWeight: hostConfig.BlkioWeight || ''
			}
		};

		this.map = new form.JSONMap(data, _('Resource Limits'));
		const section = this.map.section(form.NamedSection, 'resources', 'resources');

		let field;

		// CPU Limit
		field = section.option(form.Value, 'cpuLimit', _('CPU Limit'));
		field.datatype = 'ufloat';
		field.placeholder = '0.5, 1.0, 2.0';
		field.optional = true;
		field.description = _('Number of CPUs (e.g., 0.5, 1.0, 2.0). Leave empty for unlimited.');

		// CPU Shares
		field = section.option(form.Value, 'cpuShares', _('CPU Shares Weight'));
		field.datatype = 'uinteger';
		field.placeholder = '1024';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (value && (parseInt(value) < 0 || parseInt(value) > 262144)) {
				return _('Must be between 0 and 262144');
			}
			return true;
		};
		field.description = _('CPU shares (relative weight), default is 1024. 0 = use default.');

		// Memory Limit
		field = section.option(form.Value, 'memory', _('Memory Limit'));
		field.placeholder = '512m, 1g, 2g';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (!/^\d+(?:\.\d+)?\s*[kmg]?b?$/i.test(value)) {
				return _('Invalid format. Use: 512m, 1g, etc.');
			}
			return true;
		};
		field.description = _('Memory limit (e.g., 512m, 1g, 2g). Leave empty for unlimited.');

		// Memory + Swap Limit
		field = section.option(form.Value, 'memorySwap', _('Memory + Swap Limit'));
		field.placeholder = '1g, 2g, -1';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (!value) return true;
			if (value === '-1') return true;
			if (!/^\d+(?:\.\d+)?\s*[kmg]?b?$/i.test(value)) {
				return _('Invalid format. Use: 1g, 2g, or -1 for unlimited swap');
			}
			return true;
		};
		field.description = _(
			'Total memory limit (memory + swap). -1 for unlimited swap. Leave empty for unlimited.'
		);

		// Block IO Weight
		field = section.option(form.Value, 'blkioWeight', _('Block IO Weight'));
		field.datatype = 'uinteger';
		field.placeholder = '500';
		field.optional = true;
		field.validate = (_section_id, value) => {
			if (value && (parseInt(value) < 10 || parseInt(value) > 1000) && parseInt(
					value) !== 0) {
				return _('Must be 0 or between 10 and 1000');
			}
			return true;
		};
		field.description = _('Block IO weight (relative weight), 10-1000. 0 = use default.');

		// Update button
		field = section.option(form.Button, '_update', ' ');
		field.inputtitle = _('Update Resources');
		field.inputstyle = 'save';
		field.onclick = () => this.handleUpdate();

		return this.map.render();
	},

	/**
	 * Handle resource update
	 */
	handleUpdate: function () {
		this.map.save().then(() => {
			const resources = this.map.data.data.resources;

			// Parse memory values
			const memory = utils.parseMemory(resources.memory, true);
			const memorySwap = resources.memorySwap === '-1' ? -1 : utils.parseMemory(
				resources.memorySwap, true);

			// Validate
			if (memory === null && resources.memory) {
				pui.errorNotification(_('Invalid memory format. Use: 512m, 1g, etc.'));
				return;
			}
			if (memorySwap === null && resources.memorySwap && resources.memorySwap !==
				'-1') {
				pui.errorNotification(_(
					'Invalid memory swap format. Use: 512m, 1g, -1, etc.'));
				return;
			}

			// Build update data according to UpdateEntities schema
			const updateData = {};

			// CPU configuration
			updateData.cpu = {};
			if (resources.cpuLimit) {
				const period = 100000;
				updateData.cpu.quota = Math.floor(parseFloat(resources.cpuLimit) *
					period);
				updateData.cpu.period = period;
			} else {
				updateData.cpu.quota = 0;
				updateData.cpu.period = 0;
			}
			updateData.cpu.shares = parseInt(resources.cpuShares) || 0;

			// Memory configuration
			updateData.memory = {};
			updateData.memory.limit = memory > 0 ? memory : 0;
			if (memorySwap !== 0) {
				updateData.memory.swap = memorySwap;
			} else {
				updateData.memory.swap = 0;
			}

			// Block IO configuration
			updateData.blockIO = {
				weight: parseInt(resources.blkioWeight) || 0
			};

			pui.showSpinningModal(_('Updating Resources'), _(
				'Updating container resources...'));

			podmanRPC.container.update(this.containerId, JSON.stringify(updateData)).then(
				(result) => {
					ui.hideModal();
					if (result && result.error) {
						pui.errorNotification(_('Failed to update resources: %s')
							.format(result.error));
					} else {
						pui.successTimeNotification(_(
							'Resources updated successfully'));
						// Store current tab before reload
						session.setLocalData('podman_active_tab', 'resources');
						window.location.reload();
					}
				}).catch((err) => {
				ui.hideModal();
				pui.errorNotification(_('Failed to update resources: %s').format(
					err.message));
			});
		}).catch(() => {});
	}
});

/**
 * Form component for network connection using LuCI form API
 * @class FormNetworkConnect
 * @description Provides network connection UI for container detail view
 *
 * @example
 * // In container.js createNetworkConnectRow()
 * new pform.NetworkConnect().render(this.containerId, this.networksData, () => {
 *     window.location.reload();
 * });
 */
const FormNetworkConnect = baseclass.extend({
	map: null,
	containerId: null,

	/**
	 * Render the network connect form
	 * @param {string} containerId - Container ID
	 * @param {Array} networks - Available networks
	 * @param {Function} onSuccess - Success callback
	 * @returns {Promise<HTMLElement>} Rendered form element
	 */
	render: function (containerId, networks, onSuccess) {
		this.containerId = containerId;
		this.onSuccess = onSuccess;

		const data = {
			network: {
				name: '',
				ip: ''
			}
		};

		this.map = new form.JSONMap(data, '');
		const section = this.map.section(form.NamedSection, 'network', 'network');
		section.anonymous = true;
		section.addremove = false;

		let field;

		// Network selection
		field = section.option(form.ListValue, 'name', _('Connect to Network'));
		field.value('', _('-- Select Network --'));
		if (networks && Array.isArray(networks)) {
			networks.forEach((net) => {
				const name = net.Name || net.name;
				if (name && name !== 'none' && name !== 'host') {
					field.value(name, name);
				}
			});
		}

		// Optional static IP
		field = section.option(form.Value, 'ip', _('Static IP (Optional)'));
		field.datatype = 'ip4addr';
		field.optional = true;
		field.placeholder = '192.168.1.100';
		field.description = _('Leave empty for automatic IP assignment');

		// Connect button
		field = section.option(form.Button, '_connect', ' ');
		field.inputtitle = _('Connect');
		field.inputstyle = 'positive';
		field.onclick = () => this.handleConnect();

		return this.map.render();
	},

	/**
	 * Handle network connection
	 */
	handleConnect: function () {
		this.map.save().then(() => {
			const networkData = this.map.data.data.network;

			if (!networkData.name) {
				pui.warningNotification(_('Please select a network'));
				return;
			}

			pui.showSpinningModal(_('Connecting to Network'), _(
				'Connecting container to network...'));

			// Build params according to Podman API NetworkConnectOptions schema
			const params = {
				container: this.containerId
			};
			if (networkData.ip) {
				params.static_ips = [networkData.ip];
			}

			podmanRPC.network.connect(networkData.name, JSON.stringify(params)).then((
				result) => {
				ui.hideModal();
				if (result && result.error) {
					pui.errorNotification(_('Failed to connect to network: %s')
						.format(result.error));
				} else {
					pui.successTimeNotification(_(
						'Connected to network successfully'));
					if (this.onSuccess) this.onSuccess();
				}
			}).catch((err) => {
				ui.hideModal();
				pui.errorNotification(_('Failed to connect to network: %s')
					.format(err.message));
			});
		}).catch(() => {});
	}
});

/**
 * Generic editable field component using LuCI form API
 * @class FormEditableField
 * @description Provides inline editing for single values
 *
 * @example
 * // In container.js createEditableRow()
 * new pform.EditableField().render({
 *     title: _('Container Name'),
 *     value: 'my-container',
 *     datatype: 'maxlength(253)',
 *     onUpdate: (newValue) => this.handleUpdateName(newValue)
 * });
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
	render: function (options) {
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

		// Determine field type
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
			// Default: text input
			field = section.option(form.Value, 'value', options.title);
			if (options.placeholder) field.placeholder = options.placeholder;
		}

		if (options.datatype) field.datatype = options.datatype;
		if (options.description) field.description = options.description;

		// Update button
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

const FormSelectDummyValue = form.DummyValue.extend({
	cfgvalue: function (sectionId) {
		return new ui.Checkbox(0, {
			hiddenname: sectionId
		}).render();
	}
});

const FormDataDummyValue = form.DummyValue.extend({
	containerProperty: '',
	cfgdefault: _('Unknown'),
	cfgtitle: null,
	cfgformatter: (cfg) => cfg,
	cfgvalue: function (sectionId) {
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

const FormLinkDataDummyValue = form.DummyValue.extend({
	text: (_data) => '',
	click: (_data) => null,
	linktitle: (_data) => null,
	cfgvalue: function (sectionId) {
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

const PodmanForm = baseclass.extend({
	Container: FormContainer,
	Image: FormImage,
	Network: FormNetwork,
	Pod: FormPod,
	Secret: FormSecret,
	Volume: FormVolume,
	ResourceEditor: FormResourceEditor,
	NetworkConnect: FormNetworkConnect,
	EditableField: FormEditableField,
	field: {
		DataDummyValue: FormDataDummyValue,
		LinkDataDummyValue: FormLinkDataDummyValue,
		SelectDummyValue: FormSelectDummyValue,
	},
});

return PodmanForm;
