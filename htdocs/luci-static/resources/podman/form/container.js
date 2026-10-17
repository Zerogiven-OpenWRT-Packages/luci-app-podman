'use strict';

'require baseclass';
'require form';

'require podman.form as podmanForm';
'require podman.utils as podmanUtil';
'require podman.rpc as podmanRPC';
'require podman.view as podmanView';
'require podman.model.Container as Container';

/**
 * Create podman container
 */
const PodmanFormContainer = podmanView.form.extend({
	__name__: 'Podman.Form.Container',

	makeData() {
		return {
			container: {
				name: '',
				image: '',
				pod: '',
				command: null,
				ports: null,
				env: null,
				volumes: null,
				network: 'bridge',
				restart: 'no',
				privileged: '0',
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
			}
		};
	},

	async createForm() {
		const [images, networks, pods] = await Promise.all([
			podmanRPC.images.list(),
			podmanRPC.networks.list(),
			podmanRPC.pods.list()
		]);

		let field;
		field = this.section.option(form.Value, 'name', _('Container Name'));
		field.placeholder = 'my-container';
		field.optional = true;
		field.datatype = 'maxlength(253)';
		field.description = _('Leave empty to auto-generate');

		field = this.section.option(form.ListValue, 'image', _('Image'));
		field.value('', _('-- Select %s --').format(_('Image')));
		images.forEach((img) => {
			img.getRepoTags().forEach((tag) => {
				if (tag !== '<none>:<none>') {
					field.value(tag, tag);
				}
			});
		});
		field.rmempty = false;
		field.optional = false;
		field.validate = (_section_id, value) => {
			if (!value) {
				return _('Expecting: %s').format(_('non-empty value'));
			}
			return true;
		};
		field.description = _('Container image to use');

		field = this.section.option(form.ListValue, 'pod', _('Pod'));
		field.value('', _('(none)'));
		pods.forEach((pod) => {
			const name = pod.getName();
			if (name && name !== _('Unknown')) {
				field.value(name, name);
			}
		});
		field.description = _(
			'Add the container to an existing pod. Network, hostname and port mappings come from the pod\'s infra container.'
			);

		field = this.section.option(form.Value, 'command', _('Command'));
		field.placeholder = '/bin/sh';
		field.optional = true;
		field.description = _('Command to run (space-separated)');

		field = this.section.option(form.TextValue, 'ports', _('Port Mappings'));
		field.depends('pod', '');
		field.placeholder = '8080:80\n8443:443';
		field.rows = 3;
		field.optional = true;
		field.description = _('One per line, format: host:container[/protocol]');

		field = this.section.option(form.Value, 'expose', _('Expose Ports'));
		field.depends('pod', '');
		field.placeholder = '6052, 8080/udp';
		field.optional = true;
		field.description = _('Comma-separated ports to expose (e.g., 6052, 8080/udp)');

		field = this.section.option(form.TextValue, 'env', _('Environment Variables'));
		field.placeholder = 'VAR1=value1\nVAR2=value2';
		field.rows = 4;
		field.optional = true;
		field.description = _('One per line, format: key=value');

		field = this.section.option(form.TextValue, 'volumes', _('Volumes'));
		field.placeholder = '/host/path:/container/path:ro\nvolume-name:/data';
		field.rows = 4;
		field.optional = true;
		field.description = _(
			'One per line. Format: source:destination[:options]. Options: ro, rw, Z, z');

		field = this.section.option(form.ListValue, 'network', _('Network'));
		field.depends('pod', '');
		field.value('bridge', 'bridge (default)');
		field.value('host', 'host');
		field.value('none', 'none');
		networks.forEach((net) => {
			const name = net.getName();
			if (name && name !== 'bridge' && name !== 'host' && name !== 'none') {
				field.value(name, name);
			}
		});
		field.rmempty = false;
		field.description = _(
			'Select network for the new container. User-created networks provide better isolation and DNS resolution between containers.'
		);

		field = this.section.option(form.ListValue, 'restart', _('Restart Policy'));
		field.value('no', _('No'));
		field.value('always', _('Always'));
		field.value('on-failure', _('On Failure'));
		field.value('unless-stopped', _('Unless Stopped'));

		field = this.section.option(form.Flag, 'privileged', _('Privileged Mode'));

		field = this.section.option(form.Flag, 'tty', _('Allocate TTY (-t)'));

		field = this.section.option(form.Flag, 'remove', _('Auto Remove (--rm)'));

		field = this.section.option(form.Flag, 'autoupdate', _('Auto-Update'));
		field.description = _(
			'Automatically update container when newer image is available. Adds label: io.containers.autoupdate=registry'
		);

		field = this.section.option(form.Flag, 'start', _('Start after creation'));
		field.description = _('Automatically start the container after it is created');

		field = this.section.option(form.Value, 'workdir', _('Working Directory'));
		field.placeholder = '/app';
		field.optional = true;

		field = this.section.option(form.Value, 'hostname', _('Hostname'));
		field.depends('pod', '');
		field.placeholder = 'container-host';
		field.optional = true;
		field.datatype = 'hostname';

		field = this.section.option(form.Value, 'user', _('User'));
		field.placeholder = '1000:1000';
		field.optional = true;
		field.description = _('User and group to run as (UID:GID)');

		field = this.section.option(form.Value, 'groups', _('Supplementary Groups'));
		field.placeholder = '500,1000';
		field.optional = true;
		field.description = _('Comma-separated list of supplementary group IDs');

		field = this.section.option(form.TextValue, 'labels', _('Labels'));
		field.placeholder = 'key1=value1\nkey2=value2';
		field.rows = 3;
		field.optional = true;
		field.description = _('One per line, format: key=value');

		field = this.section.option(form.Value, 'cpus', _('CPU Limit'));
		field.placeholder = '1.0';
		field.optional = true;
		field.datatype = 'ufloat';
		field.description = _('Number of CPUs (e.g., 0.5, 1.0, 2.0)');

		field = this.section.option(podmanForm.field.MemoryValue, 'memory', _('Memory Limit'));
		field.optional = true;
		field.description = _('Memory limit (e.g., 512m, 1g)');
	},

	async handleCreate() {
		if (!this.isValid()) {
			return this.scrollToInvalid();
		}

		await this.save();

		const data = this.getFieldValues();
		const spec = {
			image: data.image,
			privileged: Boolean(parseInt(data.privileged)),
			terminal: Boolean(parseInt(data.tty)),
			remove: Boolean(parseInt(data.remove)),
		};

		if (data.name) spec.name = data.name;
		if (data.pod) spec.pod = data.pod;
		if (data.command) spec.command = data.command.split(/\s+/).filter((c) => c.length > 0);

		if (!data.pod && data.ports) {
			spec.portmappings = [];
			data.ports.split('\n').forEach((line) => {
				const trimmed = line.trim();
				if (!trimmed) return;
				const parts = trimmed.split(':');
				if (parts.length === 2) {
					const hostPort = parseInt(parts[0], 10);
					const [containerPortStr, proto] = parts[1].split('/');
					const containerPort = parseInt(containerPortStr, 10);
					if (!isNaN(hostPort) && !isNaN(containerPort)) {
						spec.portmappings.push({
							host_port: hostPort,
							container_port: containerPort,
							protocol: (proto || 'tcp').toLowerCase()
						});
					}
				}
			});
		}

		const parseKeyValue = (text, target) => {
			text.split('\n').forEach((line) => {
				const parts = line.split('=');
				if (parts.length >= 2) {
					const key = parts[0].trim();
					const value = parts.slice(1).join('=').trim();
					if (key) target[key] = value;
				}
			});
		};

		if (data.env) {
			spec.env = {};
			parseKeyValue(data.env, spec.env);
		}
		if (data.volumes) {
			const mounts = [];
			const volumes = [];
			data.volumes.split('\n').forEach((line) => {
				const parts = line.trim().split(':');
				if (parts.length < 2) return;

				const opts = parts.length > 2 ? parts[2].split(',') : [];
				if (parts[0].includes('/')) {
					const mount = {
						Type: 'bind',
						Source: parts[0],
						Destination: parts[1]
					};
					if (opts.length > 0) mount.Options = opts;
					mounts.push(mount);
					return;
				}

				const vol = {
					Name: parts[0],
					Dest: parts[1]
				};
				if (opts.length > 0) vol.Options = opts;
				volumes.push(vol);
			});
			if (mounts.length > 0) spec.mounts = mounts;
			if (volumes.length > 0) spec.volumes = volumes;
		}
		if (!data.pod) {
			if (data.network === 'host') {
				spec.netns = {
					nsmode: 'host'
				};
			} else if (data.network === 'none') {
				spec.netns = {
					nsmode: 'none'
				};
			} else if (data.network && data.network !== 'bridge') {
				spec.networks = {
					[data.network]: {}
				};
			}
		}
		if (data.restart !== 'no') spec.restart_policy = data.restart;
		if (data.workdir) spec.work_dir = data.workdir;
		if (!data.pod && data.hostname) spec.hostname = data.hostname;
		if (data.user) spec.user = data.user;
		if (data.groups) {
			spec.groups = data.groups.split(',').map((g) => g.trim()).filter((g) => g);
		}
		if (!data.pod && data.expose) {
			spec.expose = {};
			data.expose.split(',').forEach((p) => {
				const trimmed = p.trim();
				if (!trimmed) return;
				const parts = trimmed.split('/');
				const port = parseInt(parts[0], 10);
				if (port >= 1 && port <= 65535)
					spec.expose[String(port)] = (parts[1] || 'tcp').toLowerCase();
			});
		}
		if (data.labels || data.autoupdate === '1') {
			spec.labels = {};
			if (data.labels) parseKeyValue(data.labels, spec.labels);
			if (data.autoupdate === '1') spec.labels['io.containers.autoupdate'] = 'registry';
		}
		if (data.cpus || data.memory) {
			spec.resource_limits = {};
			if (data.cpus) {
				spec.resource_limits.cpu = {
					quota: parseFloat(data.cpus) * 100000
				};
			}
			if (data.memory) {
				const memBytes = podmanUtil.format.parseMemory(data.memory);
				if (memBytes > 0) spec.resource_limits.memory = {
					limit: memBytes
				};
			}
		}

		const hasRestartPolicy = data.restart && data.restart !== 'no';
		const shouldStart = Boolean(parseInt(data.start));

		const createFn = async () => {
			const raw = await podmanRPC.containers.create(spec);
			const inspected = await Container.getSingleton(raw).inspect();
			const container = Container.getSingleton(inspected);

			if (hasRestartPolicy) {
				await container.generateInitScript();
				await container.enableInitScript();
			}

			if (shouldStart) await container.start();
		};

		return this.super('handleCreate', [createFn, _('Container')]);
	},
});

return baseclass.extend({
	init: PodmanFormContainer
});
