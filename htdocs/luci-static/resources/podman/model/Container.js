'use strict';

'require baseclass';

'require podman.model.Model as Model';
'require podman.model.Network as Network';
'require podman.model.Image as Image';
'require podman.constants as constants';
'require podman.utils as podmanUtil';


const InitScript = {
	generate: Model.declareRPC({
		object: 'podman',
		method: 'init_script_generate',
		params: ['name']
	}),

	show: Model.declareRPC({
		object: 'podman',
		method: 'init_script_show',
		params: ['name']
	}),

	status: Model.declareRPC({
		object: 'podman',
		method: 'init_script_status',
		params: ['name']
	}),

	setEnabled: Model.declareRPC({
		object: 'podman',
		method: 'init_script_set_enabled',
		params: ['name', 'enabled']
	}),

	remove: Model.declareRPC({
		object: 'podman',
		method: 'init_script_remove',
		params: ['name']
	})
};

const ContainerRPC = {
	inspect: Model.declareRPC({
		object: 'podman',
		method: 'container_inspect',
		params: ['id']
	}),

	update: Model.declareRPC({
		object: 'podman',
		method: 'container_update',
		params: ['id', 'data']
	}),

	remove: Model.declareRPC({
		object: 'podman',
		method: 'container_remove',
		params: ['id', 'force', 'depend']
	}),

	start: Model.declareRPC({
		object: 'podman',
		method: 'container_start',
		params: ['id']
	}),

	stop: Model.declareRPC({
		object: 'podman',
		method: 'container_stop',
		params: ['id']
	}),

	restart: Model.declareRPC({
		object: 'podman',
		method: 'container_restart',
		params: ['id']
	}),

	pause: Model.declareRPC({
		object: 'podman',
		method: 'container_pause',
		params: ['id']
	}),

	unpause: Model.declareRPC({
		object: 'podman',
		method: 'container_unpause',
		params: ['id']
	}),

	rename: Model.declareRPC({
		object: 'podman',
		method: 'container_rename',
		params: ['id', 'name']
	}),

	create: Model.declareRPC({
		object: 'podman',
		method: 'container_create',
		params: ['data']
	}),
};

