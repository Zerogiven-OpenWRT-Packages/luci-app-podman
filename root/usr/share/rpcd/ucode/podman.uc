'use strict';

// --- Table of Contents ---
//
// Infrastructure (lines 30-225)
//   Configuration, validation, HTTP client, helpers
//
// RPC Methods (line 228+)
//   Containers:   list(232) inspect(245) start(254) stop(263) restart(272)
//                 remove(281) stats(291) create(300) rename(311) update(322)
//                 healthcheck(358) top(367) logs(379) recreate(414)
//   Images:       list(464) inspect(471) remove(480) manifest_inspect(489)
//                 pull(498)
//   Networks:     list(539) inspect(546) remove(555) create(564) connect(575)
//                 disconnect(586)
//   Volumes:      list(599) inspect(606) remove(615) create(624)
//   Pods:         list(637) inspect(644) start(653) stop(662) restart(671)
//                 pause(680) unpause(689) remove(698) create(707) stats(718)
//   Secrets:      list(729) inspect(736) create(745) remove(757)
//   System:       df(768) prune(775) version(783) info(790) debug(799)
//   Init Scripts: generate(922) show(951) status(965) set_enabled(986)
//                 remove(1011)
//
// Socket wrapper (line 1035)

import { connect } from 'socket';
import { readfile, writefile, popen, stat, chmod, unlink } from 'fs';
import { cursor } from 'uci';
import { urlencode, ENCODE_FULL } from 'lucihttp';

// --- Configuration ---

const uci = cursor();
const SOCKET = uci.get('podman', 'globals', 'socket_path') || '/run/podman/podman.sock';
uci.unload('podman');

const API_BASE = '/v5.0.0/libpod';

// --- Validation ---

function validate_id(id) {
	if (!id || !match(id, /^[a-zA-Z0-9_.:-]+$/))
		return 'Invalid id format';
}

function validate_container_name(name) {
	if (!name || !match(name, /^[a-zA-Z0-9_-]+$/))
		return 'Invalid container name format';
}

function validate_resource_name(name) {
	if (!name || !match(name, /^[a-zA-Z0-9_.-]+$/))
		return 'Invalid resource name format';
}

function validate_volume_name(name) {
	if (!name || !match(name, /^[a-zA-Z0-9_.-]+$/))
		return 'Invalid volume name format';
}

function validate_image_ref(ref) {
	if (!ref || !match(ref, /^[a-zA-Z0-9_.:\/@-]+$/))
		return 'Invalid image reference';
}

function validate_query_params(query) {
	if (!query || !match(query, /^[a-zA-Z0-9=&_.,-]+$/))
		return 'Invalid query parameters';
}

const VALID_RESTART_POLICIES = { 'no': true, 'always': true, 'on-failure': true, 'unless-stopped': true };

function validate_restart_policy(policy) {
	if (policy && !(policy in VALID_RESTART_POLICIES))
		return 'Invalid restart policy';
}

function require_param(name, value) {
	if (value == null || value === ''
		|| (type(value) === 'object' && length(keys(value)) === 0))
		return `Missing required parameter: ${name}`;
}

// --- HTTP Client ---

