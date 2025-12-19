'use strict';

'require baseclass'

'require podman.format as format';

/**
 * Converts docker/podman run commands into container creation specs
 */
return baseclass.extend({
	/**
	 * Parse a docker/podman run command into a container spec
	 * @param {string} command - The full run command
	 * @returns {Object} Container specification object
	 */
	parse: function (command) {
		if (!command || !command.trim()) {
			throw new Error('Empty command');
		}

		command = command.trim().replace(/^(docker|podman)\s+run\s+/, '');

		const spec = {
			image: null,
			name: null,
			command: null,
			portmappings: [],
			env: {},
			mounts: [],
			labels: {},
			privileged: false,
			stdin: false,
			terminal: false,
			remove: false,
			restart_policy: null,
			netns: null,
			work_dir: null,
			hostname: null,
			resource_limits: {},
			healthconfig: {}
		};

		const tokens = this.tokenize(command);
		let i = 0;

		while (i < tokens.length) {
			const token = tokens[i];

			if (!token.startsWith('-') && !spec.image) {
				spec.image = token;
				if (i + 1 < tokens.length) {
					spec.command = tokens.slice(i + 1);
				}
				break;
			}

			if (token === '-p' || token === '--publish') {
				i++;
				const portMapping = this.parsePort(tokens[i]);
				if (portMapping) spec.portmappings.push(portMapping);
			} else if (token === '-e' || token === '--env') {
				i++;
				const envPair = this.parseEnv(tokens[i]);
				if (envPair) spec.env[envPair.key] = envPair.value;
			} else if (token === '-v' || token === '--volume') {
				i++;
				const mount = this.parseVolume(tokens[i]);
				if (mount) spec.mounts.push(mount);
			} else if (token === '--name') {
				i++;
				spec.name = tokens[i];
			} else if (token === '-w' || token === '--workdir') {
				i++;
				spec.work_dir = tokens[i];
			} else if (token === '-h' || token === '--hostname') {
				i++;
				spec.hostname = tokens[i];
			} else if (token === '-l' || token === '--label') {
				i++;
				const labelPair = this.parseLabel(tokens[i]);
				if (labelPair) spec.labels[labelPair.key] = labelPair.value;
			} else if (token === '--restart') {
				i++;
				spec.restart_policy = tokens[i];
			} else if (token === '--network' || token === '--net') {
				i++;
				const network = tokens[i];
				if (network === 'host') {
					spec.netns = {
						nsmode: 'host'
					};
				} else if (network === 'none') {
					spec.netns = {
						nsmode: 'none'
					};
				}
			} else if (token === '--privileged') {
				spec.privileged = true;
			} else if (token === '-i' || token === '--interactive') {
				spec.stdin = true;
			} else if (token === '-t' || token === '--tty') {
				spec.terminal = true;
			} else if (token === '--rm') {
				spec.remove = true;
			} else if (token === '-d' || token === '--detach') {
			} else if (token === '--cpus') {
				i++;
				const cpus = parseFloat(tokens[i]);
				if (!isNaN(cpus)) {
					spec.resource_limits.cpu = {
						quota: cpus * 100000
					};
				}
			} else if (token === '-m' || token === '--memory') {
				i++;
				const memBytes = format.parseMemory(tokens[i]);
				if (memBytes > 0) {
					spec.resource_limits.memory = {
						limit: memBytes
					};
				}
			} else if (token === '--health-cmd') {
				i++;
				spec.healthconfig.Test = ['CMD-SHELL', tokens[i]];
			} else if (token === '--health-interval') {
				i++;
				spec.healthconfig.Interval = format.parseDuration(tokens[i]);
			} else if (token === '--health-timeout') {
				i++;
				spec.healthconfig.Timeout = format.parseDuration(tokens[i]);
			} else if (token === '--health-retries') {
				i++;
				const retries = parseInt(tokens[i], 10);
				if (!isNaN(retries)) {
					spec.healthconfig.Retries = retries;
				}
			} else if (token === '--health-start-period') {
				i++;
				spec.healthconfig.StartPeriod = format.parseDuration(tokens[i]);
			} else if (token === '--health-start-interval') {
				i++;
				spec.healthconfig.StartInterval = format.parseDuration(tokens[i]);
			}

			i++;
		}

		if (!spec.image) {
			throw new Error('No image specified in command');
		}

		if (Object.keys(spec.env).length === 0) delete spec.env;
		if (spec.portmappings.length === 0) delete spec.portmappings;
		if (spec.mounts.length === 0) delete spec.mounts;
		if (Object.keys(spec.labels).length === 0) delete spec.labels;
		if (Object.keys(spec.resource_limits).length === 0) delete spec.resource_limits;
		if (Object.keys(spec.healthconfig).length === 0) delete spec.healthconfig;
		if (!spec.name) delete spec.name;
		if (!spec.command || spec.command.length === 0) delete spec.command;
		if (!spec.restart_policy) delete spec.restart_policy;
		if (!spec.netns) delete spec.netns;
		if (!spec.work_dir) delete spec.work_dir;
		if (!spec.hostname) delete spec.hostname;

		return spec;
	},

	/**
	 * Tokenize command string respecting quotes
	 * @param {string} command - Command string
	 * @returns {Array<string>} Array of tokens
	 */
	tokenize: function (command) {
		const tokens = [];
		let current = '';
		let inQuote = false;
		let quoteChar = null;

		for (let i = 0; i < command.length; i++) {
			const char = command[i];

			if ((char === '"' || char === "'") && !inQuote) {
				inQuote = true;
				quoteChar = char;
			} else if (char === quoteChar && inQuote) {
				inQuote = false;
				quoteChar = null;
			} else if (char === ' ' && !inQuote) {
				if (current) {
					tokens.push(current);
					current = '';
				}
			} else {
				current += char;
			}
		}

		if (current) {
			tokens.push(current);
		}

		return tokens;
	},

	/**
	 * Parse port mapping (e.g., "8080:80" or "127.0.0.1:8080:80/tcp")
	 * @param {string} portStr - Port mapping string
	 * @returns {Object|null} Port mapping object
	 */
	parsePort: function (portStr) {
		if (!portStr) return null;

		const parts = portStr.split('/');
		const protocol = parts[1] || 'tcp';
		const portParts = parts[0].split(':');

		let hostPort, containerPort, hostIP;

		if (portParts.length === 3) {
			hostIP = portParts[0];
			hostPort = parseInt(portParts[1], 10);
			containerPort = parseInt(portParts[2], 10);
		} else if (portParts.length === 2) {
			hostPort = parseInt(portParts[0], 10);
			containerPort = parseInt(portParts[1], 10);
		} else {
			return null;
		}

		if (isNaN(hostPort) || isNaN(containerPort)) {
			return null;
		}

		const mapping = {
			host_port: hostPort,
			container_port: containerPort,
			protocol: protocol
		};

		if (hostIP) {
			mapping.host_ip = hostIP;
		}

		return mapping;
	},

	/**
	 * Parse environment variable (e.g., "KEY=value")
	 * @param {string} envStr - Environment variable string
	 * @returns {Object|null} {key, value} object
	 */
	parseEnv: function (envStr) {
		if (!envStr) return null;

		const idx = envStr.indexOf('=');
		if (idx === -1) {
			return {
				key: envStr,
				value: ''
			};
		}

		return {
			key: envStr.substring(0, idx),
			value: envStr.substring(idx + 1)
		};
	},

	/**
	 * Parse volume mount (e.g., "/host/path:/container/path" or "volume-name:/data")
	 * @param {string} volumeStr - Volume string
	 * @returns {Object|null} Mount object
	 */
	parseVolume: function (volumeStr) {
		if (!volumeStr) return null;

		const parts = volumeStr.split(':');
		if (parts.length < 2) return null;

		return {
			source: parts[0],
			destination: parts[1],
			type: 'bind'
		};
	},

	/**
	 * Parse label (e.g., "key=value")
	 * @param {string} labelStr - Label string
	 * @returns {Object|null} {key, value} object
	 */
	parseLabel: function (labelStr) {
		if (!labelStr) return null;

		const idx = labelStr.indexOf('=');
		if (idx === -1) {
			return {
				key: labelStr,
				value: ''
			};
		}

		return {
			key: labelStr.substring(0, idx),
			value: labelStr.substring(idx + 1)
		};
	},
});
