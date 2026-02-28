'use strict';

'require baseclass';
'require form';
'require ui';

'require podman.ui as podmanUI';
'require podman.rpc as podmanRPC';
'require podman.run-command-parser as RunCommandParser';

return baseclass.extend({
	init: baseclass.extend({
		__name__: 'FormContainer',
		map: null,

		/**
		 * Load dependencies and display container creation modal
		 */
		render: function () {
			Promise.all([
				podmanRPC.image.list(),
				podmanRPC.network.list()
			]).then((results) => {
				const images = results[0] || [];
				const networks = results[1] || [];
				this.showModal(images, networks);
			}).catch((err) => {
				podmanUI.errorNotification(_('Failed to load data: %s').format(err.message));
			});
		},

		/**
		 * Display container creation modal with form fields
		 * @param {Array} images - Available images from RPC
		 * @param {Array} networks - Available networks from RPC
		 */
		showModal: function (images, networks) {
			// Create data as instance property (not prototype)
			this.data = {
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
					user: null,
					groups: null,
					expose: null,
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
			};

			this.map = new form.JSONMap(this.data, _('Create %s').format(_('Container')), '');

			const section = this.map.section(form.NamedSection, 'container', 'container');
			let field;
			field = section.option(form.Value, 'name', _('Container Name'));
			field.placeholder = 'my-container';
			field.optional = true;
			field.datatype = 'maxlength(253)';
			field.description = _('Leave empty to auto-generate');
			field = section.option(form.ListValue, 'image', _('Image'));
			field.value('', _('-- Select %s --').format(_('Image')));
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

			field = section.option(form.Value, 'command', _('Command'));
			field.placeholder = '/bin/sh';
			field.optional = true;
			field.description = _('Command to run (space-separated)');

			field = section.option(form.TextValue, 'ports', _('Port Mappings'));
			field.placeholder = '8080:80\n8443:443';
			field.rows = 3;
			field.optional = true;
			field.description = _('One per line, format: host:container');

			field = section.option(form.Value, 'expose', _('Expose Ports'));
			field.placeholder = '6052, 8080/udp';
			field.optional = true;
			field.description = _('Comma-separated ports to expose (e.g., 6052, 8080/udp)');

			field = section.option(form.TextValue, 'env', _('Environment Variables'));
			field.placeholder = 'VAR1=value1\nVAR2=value2';
			field.rows = 4;
			field.optional = true;
			field.description = _('One per line, format: key=value');

			field = section.option(form.TextValue, 'volumes', _('Volumes'));
			field.placeholder = '/host/path:/container/path:ro\nvolume-name:/data';
			field.rows = 4;
			field.optional = true;
			field.description = _('One per line. Format: source:destination[:options]. Options: ro, rw, Z, z');

			field = section.option(form.ListValue, 'network', _('Network'));
			field.value('bridge', 'bridge (default)');
			field.value('host', 'host');
			field.value('none', 'none');
			if (networks && Array.isArray(networks)) {
				networks.forEach((net) => {
					const name = net.Name || net.name;
					if (name && name !== 'bridge' && name !== 'host' && name !== 'none') {
						field.value(name, name);
					}
				});
			}
			field.description = _(
				'Select network for the container. User-created networks provide better isolation and DNS resolution between containers.'
			);

			field = section.option(form.ListValue, 'restart', _('Restart Policy'));
			field.value('no', _('No'));
			field.value('always', _('Always'));
			field.value('on-failure', _('On Failure'));
			field.value('unless-stopped', _('Unless Stopped'));

			field = section.option(form.Flag, 'privileged', _('Privileged Mode'));

			field = section.option(form.Flag, 'interactive', _('Interactive (-i)'));

			field = section.option(form.Flag, 'tty', _('Allocate TTY (-t)'));

			field = section.option(form.Flag, 'remove', _('Auto Remove (--rm)'));

			field = section.option(form.Flag, 'autoupdate', _('Auto-Update'));
			field.description = _(
				'Automatically update container when newer image is available. Adds label: io.containers.autoupdate=registry'
			);

			field = section.option(form.Flag, 'start', _('Start after creation'));
			field.description = _('Automatically start the container after it is created');

			field = section.option(form.Value, 'workdir', _('Working Directory'));
			field.placeholder = '/app';
			field.optional = true;

			field = section.option(form.Value, 'hostname', _('Hostname'));
			field.placeholder = 'container-host';
			field.optional = true;
			field.datatype = 'hostname';

			field = section.option(form.Value, 'user', _('User'));
			field.placeholder = '1000:1000';
			field.optional = true;
			field.description = _('User and group to run as (UID:GID)');

			field = section.option(form.Value, 'groups', _('Supplementary Groups'));
			field.placeholder = '500,1000';
			field.optional = true;
			field.description = _('Comma-separated list of supplementary group IDs');

			field = section.option(form.TextValue, 'labels', _('Labels'));
			field.placeholder = 'key1=value1\nkey2=value2';
			field.rows = 3;
			field.optional = true;
			field.description = _('One per line, format: key=value');

			field = section.option(form.Value, 'cpus', _('CPU Limit'));
			field.placeholder = '1.0';
			field.optional = true;
			field.datatype = 'ufloat';
			field.description = _('Number of CPUs (e.g., 0.5, 1.0, 2.0)');

			field = section.option(form.Value, 'memory', _('Memory Limit'));
			field.placeholder = '512m';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (!/^\d+(?:\.\d+)?\s*[kmg]?$/i.test(value)) {
					return _('Invalid format.') + ' ' + _('Use: 512m, 1g');
				}
				return true;
			};
			field.description = _('Memory limit (e.g., 512m, 1g)');

			field = section.option(form.Flag, 'enable_healthcheck', _('Enable Health Check'));
			field.description = _('Configure health check to monitor container health status');

			field = section.option(form.ListValue, 'healthcheck_type', _('Health Check Type'));
			field.depends('enable_healthcheck', '1');
			field.value('CMD', 'CMD');
			field.value('CMD-SHELL', 'CMD-SHELL');
			field.description = _('CMD runs command directly, CMD-SHELL runs command in shell');

			field = section.option(form.Value, 'healthcheck_command', _('Health Check Command'));
			field.depends('enable_healthcheck', '1');
			field.placeholder = '/bin/health-check.sh';
			field.optional = false;
			field.description = _(
				'Command to run for health check. Exit code 0 = healthy, 1 = unhealthy');

			field = section.option(form.Value, 'healthcheck_interval', _('Interval'));
			field.depends('enable_healthcheck', '1');
			field.placeholder = '30s';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
					return _('Invalid format. Use: 5s, 30s, 1m, 1h');
				}
				return true;
			};
			field.description = _('Time between health checks (e.g., 30s, 1m, 5m). Default: 30s');

			field = section.option(form.Value, 'healthcheck_timeout', _('Timeout'));
			field.depends('enable_healthcheck', '1');
			field.placeholder = '30s';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
					return _('Invalid format. Use: 5s, 10s, 30s');
				}
				return true;
			};
			field.description = _('Maximum time for health check to complete. Default: 30s');
			field = section.option(form.Value, 'healthcheck_start_period', _('Start Period'));
			field.depends('enable_healthcheck', '1');
			field.placeholder = '0s';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
					return _('Invalid format. Use: 5s, 30s, 1m, 1h');
				}
				return true;
			};
			field.description = _(
				'Grace period before health checks count toward failures. Default: 0s');
			field = section.option(form.Value, 'healthcheck_start_interval', _('Start Interval'));
			field.depends('enable_healthcheck', '1');
			field.placeholder = '5s';
			field.optional = true;
			field.validate = (_section_id, value) => {
				if (!value) return true;
				if (!/^\d+(?:\.\d+)?(ns|us|ms|s|m|h)$/.test(value)) {
					return _('Invalid format. Use: 5s, 10s, 30s');
				}
				return true;
			};
			field.description = _('Interval during start period (podman 4.8+). Default: 5s');
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
					new podmanUI.ModalButtons({
						confirmText: _('Create %s').format('').trim(),
						onConfirm: () => this.handleCreate(),
						onCancel: () => ui.hideModal()
					}).render()
				]);

				requestAnimationFrame(() => {
					const nameInput = document.querySelector('input[name="name"]');
					if (nameInput) nameInput.focus();
				});
			});
		},

		/**
		 * Parse form data and create container via RPC
		 */
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
				if (container.env) {
					spec.env = {};
					container.env.split('\n').forEach((line) => {
						const parts = line.split('=');
						if (parts.length >= 2) {
							const key = parts[0].trim();
							// Use slice().join() to preserve '=' characters in the value
							const value = parts.slice(1).join('=').trim();
							if (key) spec.env[key] = value;
						}
					});
				}
				if (container.volumes) {
					spec.mounts = [];
					spec.volumes = [];
					container.volumes.split('\n').forEach((line) => {
						const parts = line.trim().split(':');
						if (parts.length >= 2) {
							const opts = parts.length > 2 ? parts[2].split(',') : [];
							// Path contains '/' = bind mount, otherwise = named volume
							if (parts[0].indexOf('/') > -1) {
								const mount = {
									source: parts[0],
									destination: parts[1],
								};
								if (opts.includes('ro')) mount.ReadOnly = true;
								const selinux = opts.filter((o) => o === 'Z' || o === 'z');
								if (selinux.length > 0) mount.options = selinux;
								spec.mounts.push(mount);
							} else {
								const vol = {
									name: parts[0],
									dest: parts[1],
								};
								if (opts.length > 0) vol.Options = opts;
								spec.volumes.push(vol);
							}
						}
					});
				}
				if (container.network === 'host') {
					spec.netns = {
						nsmode: 'host'
					};
				} else if (container.network === 'none') {
					spec.netns = {
						nsmode: 'none'
					};
				} else if (container.network && container.network !== 'bridge') {
					spec.networks = {};
					spec.networks[container.network] = {};
				}
				if (container.restart !== 'no') spec.restart_policy = container.restart;
				if (container.privileged === '1') spec.privileged = true;
				if (container.interactive === '1') spec.stdin = true;
				if (container.tty === '1') spec.terminal = true;
				if (container.remove === '1') spec.remove = true;
				if (container.workdir) spec.work_dir = container.workdir;
				if (container.hostname) spec.hostname = container.hostname;
				if (container.user) spec.user = container.user;
				if (container.groups) {
					spec.groups = container.groups.split(',').map((g) => g.trim()).filter((g) => g);
				}
				if (container.expose) {
					spec.expose = {};
					container.expose.split(',').forEach((p) => {
						p = p.trim();
						if (!p) return;
						const parts = p.split('/');
						const port = parseInt(parts[0], 10);
						if (!isNaN(port)) spec.expose[port] = parts[1] || 'tcp';
					});
				}
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
				if (container.cpus) {
					spec.resource_limits = spec.resource_limits || {};
					spec.resource_limits.cpu = {
						quota: parseFloat(container.cpus) * 100000
					};
				}
				if (container.memory) {
					const memBytes = format.parseMemory(container.memory);
					if (memBytes > 0) {
						spec.resource_limits = spec.resource_limits || {};
						spec.resource_limits.memory = {
							limit: memBytes
						};
					}
				}
				if (container.enable_healthcheck === '1' && container.healthcheck_command) {
					const healthConfig = {
						Test: [container.healthcheck_type, container.healthcheck_command]
					};
					if (container.healthcheck_interval) {
						healthConfig.Interval = format.parseDuration(container
							.healthcheck_interval);
					}
					if (container.healthcheck_timeout) {
						healthConfig.Timeout = format.parseDuration(container
							.healthcheck_timeout);
					}
					if (container.healthcheck_start_period) {
						healthConfig.StartPeriod = format.parseDuration(container
							.healthcheck_start_period);
					}
					if (container.healthcheck_start_interval) {
						healthConfig.StartInterval = format.parseDuration(container
							.healthcheck_start_interval);
					}
					if (container.healthcheck_retries) {
						const retries = parseInt(container.healthcheck_retries, 10);
						if (!isNaN(retries)) healthConfig.Retries = retries;
					}

					spec.healthconfig = healthConfig;
				}

				ui.hideModal();
				this.map.reset();

				podmanUI.showSpinningModal(_('Creating %s').format(_('Container')), _(
					'Creating container from image %s...').format(container.image));

				podmanRPC.container.create(spec).then((result) => {
					if (result && result.error) {
						ui.hideModal();
						podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Container').toLowerCase(), result.error));
						return;
					}

					const shouldStart = container.start === '1' || container.start ===
						true || container.start === 1;
					const hasRestartPolicy = container.restart && container.restart !== 'no';
					const containerName = result.Id ? (container.name || result.Id.substring(0, 12)) : null;

					// Chain: Start (if requested) → Generate init script (if has restart policy)
					let promise = Promise.resolve();

					if (shouldStart && result && result.Id) {
						podmanUI.showSpinningModal(
							_('Starting %s').format(_('Container')),
							_('Starting %s').format(_('Container'))
						);

						promise = podmanRPC.container.start(result.Id).then((startResult) => {
							if (startResult && startResult.error) {
								podmanUI.warningNotification(_(
									'Container created but failed to start: %s'
								).format(startResult.error));
							}
							return Promise.resolve();
						}).catch((err) => {
							podmanUI.warningNotification(_(
								'Container created but failed to start: %s'
							).format(err.message));
							return Promise.resolve();
						});
					}

					// Auto-generate init script if restart policy is set
					if (hasRestartPolicy && containerName) {
						promise = promise.then(() => {
							podmanUI.showSpinningModal(
								_('Setting up auto-start'),
								_('Generating Init Script')
							);

							return podmanRPC.initScript.generate(containerName)
								.then((genResult) => {
									if (genResult && genResult.success) {
										return podmanRPC.initScript.setEnabled(containerName, true);
									}
									// Generation failed - just log warning, don't fail container creation
									console.warn('Failed to auto-generate init script:', genResult.error);
									return Promise.resolve();
								})
								.catch((err) => {
									// Auto-generation failed - just log warning, don't fail container creation
									console.warn('Failed to auto-generate init script:', err.message);
									return Promise.resolve();
								});
						});
					}

					// Final notification and cleanup
					promise.then(() => {
						ui.hideModal();
						if (shouldStart && hasRestartPolicy) {
							podmanUI.successTimeNotification(_(
								'Container created, started, and auto-start configured'));
						} else if (shouldStart) {
							podmanUI.successTimeNotification(_(
								'Container created and started successfully'));
						} else if (hasRestartPolicy) {
							podmanUI.successTimeNotification(_(
								'Container created and auto-start configured'));
						} else {
							podmanUI.successTimeNotification(_(
								'%s created successfully').format(_('Container')));
						}
						this.submit();
					});
				}).catch((err) => {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Container').toLowerCase(), err.message));
				});
			}).catch(() => { });
		},

		/**
		 * Show modal to import container from docker/podman run command
		 */
		showImportFromRunCommand: function () {
			const content = [
				E('p', {}, _('Paste a docker or podman run command below:')),
				E('textarea', {
					'id': 'run-command-input',
					'class': 'cbi-input-textarea input-full text-mono',
					'rows': 8,
					'placeholder': 'docker run -d --name my-container -p 8080:80 -e ENV_VAR=value nginx:latest'
				}),
				new podmanUI.ModalButtons({
					confirmText: _('Import'),
					onConfirm: () => {
						const input = document.getElementById('run-command-input');
						const command = input ? input.value.trim() : '';

						if (!command) {
							podmanUI.warningNotification(_('Please enter a run command'));
							return;
						}

						try {
							const spec = RunCommandParser.parse(command);
							ui.hideModal();
							this.createFromSpec(spec);
						} catch (err) {
							podmanUI.errorNotification(_('Failed to parse command: %s').format(
								err.message));
						}
					}
				}).render()
			];

			ui.showModal(_('Import from Run Command'), content);
			requestAnimationFrame(() => {
				const textarea = document.getElementById('run-command-input');
				if (textarea) textarea.focus();
			});
		},

		/**
		 * Create container from parsed run command spec
		 * @param {Object} spec - Container specification parsed from run command
		 */
		createFromSpec: function (spec) {
			podmanUI.showSpinningModal(_('Creating %s').format(_('Container')), _('Creating container from image %s...')
				.format(spec.image));

			podmanRPC.container.create(spec).then((result) => {
				if (result && result.error) {
					ui.hideModal();
					podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Container').toLowerCase(), result.error));
					return;
				}
				// Auto-start if container needs interactive session or should auto-remove
				const shouldStart = spec.remove || spec.stdin || spec.terminal || spec.detach;

				if (shouldStart && result && result.Id) {
					podmanUI.showSpinningModal(_('Starting %s').format(_('Container')), _(
						'Starting %s...').format(_('Container').toLowerCase()));

					podmanRPC.container.start(result.Id).then((startResult) => {
						ui.hideModal();
						if (startResult && startResult.error) {
							podmanUI.warningNotification(_(
								'Container created but failed to start: %s')
								.format(startResult.error));
						} else {
							podmanUI.successTimeNotification(_(
								'Container created and started successfully'));
						}
						this.submit();
					}).catch((err) => {
						ui.hideModal();
						podmanUI.warningNotification(_(
							'Container created but failed to start: %s')
							.format(err.message));
						this.submit();
					});
				} else {
					ui.hideModal();
					podmanUI.successTimeNotification(_('%s created successfully').format(_('Container')));
					this.submit();
				}
			}).catch((err) => {
				ui.hideModal();
				podmanUI.errorNotification(_('Failed to create %s: %s').format(_('Container').toLowerCase(), err.message));
			});
		},

		submit: () => { },
	})
});