function podman_request(method, path, body, raw) {
	let sock = connect(SOCKET);
	if (!sock)
		return { error: 'Failed to connect to Podman socket' };

	let request = `${method} ${path} HTTP/1.0\r\nHost: localhost\r\n`;
	if (body) {
		request += `Content-Type: application/json\r\nContent-Length: ${length(body)}\r\n`;
	}
	request += '\r\n';
	if (body)
		request += body;

	sock.send(request);

	// Read response headers (until \r\n\r\n separator)
	let header_buf = '';
	let body_remainder = '';
	let chunk;

	while (true) {
		chunk = sock.recv(65536);
		if (!chunk || length(chunk) === 0)
			break;

		header_buf += chunk;
		let sep = index(header_buf, '\r\n\r\n');
		if (sep >= 0) {
			body_remainder = substr(header_buf, sep + 4);
			header_buf = substr(header_buf, 0, sep);
			break;
		}
	}

	if (!header_buf) {
		sock.close();
		return { error: 'Empty response from Podman API' };
	}

	// Parse status code
	let status_match = match(header_buf, /^HTTP\/[0-9.]+ ([0-9]+)/);
	let status_code = status_match ? +status_match[1] : 0;

	// For 204 No Content (success with no body - e.g., start/stop/restart)
	if (status_code === 204) {
		sock.close();
		if (raw) return { status: 204, body: '' };
		return {};
	}

	// Parse Content-Length to know exactly how many body bytes to read
	let cl_match = match(header_buf, /[Cc]ontent-[Ll]ength:\s*([0-9]+)/);
	let content_length = cl_match ? +cl_match[1] : -1;

	// Read body
	let resp_body = body_remainder;

	if (content_length >= 0) {
		// Read exactly content_length bytes
		while (length(resp_body) < content_length) {
			chunk = sock.recv(65536);
			if (!chunk || length(chunk) === 0)
				break;
			resp_body += chunk;
		}
	} else {
		// No Content-Length — read until EOF
		while (true) {
			chunk = sock.recv(65536);
			if (!chunk || length(chunk) === 0)
				break;
			resp_body += chunk;
		}
	}

	sock.close();

	// Raw mode: return status + body without JSON parsing
	if (raw) {
		if (status_code >= 400)
			return { error: trim(resp_body || `HTTP ${status_code}`) };
		return { status: status_code, body: resp_body || '' };
	}

	// Try to parse JSON body
	if (resp_body != null && resp_body !== '') {
		let parsed = null;
		try { parsed = json(resp_body); } catch(e) {}

		if (parsed != null) {
			// Wrap arrays in { data: [...] } for frontend compatibility
			if (type(parsed) === 'array')
				return { data: parsed };
			return parsed;
		}
		// Non-JSON response (e.g., plain text error)
		if (status_code >= 400)
			return { error: trim(resp_body) };
		return { data: resp_body };
	}

	if (status_code >= 400)
		return { error: `HTTP ${status_code}` };

	return {};
}

// Helper: validate + urlencode an ID parameter
function encode_id(id) {
	return urlencode(id, ENCODE_FULL);
}

// Helper: append ?force=true if force flag is set
function add_force(path, force) {
	return (force === true || force === 1) ? `${path}?force=true` : path;
}

// Helper: build query string from boolean flags
function build_bool_query(params) {
	let parts = [];
	for (let k in params) {
		if (params[k] === true || params[k] === 1)
			push(parts, `${k}=true`);
	}
	return length(parts) ? '?' + join('&', parts) : '';
}

// --- Init Script Helpers ---

function init_script_path(name) {
	return `/etc/init.d/container-${name}`;
}

function get_start_priority() {
	let uci_ctx = cursor();
	let val = uci_ctx.get('podman', 'globals', 'init_start_priority');
	uci_ctx.unload('podman');
	if (val && match(val, /^([1-9]|[1-9][0-9]|100)$/))
		return val;
	return '100';
}

// --- RPC Methods ---