const Container = Model.base.extend({
	__name__: 'Podman.Model.Container',

	getID() {
		return this.Id || '';
	},

	getName() {
		if (this.Names && Array.isArray(this.Names) && this.Names.length > 0) {
			return this.Names[0];
		}

		if (this.Names && !Array.isArray(this.Names) && this.Names !== '') {
			return this.Names;
		}

		if (this.Name) {
			return this.Name;
		}

		return _('Unknown');
	},

	getState() {
		if (typeof this.State === 'string') {
			return this.State;
		}

		return this.State?.Status || this.Status || '';
	},

	getStateBadge() {
		return E('div', {
			class: `badge ${this.getState()}`
		}, [this.getState()]);
	},

	getAutoUpdateLabel() {
		const labels = this.Config?.Labels || this.Labels;
		if (!labels) {
			return false;
		}
		return labels['io.containers.autoupdate'] || false;
	},

	getCmdString() {
		return this.Config?.Cmd ? this.Config.Cmd.join(' ') : '';
	},

	getEntrypointString() {
		return this.Config?.Entrypoint ? this.Config.Entrypoint.join(' ') : '';
	},

	getCreateCommandString() {
		return this.Config?.CreateCommand ? this.Config?.CreateCommand.join(' ') : '';
	},

	inspectToSpec(imageRef) {
		const config = this.Config || {};
		const hostConfig = this.HostConfig || {};
		const networkSettings = this.NetworkSettings || {};
		const mounts = this.Mounts || [];

		const spec = {
			image: imageRef
		};

		// Name (strip leading slash added by Podman inspect)
		if (this.Name) spec.name = this.Name.replace(/^\//, '');

		// Process
		if (config.Cmd && config.Cmd.length) spec.command = config.Cmd;
		if (config.Entrypoint && config.Entrypoint.length) spec.entrypoint = config.Entrypoint;
		if (config.Tty) spec.terminal = true;
		if (config.OpenStdin) spec.stdin = true;
		if (config.WorkingDir) spec.work_dir = config.WorkingDir;
		if (config.User) spec.user = config.User;
		if (config.Hostname) spec.hostname = config.Hostname;
		if (config.StopSignal) {
			const sigMap = {
				SIGHUP: 1,
				SIGINT: 2,
				SIGQUIT: 3,
				SIGILL: 4,
				SIGTRAP: 5,
				SIGABRT: 6,
				SIGBUS: 7,
				SIGFPE: 8,
				SIGKILL: 9,
				SIGUSR1: 10,
				SIGSEGV: 11,
				SIGUSR2: 12,
				SIGPIPE: 13,
				SIGALRM: 14,
				SIGTERM: 15,
				SIGCHLD: 17,
				SIGCONT: 18,
				SIGSTOP: 19,
				SIGTSTP: 20,
				SIGTTIN: 21,
				SIGTTOU: 22,
				SIGURG: 23,
				SIGXCPU: 24,
				SIGXFSZ: 25,
				SIGVTALRM: 26,
				SIGPROF: 27,
				SIGWINCH: 28,
				SIGIO: 29,
				SIGPWR: 30,
				SIGSYS: 31,
			};
			const sigStr = String(config.StopSignal).toUpperCase().replace(/^SIG/, '');
			const sigNum = sigMap['SIG' + sigStr] ?? parseInt(config.StopSignal, 10);
			if (sigNum > 0) spec.stop_signal = sigNum;
		}
		if (config.StopTimeout) spec.stop_timeout = config.StopTimeout;
		if (config.Healthcheck) spec.healthconfig = config.Healthcheck;

		// Environment: ["KEY=val", ...] → {KEY: "val", ...}
		if (config.Env && config.Env.length) {
			spec.env = {};
			for (const e of config.Env) {
				const idx = e.indexOf('=');
				if (idx > 0) spec.env[e.substring(0, idx)] = e.substring(idx + 1);
			}
		}

		// Labels
		if (config.Labels && Object.keys(config.Labels).length)
			spec.labels = config.Labels;

		// HostConfig
		if (hostConfig.Privileged) spec.privileged = true;
		if (hostConfig.ReadonlyRootfs) spec.read_only_filesystem = true;
		if (hostConfig.AutoRemove) spec.remove = true;
		if (hostConfig.CapAdd && hostConfig.CapAdd.length) spec.cap_add = hostConfig.CapAdd;
		if (hostConfig.CapDrop && hostConfig.CapDrop.length) spec.cap_drop = hostConfig.CapDrop;
		if (hostConfig.Dns && hostConfig.Dns.length) spec.dns_server = hostConfig.Dns;
		if (hostConfig.DnsOptions && hostConfig.DnsOptions.length) spec.dns_option = hostConfig
			.DnsOptions;
		if (hostConfig.DnsSearch && hostConfig.DnsSearch.length) spec.dns_search = hostConfig
			.DnsSearch;
		if (hostConfig.ExtraHosts && hostConfig.ExtraHosts.length) spec.hostadd = hostConfig
			.ExtraHosts;
		if (hostConfig.GroupAdd && hostConfig.GroupAdd.length) spec.groups = hostConfig.GroupAdd;
		if (hostConfig.ShmSize) spec.shm_size = hostConfig.ShmSize;
		if (hostConfig.OomScoreAdj) spec.oom_score_adj = hostConfig.OomScoreAdj;

		// Restart policy
		const rp = hostConfig.RestartPolicy;
		if (rp && rp.Name && rp.Name !== 'no') {
			spec.restart_policy = rp.Name;
			if (rp.MaximumRetryCount) spec.restart_tries = rp.MaximumRetryCount;
		}

		// Exposed ports: {"8080/tcp": {}} → {8080: "tcp"}
		const exposedPorts = config.ExposedPorts || {};
		if (Object.keys(exposedPorts).length) {
			spec.expose = {};
			for (const portProto of Object.keys(exposedPorts)) {
				const [port, proto] = portProto.split('/');
				const portNum = parseInt(port, 10);
				if (portNum > 0 && portNum <= 65535)
					spec.expose[portNum] = proto || 'tcp';
			}
		}

		// Port mappings: {"8080/tcp": [{HostIp, HostPort}]} → array
		const portBindings = hostConfig.PortBindings || {};
		if (Object.keys(portBindings).length) {
			spec.portmappings = [];
			for (const [portProto, bindings] of Object.entries(portBindings)) {
				if (!bindings || !bindings.length) continue;
				const [port, protocol] = portProto.split('/');
				const containerPort = parseInt(port, 10);
				for (const b of bindings) {
					const m = {
						container_port: containerPort,
						protocol: protocol || 'tcp'
					};
					if (b.HostPort) m.host_port = parseInt(b.HostPort, 10);
					if (b.HostIp && b.HostIp !== '0.0.0.0') m.host_ip = b.HostIp;
					spec.portmappings.push(m);
				}
			}
		}

		// Resource limits - use CFS quota/period directly (most precise)
		if (hostConfig.Memory > 0 || hostConfig.CpuQuota > 0) {
			spec.resource_limits = {};
			if (hostConfig.Memory > 0)
				spec.resource_limits.memory = {
					limit: hostConfig.Memory
				};
			if (hostConfig.CpuQuota > 0) {
				spec.resource_limits.cpu = {
					quota: hostConfig.CpuQuota
				};
				if (hostConfig.CpuPeriod > 0)
					spec.resource_limits.cpu.period = hostConfig.CpuPeriod;
			}
		}

		// Volumes and bind mounts
		const namedVols = mounts.filter(m => m.Type === 'volume');
		const bindMounts = mounts.filter(m => m.Type === 'bind');

		if (namedVols.length) {
			spec.volumes = namedVols.map(m => ({
				Name: m.Name,
				Dest: m.Destination,
				Options: m.Options || []
			}));
		}

		if (bindMounts.length) {
			spec.mounts = bindMounts.map(m => {
				const options = (m.Options || []).slice();
				if (!m.RW) options.push('ro');
				return {
					Type: 'bind',
					Source: m.Source,
					Destination: m.Destination,
					Options: options
				};
			});
		}

		// Network
		const nm = hostConfig.NetworkMode || '';
		if (nm === 'host') {
			spec.netns = {
				nsmode: 'host'
			};
		} else if (nm === 'none') {
			spec.netns = {
				nsmode: 'none'
			};
		} else {
			const nets = networkSettings.Networks || {};
			const nonDefault = Object.keys(nets).filter(n => n !== 'bridge' && n !== 'default');
			if (nonDefault.length) {
				spec.networks = {};
				for (const n of nonDefault) spec.networks[n] = {};
			}
		}

		return spec;
	},

	getWorkingDir() {
		return this.Config?.WorkingDir;
	},

	getHostname() {
		return this.Config?.Hostname;
	},

	getUser() {
		return this.Config?.User;
	},

	getInteractive() {
		return this.Config?.OpenStdin;
	},

	getPrivileged() {
		return this.HostConfig?.Privileged;
	},

	getNetworkMode() {
		return this.HostConfig?.NetworkMode;
	},

	getNetworkSettings() {
		return this.NetworkSettings || {};
	},

	getConfig() {
		return this.Config || {};
	},

	getHostConfig() {
		return this.HostConfig || {};
	},

	getTty() {
		return this.Config?.Tty;
	},

	getMounts() {
		return this.Mounts || [];
	},

	getEnvironmentVars() {
		return this.Config?.Env || [];
	},

	getPorts() {
		const ports = [];
		const networkPorts = this.getNetworkSettings().Ports || {};

		Object.keys(networkPorts).forEach((port) => {
			const [portOnly, protocol] = port.split('/');
			const portBindings = networkPorts[port] || [];

			if (portBindings.length === 0) {
				ports.push({
					string: port,
					port: portOnly,
					protocol: protocol || '',
					hostPort: null,
					hostIp: null
				});
				return;
			}

			portBindings.forEach((portBinding) => {
				const bindingString = [port];
				if (portBinding.HostIp) bindingString.push(portBinding.HostIp);
				if (portBinding.HostPort) bindingString.push(portBinding.HostPort);
				ports.push({
					string: bindingString.join(':'),
					port: portOnly,
					protocol: protocol || '',
					hostIp: portBinding.HostIp,
					hostPort: portBinding.HostPort,
				});
			});
		});

		return ports;
	},

	getImageName() {
		return (this.ImageName || this.Image).replace(/^[^\/]+\//, '').split(':')[0];
	},

	_parseImageRef() {
		const cleanUrl = this.Image.split('@')[0];
		const lastColon = cleanUrl.lastIndexOf(':');
		const lastSlash = cleanUrl.lastIndexOf('/');
		return {
			cleanUrl,
			lastColon,
			lastSlash
		};
	},

	getImageRepo() {
		const {
			cleanUrl,
			lastColon,
			lastSlash
		} = this._parseImageRef();
		return lastColon > lastSlash ? cleanUrl.substring(0, lastColon) : '';
	},

	getImageTag() {
		const {
			cleanUrl,
			lastColon,
			lastSlash
		} = this._parseImageRef();
		return lastColon > lastSlash ? cleanUrl.substring(lastColon + 1) : 'latest';
	},

	getCreated(dateFormat) {
		return dateFormat ? podmanUtil.format.date(this.Created) : this.Created;
	},

	getStartedAt(dateFormat) {
		const date = this.StartedAt || this.State?.StartedAt;
		return dateFormat ? podmanUtil.format.date(date) : date;
	},

	getRestartPolicyName() {
		if (this.HostConfig?.RestartPolicy?.Name) {
			return this.HostConfig.RestartPolicy.Name;
		}

		return 'no';
	},

	getDetailLink(text) {
		return E('a', {
			class: 'text-bold',
			href: this.getDetailUrl(),
			'data-container-id': this.getID()
		}, text || this.getID());
	},

	getDetailUrl() {
		return L.url('admin/podman/container', this.getID());
	},

	getAutoStartStatusIcon(status) {
		let text = '-';

		if (status === 'enabled') {
			text = constants.ICON.INIT_ENABLED;
		} else if (status === 'missing') {
			text = constants.ICON.INIT_MISSING;
		} else if (status === 'disabled') {
			text = constants.ICON.INIT_DISABLED;
		}

		return E('span', {
			class: `autostart-status autostart-${status || ''}`
		}, text);
	},

	isRunning() {
		const state = this.getState();
		return this.State?.Running ||
			state === 'running' ||
			state === 'starting' ||
			state === 'unhealthy';
	},

	isStopped() {
		const state = this.getState();
		return state === 'exited' || state === 'created';
	},

	isPaused() {
		return !!this.State?.Paused || this.getState() === 'paused';
	},

	async checkInitScript() {
		if (!this.HostConfig) {
			const inspectData = await this.inspect();
			if (!inspectData) return 'none';
			this.HostConfig = inspectData.HostConfig;
		}
		const hasRestartPolicy = this._hasRestartPolicy();

		if (!hasRestartPolicy) {
			return 'none';
		}

		const initStatus = await InitScript.status(this.getName());
		if (!initStatus) return 'none';

		if (initStatus.exists && initStatus.enabled) {
			return 'enabled';
		} else if (!initStatus.exists) {
			return 'missing';
		} else if (initStatus.exists && !initStatus.enabled) {
			return 'disabled';
		}

		return 'none';
	},

	async generateInitScript() {
		return InitScript.generate(this.getName());
	},

	async showInitScript() {
		return InitScript.show(this.getName());
	},

	async removeInitScript() {
		return InitScript.remove(this.getName());
	},

	async enableInitScript() {
		return InitScript.setEnabled(this.getName(), true);
	},

	async disableInitScript() {
		return InitScript.setEnabled(this.getName(), false);
	},

	_hasRestartPolicy() {
		return this.getRestartPolicyName() !== 'no';
	},

	async inspect() {
		return ContainerRPC.inspect(this.getID());
	},

	async update(data) {
		await ContainerRPC.update(this.getID(), data);

		const initScriptStatus = await this.checkInitScript();
		const policy = data.RestartPolicy;
		const hasRestartPolicy = policy !== 'no';

		if (hasRestartPolicy && (initScriptStatus === 'none' || initScriptStatus === 'missing')) {
			await this.generateInitScript();
			await this.enableInitScript();
		} else if (!hasRestartPolicy && (initScriptStatus === 'enabled' || initScriptStatus ===
				'disabled')) {
			await this.removeInitScript();
		}
	},

	async remove(force, volumes) {
		const initScriptStatus = await this.checkInitScript();
		if (initScriptStatus === 'enabled' || initScriptStatus === 'disabled') {
			await this.removeInitScript();
		}
		return ContainerRPC.remove(this.getID(), force ?? false, volumes ?? false);
	},

	async start() {
		return ContainerRPC.start(this.getID());
	},

	async stop() {
		return ContainerRPC.stop(this.getID());
	},

	async restart() {
		return ContainerRPC.restart(this.getID());
	},

	async pause() {
		return ContainerRPC.pause(this.getID());
	},

	async unpause() {
		return ContainerRPC.unpause(this.getID());
	},

	async connect(networkName, payload) {
		return Network.getSingleton({
			name: networkName
		}).connect(Object.assign({
			container: this.getID()
		}, payload));
	},

	async disconnect(networkName) {
		return Network.getSingleton({
			name: networkName
		}).disconnect({
			Container: this.getID()
		});
	},

	streamTop(onChunk, delay, psargs) {
		const params = new URLSearchParams({
			delay: String(delay || 2)
		});
		if (psargs) params.set('ps_args', psargs);
		const url = L.url('admin/podman/stream/top', this.getID()) + '?' + params;
		return this._stream(
			() => url,
			(data) => {
				if (!data.raw && !data.Error) onChunk(data);
			}
		);
	},

	streamStats(onChunk, interval) {
		const params = new URLSearchParams({
			interval: String(interval || 2)
		});
		const url = L.url('admin/podman/stream/stats', this.getID()) + '?' + params;
		return this._stream(
			() => url,
			(data) => {
				if (data.raw || data.Error || !data.Stats || data.Stats.length === 0) {
					return;
				}
				onChunk(data.Stats[0]);
			}
		);
	},

	streamLogs(onChunk, {
		tail = 100,
		since = null,
		until = null,
		follow = true
	} = {}) {
		if (!follow) {
			// Historical fetch: single request, stop after completion (no reconnect)
			let handle;
			handle = this._stream(
				() => {
					const params = new URLSearchParams();
					params.set('tail', String(tail));
					params.set('follow', 'false');
					if (since !== null) params.set('since', String(since));
					if (until !== null) params.set('until', String(until));
					return L.url('admin/podman/stream/logs', this.getID()) + '?' + params;
				},
				onChunk,
				() => handle?.stop()
			);
			return handle;
		}

		// Live stream: reconnect with since= after each disconnect
		let reconnectSince = null;
		return this._stream(
			() => {
				const params = new URLSearchParams();
				if (reconnectSince !== null) {
					// Reconnect: continue from last close, no tail (would cap new lines)
					params.set('since', String(reconnectSince));
				} else {
					// First connect: apply user params
					params.set('tail', String(tail));
					if (since !== null) params.set('since', String(since));
				}
				params.set('follow', 'true');
				if (until !== null) params.set('until', String(until));
				return L.url('admin/podman/stream/logs', this.getID()) + '?' + params;
			},
			onChunk,
			() => {
				reconnectSince = Date.now() / 1000;
			}
		);
	},

	async checkImageUpdate() {
		const findArchDigest = (manifest, arch, os) => {
			if (!manifest || !manifest.manifests) {
				return manifest.digest || null;
			}

			const entry = manifest.manifests.find((m) =>
				m.platform &&
				m.platform.architecture === arch &&
				m.platform.os === os
			);

			return entry ? entry.digest : null;
		};

		try {
			const image = await this.getImage();

			const imageRef = image.getDisplayTag() || this.Image;
			if (!imageRef || imageRef.startsWith('<none>'))
				return {
					hasUpdate: false
				};

			const localArch = image.Architecture || 'amd64';
			const localOs = image.Os || 'linux';

			const manifest = await image.inspectManifest(imageRef);

			const remoteDigest = findArchDigest(manifest, localArch, localOs);

			const repoDigests = image.RepoDigests || [];
			const hasUpdate = !!(remoteDigest && !repoDigests.some(rd => rd.includes(
				remoteDigest)));

			return {
				hasUpdate,
				remoteDigest,
			};
		} catch (err) {
			return {
				hasUpdate: false,
				error: err.message || String(err)
			};
		}
	},

	async _reinstateInitScript(status) {
		if (status !== 'enabled' && status !== 'disabled') return;
		await this.generateInitScript();
		if (status === 'enabled') await this.enableInitScript();
	},

	getUpdateSkipReason() {
		if (this.Pod)
			return _('Part of a pod ("%s")').format(this.Pod);
		const hostConfig = this.getHostConfig();
		if (hostConfig.AutoRemove)
			return _('Ephemeral (--rm flag)');
		if (hostConfig.NetworkMode?.startsWith('container:'))
			return _('Shares network with another container');
		return null;
	},

	async updateImage(onProgress) {
		const skipReason = this.getUpdateSkipReason();
		if (skipReason) throw new Error(skipReason);

		const [image, initStatus] = await Promise.all([this.getImage(), this.checkInitScript()]);

		if (!image.RepoTags?.length || image.RepoTags[0] === '<none>:<none>') {
			const ref = this.ImageName || this.Config?.Image;
			if (ref) image.RepoTags = [ref];
		}

		const imageRef = image.getDisplayTag();
		if (!imageRef || imageRef === '<none>:<none>')
			throw new Error(_('Container image has no tag - cannot update'));

		onProgress?.(_('Pulling %s').format(imageRef) + '\n');
		const oldImageId = image.getID();
		const newImageId = await image.update(onProgress);

		if (!newImageId)
			throw new Error(_('Pull did not return an image ID - pull may have failed'));

		if (newImageId === oldImageId)
			throw new Error(_('Image is already up-to-date'));

		const wasRunning = this.isRunning();
		const spec = this.inspectToSpec(newImageId);

		if (wasRunning) {
			onProgress?.('→ ' + _('Stopping container') + '\n');
			try {
				await this.stop();
			} catch (e) {
				throw new Error(_('Stop failed: %s').format(e.message || e));
			}
		}

		onProgress?.('→ ' + _('Removing container') + '\n');
		try {
			await this.remove();
		} catch (e) {
			throw new Error(_('Remove failed: %s').format(e.message || e));
		}

		onProgress?.('→ ' + _('Creating container') + '\n');
		let created;
		try {
			created = await ContainerRPC.create(spec);
		} catch (e) {
			throw new Error(_('Create failed: %s').format(e.message || e));
		}
		if (!created || created.error)
			throw new Error(_('Create failed: %s').format(created?.error || _(
				'Failed to create container')));

		if (wasRunning) {
			onProgress?.('→ ' + _('Starting container') + '\n');
			try {
				await ContainerRPC.start(created.Id);
			} catch (e) {
				throw new Error(_('Start failed: %s').format(e.message || e));
			}
		}

		onProgress?.('→ ' + _('Reinstating init script') + '\n');
		try {
			await this._reinstateInitScript(initStatus);
		} catch (e) {
			throw new Error(_('Init script reinstate failed: %s').format(e.message || e));
		}

		onProgress?.('✓ ' + _('Updated to %s').format((newImageId || '').substring(0, 12)) +
		'\n');
		return {
			oldImage: image
		};
	},

	async getImage() {
		const image = Image.getSingleton({
			Id: this.ImageID || this.Image
		});
		return Image.getSingleton(await image.inspect());
	},

	async updateName(name) {
		if (!name || name === this.getName()) return;

		await ContainerRPC.rename(this.getID(), name);

		const initScriptStatus = await this.checkInitScript();
		if (initScriptStatus === 'enabled' || initScriptStatus === 'disabled') {
			await this.removeInitScript();
		}

		if (this.Names && this.Names.length > 0) this.Names[0] = name;
		if (this.Name) this.Name = name;

		await this._reinstateInitScript(initScriptStatus);
	},
});

return baseclass.extend({
	getSingleton(container) {
		return Container.extend(container).instantiate([]);
	},
});