const methods = {
	// ==================== Containers ====================

	containers_list: {
		args: { query: '' },
		call: function(req) {
			let path = `${API_BASE}/containers/json`;
			if (req.args.query && req.args.query !== '') {
				let err = validate_query_params(req.args.query);
				if (err) return { error: err };
				path += `?${req.args.query}`;
			}
			return podman_request('GET', path);
		}
	},

	container_inspect: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/containers/${encode_id(req.args.id)}/json`);
		}
	},

	container_start: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/containers/${encode_id(req.args.id)}/start`);
		}
	},

	container_stop: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/containers/${encode_id(req.args.id)}/stop`);
		}
	},

	container_restart: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/containers/${encode_id(req.args.id)}/restart`);
		}
	},

	container_remove: {
		args: { id: '', force: false, depend: false },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			let query = build_bool_query({ force: req.args.force, depend: req.args.depend });
			return podman_request('DELETE', `${API_BASE}/containers/${encode_id(req.args.id)}${query}`);
		}
	},

	container_stats: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/containers/${encode_id(req.args.id)}/stats?stream=false`);
		}
	},

	container_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = (type(data) === 'string') ? data : sprintf('%J', data);
			return podman_request('POST', `${API_BASE}/containers/create`, body);
		}
	},

	container_rename: {
		args: { id: '', name: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id)
				|| require_param('name', req.args.name) || validate_container_name(req.args.name);
			if (err) return { error: err };
			let name_enc = encode_id(req.args.name);
			return podman_request('POST', `${API_BASE}/containers/${encode_id(req.args.id)}/rename?name=${name_enc}`);
		}
	},

	container_update: {
		args: { id: '', data: {} },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id)
				|| require_param('data', req.args.data);
			if (err) return { error: err };

			let data = req.args.data;
			if (type(data) === 'string')
				data = json(data);
			if (!data)
				return { error: 'Invalid JSON data' };

			let id_enc = encode_id(req.args.id);

			// Build query params for restart policy
			let query_parts = [];
			if (data.RestartPolicy) {
				let perr = validate_restart_policy(data.RestartPolicy);
				if (perr) return { error: perr };
				push(query_parts, `restartPolicy=${data.RestartPolicy}`);
			}
			if (data.RestartRetries != null)
				push(query_parts, `restartRetries=${data.RestartRetries}`);

			let query = length(query_parts) ? '?' + join('&', query_parts) : '';

			// Determine if body is needed (resource/health updates)
			let body_str = sprintf('%J', data);
			let has_body_fields = match(body_str, /(cpu|memory|blockIO|health|no_healthcheck)/i);

			return podman_request('POST', `${API_BASE}/containers/${id_enc}/update${query}`,
				has_body_fields ? body_str : '{}');
		}
	},

	container_healthcheck_run: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/containers/${encode_id(req.args.id)}/healthcheck`);
		}
	},

	container_top: {
		args: { id: '', ps_args: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			let path = `${API_BASE}/containers/${encode_id(req.args.id)}/top`;
			if (req.args.ps_args && req.args.ps_args !== '')
				path += `?ps_args=${encode_id(req.args.ps_args)}`;
			return podman_request('GET', path);
		}
	},

	container_logs: {
		args: { id: '', lines: 0, since: 0 },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };

			let path = `${API_BASE}/containers/${encode_id(req.args.id)}/logs?stdout=true&stderr=true&timestamps=true&follow=false`;
			if (req.args.lines > 0)
				path += `&tail=${req.args.lines}`;
			if (req.args.since > 0)
				path += `&since=${req.args.since}`;

			let resp = podman_request('GET', path, null, true);
			if (resp.error) return resp;

			// Parse Docker multiplexed stream format
			// Each frame: [type(1)][pad(3)][size(4 BE)][payload(size)]
			let body = resp.body;
			let output = '';
			let offset = 0;
			while (offset + 8 <= length(body)) {
				let frame_size = (ord(body, offset + 4) << 24) |
					(ord(body, offset + 5) << 16) |
					(ord(body, offset + 6) << 8) |
					ord(body, offset + 7);
				offset += 8;
				if (offset + frame_size > length(body)) break;
				output += substr(body, offset, frame_size);
				offset += frame_size;
			}

			return { logs: output };
		}
	},

	container_recreate: {
		args: { command: [] },
		call: function(req) {
			let cmd = req.args.command;
			if (!cmd || type(cmd) !== 'array' || length(cmd) < 2)
				return { error: 'Failed to parse command array' };

			let first = cmd[0];
			if (first !== 'podman' && first !== '/usr/bin/podman')
				return { error: 'Invalid command: must start with podman', details: `got: ${first}` };

			let second = cmd[1];
			if (second !== 'run' && second !== 'create')
				return { error: 'Invalid command: only run/create subcommands allowed', details: `got: ${second}` };

			if (length(cmd) > 256)
				return { error: 'Invalid command: too many arguments' };

			// Build shell script with properly escaped arguments
			let script = '#!/bin/sh\n/usr/bin/podman';
			for (let i = 1; i < length(cmd); i++) {
				let escaped = replace(cmd[i], regexp("'", "g"), "'\\''");
				script += ` '${escaped}'`;
			}
			script += '\n';

			let tp = popen('mktemp /tmp/podman_recreate_XXXXXX', 'r');
			let tmppath = tp ? trim(tp.read('all') || '') : '';
			if (tp) tp.close();
			if (!tmppath)
				return { error: 'Failed to create temp file' };

			writefile(tmppath, script);
			chmod(tmppath, 0700);

			let p = popen(`${tmppath} 2>&1`, 'r');
			let result = p ? p.read('all') : '';
			let exit_code = p ? p.close() : -1;  // null = success, int = failure

			unlink(tmppath);

			if (exit_code)
				return { error: 'Command failed', details: trim(result || ''), code: `${exit_code}` };

			return { success: true };
		}
	},

	// ==================== Images ====================

	images_list: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/images/json`);
		}
	},

	image_inspect: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_image_ref(req.args.id);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/images/${encode_id(req.args.id)}/json`);
		}
	},

	image_remove: {
		args: { id: '', force: false },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_image_ref(req.args.id);
			if (err) return { error: err };
			return podman_request('DELETE', add_force(`${API_BASE}/images/${encode_id(req.args.id)}`, req.args.force));
		}
	},

	image_manifest_inspect: {
		args: { image: '' },
		call: function(req) {
			let err = require_param('image', req.args.image) || validate_image_ref(req.args.image);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/manifests/${encode_id(req.args.image)}/json`);
		}
	},

	image_pull: {
		args: { image: '' },
		call: function(req) {
			let err = require_param('image', req.args.image) || validate_image_ref(req.args.image);
			if (err) return { error: err };

			let image_enc = urlencode(req.args.image, ENCODE_FULL);
			let resp = podman_request('POST', `${API_BASE}/images/pull?reference=${image_enc}`, null, true);
			if (resp.error) return resp;

			// Response is newline-delimited JSON: {"stream":"..."} lines
			// Last line contains {"images":[...],"id":"..."}
			let body = resp.body || '';
			let output = '';
			let images = null;
			let id = null;

			let lines = split(body, '\n');
			for (let i = 0; i < length(lines); i++) {
				let line = trim(lines[i]);
				if (line === '') continue;
				let parsed = null;
				try { parsed = json(line); } catch(e) {}
				if (!parsed) continue;

				if (parsed.stream)
					output += parsed.stream;
				if (parsed.images)
					images = parsed.images;
				if (parsed.id)
					id = parsed.id;
				if (parsed.error)
					return { error: parsed.error };
			}

			return { output: output, images: images, id: id };
		}
	},

	// ==================== Networks ====================

	networks_list: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/networks/json`);
		}
	},

	network_inspect: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/networks/${encode_id(req.args.name)}/json`);
		}
	},

	network_remove: {
		args: { name: '', force: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', add_force(`${API_BASE}/networks/${encode_id(req.args.name)}`, req.args.force));
		}
	},

	network_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = (type(data) === 'string') ? data : sprintf('%J', data);
			return podman_request('POST', `${API_BASE}/networks/create`, body);
		}
	},

	network_connect: {
		args: { name: '', data: {} },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name)
				|| require_param('data', req.args.data);
			if (err) return { error: err };
			let body = (type(req.args.data) === 'string') ? req.args.data : sprintf('%J', req.args.data);
			return podman_request('POST', `${API_BASE}/networks/${encode_id(req.args.name)}/connect`, body);
		}
	},

	network_disconnect: {
		args: { name: '', data: {} },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name)
				|| require_param('data', req.args.data);
			if (err) return { error: err };
			let body = (type(req.args.data) === 'string') ? req.args.data : sprintf('%J', req.args.data);
			return podman_request('POST', `${API_BASE}/networks/${encode_id(req.args.name)}/disconnect`, body);
		}
	},

	// ==================== Volumes ====================

	volumes_list: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/volumes/json`);
		}
	},

	volume_inspect: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_volume_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/volumes/${encode_id(req.args.name)}/json`);
		}
	},

	volume_remove: {
		args: { name: '', force: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_volume_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', add_force(`${API_BASE}/volumes/${encode_id(req.args.name)}`, req.args.force));
		}
	},

	volume_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = (type(data) === 'string') ? data : sprintf('%J', data);
			return podman_request('POST', `${API_BASE}/volumes/create`, body);
		}
	},

	// ==================== Pods ====================

	pods_list: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/pods/json`);
		}
	},

	pod_inspect: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/pods/${encode_id(req.args.name)}/json`);
		}
	},

	pod_start: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/start`);
		}
	},

	pod_stop: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/stop`);
		}
	},

	pod_restart: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/restart`);
		}
	},

	pod_pause: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/pause`);
		}
	},

	pod_unpause: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/unpause`);
		}
	},

	pod_remove: {
		args: { name: '', force: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', add_force(`${API_BASE}/pods/${encode_id(req.args.name)}`, req.args.force));
		}
	},

	pod_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = (type(data) === 'string') ? data : sprintf('%J', data);
			return podman_request('POST', `${API_BASE}/pods/create`, body);
		}
	},

	pod_stats: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/pods/stats?stream=false&namesOrIDs=${encode_id(req.args.name)}`);
		}
	},

	// ==================== Secrets ====================

	secrets_list: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/secrets/json`);
		}
	},

	secret_inspect: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/secrets/${encode_id(req.args.name)}/json`);
		}
	},

	secret_create: {
		args: { name: '', data: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name)
				|| require_param('data', req.args.data);
			if (err) return { error: err };
			let data_b64 = b64enc(req.args.data);
			let name_enc = encode_id(req.args.name);
			return podman_request('POST', `${API_BASE}/secrets/create?name=${name_enc}`, `"${data_b64}"`);
		}
	},

	secret_remove: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_resource_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', `${API_BASE}/secrets/${encode_id(req.args.name)}`);
		}
	},

	// ==================== System ====================

	system_df: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/system/df`);
		}
	},

	system_prune: {
		args: { all: false, volumes: false },
		call: function(req) {
			let query = build_bool_query({ all: req.args.all, volumes: req.args.volumes });
			return podman_request('POST', `${API_BASE}/system/prune${query}`);
		}
	},

	version: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/version`);
		}
	},

	info: {
		args: {},
		call: function() {
			return podman_request('GET', `${API_BASE}/info`);
		}
	},

	// ==================== System Debug ====================

	system_debug: {
		args: {},
		call: function() {
			let checks = [];

			// 1. Podman binary
			let podman_stat = stat('/usr/bin/podman');
			if (podman_stat) {
				let p = popen('/usr/bin/podman --version 2>/dev/null', 'r');
				let ver = p ? trim(p.read('line') || '') : '';
				if (p) p.close();
				push(checks, { name: 'podman_binary', label: 'Podman Binary', status: 'ok', detail: '/usr/bin/podman', message: ver });
			} else {
				push(checks, { name: 'podman_binary', label: 'Podman Binary', status: 'error', detail: '/usr/bin/podman', message: 'Not found or not executable' });
			}

			// 2. Podman socket exists
			let socket_stat = stat(SOCKET);
			if (socket_stat && socket_stat.type === 'socket') {
				push(checks, { name: 'podman_socket', label: 'Podman Socket', status: 'ok', detail: SOCKET, message: 'Socket file exists' });
			} else {
				push(checks, { name: 'podman_socket', label: 'Podman Socket', status: 'error', detail: SOCKET, message: 'Socket not found' });
			}

			// 3. Socket responsive (only if socket exists)
			if (socket_stat && socket_stat.type === 'socket') {
				let ping = podman_request('GET', `${API_BASE}/_ping`);
				if (ping && ping.data === 'OK') {
					push(checks, { name: 'socket_responsive', label: 'Socket Responsive', status: 'ok', detail: 'API responding', message: '' });
				} else {
					push(checks, { name: 'socket_responsive', label: 'Socket Responsive', status: 'warn', detail: 'API not responding', message: ping ? (ping.error || '') : '' });
				}
			} else {
				push(checks, { name: 'socket_responsive', label: 'Socket Responsive', status: 'error', detail: 'Skipped', message: 'Socket not available' });
			}

			// 4. ucode-mod-socket
			push(checks, { name: 'ucode_socket', label: 'ucode-mod-socket', status: 'ok', detail: 'Built-in', message: 'Available (running ucode)' });

			// 5. Init directory writable
			let init_stat = stat('/etc/init.d');
			if (init_stat && init_stat.type === 'directory') {
				// Test writability by checking we can create a temp file
				let test_path = '/etc/init.d/.podman_write_test';
				let ok = writefile(test_path, '');
				if (ok != null) {
					unlink(test_path);
					push(checks, { name: 'init_dir_writable', label: 'Init Directory', status: 'ok', detail: '/etc/init.d/', message: 'Writable' });
				} else {
					push(checks, { name: 'init_dir_writable', label: 'Init Directory', status: 'warn', detail: '/etc/init.d/', message: 'Not writable - init scripts cannot be created' });
				}
			} else {
				push(checks, { name: 'init_dir_writable', label: 'Init Directory', status: 'error', detail: '/etc/init.d/', message: 'Directory not found' });
			}

			// 6. Startup template
			let template = '/usr/share/podman/procd-startup-template.sh';
			let tmpl_stat = stat(template);
			if (tmpl_stat) {
				let content = readfile(template);
				if (content != null) {
					push(checks, { name: 'startup_template', label: 'Startup Template', status: 'ok', detail: template, message: 'Readable' });
				} else {
					push(checks, { name: 'startup_template', label: 'Startup Template', status: 'warn', detail: template, message: 'Exists but not readable' });
				}
			} else {
				push(checks, { name: 'startup_template', label: 'Startup Template', status: 'warn', detail: template, message: 'Not found - init script generation will fail' });
			}

			// 7. RPC plugin (self-check — if we're running, we exist)
			push(checks, { name: 'rpc_plugin', label: 'RPC Plugin', status: 'ok', detail: '/usr/share/rpcd/ucode/podman.uc', message: 'Running (ucode)' });

			// 8. Podman API helper
			let api_helper = '/usr/libexec/podman-api';
			let helper_stat = stat(api_helper);
			if (helper_stat) {
				if (helper_stat.perm && (helper_stat.perm.user_exec || helper_stat.perm.group_exec || helper_stat.perm.other_exec)) {
					push(checks, { name: 'podman_api_helper', label: 'Podman API Helper', status: 'ok', detail: api_helper, message: 'Executable' });
				} else {
					push(checks, { name: 'podman_api_helper', label: 'Podman API Helper', status: 'warn', detail: api_helper, message: 'Exists but not executable' });
				}
			} else {
				push(checks, { name: 'podman_api_helper', label: 'Podman API Helper', status: 'warn', detail: api_helper, message: 'Not found - volume export/import will fail' });
			}

			// 9. UCI config
			let uci_ctx = cursor();
			let socket_cfg = uci_ctx.get('podman', 'globals', 'socket_path');
			let globals_ok = uci_ctx.get('podman', 'globals');
			uci_ctx.unload('podman');
			if (globals_ok) {
				push(checks, { name: 'uci_config', label: 'UCI Config', status: 'ok', detail: 'podman.globals', message: `socket_path=${socket_cfg || 'default'}` });
			} else {
				push(checks, { name: 'uci_config', label: 'UCI Config', status: 'warn', detail: '/etc/config/podman', message: 'Config not found or not loadable' });
			}

			// 10. Containers config
			let containers_conf = '/etc/containers/containers.conf';
			let cc_stat = stat(containers_conf);
			if (cc_stat) {
				push(checks, { name: 'containers_conf', label: 'Containers Config', status: 'ok', detail: containers_conf, message: 'Readable' });
			} else {
				push(checks, { name: 'containers_conf', label: 'Containers Config', status: 'warn', detail: containers_conf, message: 'Not found - using Podman defaults' });
			}

			// 11. Network config directory
			let net_dir = '/etc/containers/networks';
			let nd_stat = stat(net_dir);
			if (nd_stat && nd_stat.type === 'directory') {
				let p = popen('ls -1 /etc/containers/networks/*.json 2>/dev/null | wc -l', 'r');
				let count = p ? trim(p.read('all') || '0') : '0';
				if (p) p.close();
				push(checks, { name: 'network_config_dir', label: 'Network Config Dir', status: 'ok', detail: net_dir, message: `${count} network(s)` });
			} else {
				push(checks, { name: 'network_config_dir', label: 'Network Config Dir', status: 'warn', detail: net_dir, message: 'Not found' });
			}

			return { checks: checks };
		}
	},

	// ==================== Init Scripts ====================

	init_script_generate: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_container_name(req.args.name);
			if (err) return { error: err };

			let name = req.args.name;
			let start_priority = get_start_priority();
			let script_name = `container-${name}`;
			let script_path = init_script_path(name);

			let template = readfile('/usr/share/podman/procd-startup-template.sh');
			if (!template)
				return { error: 'Failed to read startup template' };

			let content = replace(template, /\{name\}/g, name);
			content = replace(content, /\{start_priority\}/g, start_priority);
			content = replace(content, /\{script_name\}/g, script_name);

			let written = writefile(script_path, content);
			if (written == null)
				return { error: 'Failed to create init script' };

			chmod(script_path, 0755);

			return { success: true, path: script_path };
		}
	},

	init_script_show: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_container_name(req.args.name);
			if (err) return { error: err };

			let content = readfile(init_script_path(req.args.name));
			if (content == null)
				return { error: 'Init script not found' };

			return { content: content };
		}
	},

	init_script_status: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_container_name(req.args.name);
			if (err) return { error: err };

			let script_path = init_script_path(req.args.name);
			let exists = !!stat(script_path);
			let enabled = false;

			if (exists) {
				let p = popen(`${script_path} enabled >/dev/null 2>&1; echo $?`, 'r');
				let rc = p ? trim(p.read('all') || '') : '';
				if (p) p.close();
				enabled = (rc === '0');
			}

			return { exists: exists, enabled: enabled };
		}
	},

	init_script_set_enabled: {
		args: { name: '', enabled: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_container_name(req.args.name);
			if (err) return { error: err };

			let script_path = init_script_path(req.args.name);
			if (!stat(script_path))
				return { error: 'Init script not found. Generate it first.' };

			let action = (req.args.enabled === true || req.args.enabled === 1) ? 'enable' : 'disable';
			let p = popen(`${script_path} ${action} 2>&1; echo $?`, 'r');
			let output = p ? trim(p.read('all') || '') : '';
			if (p) p.close();

			// Last line is the exit code
			let lines = split(output, '\n');
			let rc = pop(lines);
			if (rc !== '0')
				return { error: `Failed to ${action} service` };

			return { success: true, enabled: (action === 'enable') };
		}
	},

	init_script_remove: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_container_name(req.args.name);
			if (err) return { error: err };

			let script_path = init_script_path(req.args.name);
			if (!stat(script_path))
				return { success: true, message: 'Init script does not exist' };

			// Disable before removing
			popen(`${script_path} disable >/dev/null 2>&1`, 'r')?.close();
			unlink(script_path);

			if (stat(script_path))
				return { error: 'Failed to remove init script' };

			return { success: true };
		}
	}
};

// --- Socket check wrapper ---
// Wrap all methods except system_debug with a socket availability check

const no_socket_check = { system_debug: true };

const wrapped_methods = {};
for (let name in methods) {
	let method = methods[name];
	if (no_socket_check[name]) {
		wrapped_methods[name] = method;
	} else {
		wrapped_methods[name] = {
			args: method.args,
			call: function(req) {
				let s = stat(SOCKET);
				if (!s || s.type !== 'socket')
					return { error: 'Podman socket not found or not accessible' };
				return method.call(req);
			}
		};
	}
}

return { 'podman': wrapped_methods };
