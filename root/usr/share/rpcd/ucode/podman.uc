'use strict';

// --- Table of Contents ---
//
// Infrastructure (lines 30-225)
//   Configuration, validation, HTTP client, helpers
//
// RPC Methods (line 228+)
//   Containers:   list inspect start stop restart remove stats create rename
//                 update healthcheck top
//   Images:       list inspect remove manifest_inspect pull
//   Networks:     list inspect remove create connect disconnect
//   Volumes:      list inspect remove create import
//   Pods:         list inspect start stop restart pause unpause remove create stats
//   Secrets:      list inspect create remove
//   System:       df prune version info debug
//   Init Scripts: generate show status set_enabled remove
//                 (exempt from socket check - operate on /etc/init.d/ only)
//
// Socket wrapper (end of file)

import { readfile, writefile, popen, stat, chmod, unlink, glob, access } from 'fs';
import { cursor } from 'uci';
import { urlencode, ENCODE_FULL } from 'lucihttp'; // ucode-lsp disable
import { init_enabled, init_action } from 'luci.sys'; // ucode-lsp disable
import * as podman_socket from 'luci.podman_socket'; // ucode-lsp disable
import { API_BASE } from 'luci.podman_socket'; // ucode-lsp disable
import {
	validate_id, validate_name, validate_image_ref, validate_query_params,
	validate_restart_policy, require_param, BODY_KEYS
} from 'luci.podman_validate'; // ucode-lsp disable
import {
	build_request, parse_status, parse_content_length, read_headers
} from 'luci.podman_http'; // ucode-lsp disable

// --- Configuration ---

const uci = cursor();
const _prio = uci.get('luci-podman', 'globals', 'init_start_priority');
const INIT_START_PRIORITY = (type(_prio) === 'string' && match(_prio, /^([0-9]|[1-9][0-9]|100)$/)) ? _prio : '100';
uci.unload('luci-podman');


// Validators come from luci.podman_validate (imported above).

// --- HTTP Client ---

/**
 * @param {string} method
 * @param {string} path
 * @param {string} body
 * @param {bool} raw
 */
function podman_request(method, path, body, raw) {
	let sock = podman_socket.connect();
	if (!sock)
		return { error: 'Failed to connect to Podman socket' };

	sock.send(build_request(method, path, body));

	let hdrs = read_headers(sock);
	if (!hdrs) {
		sock.close();
		return { error: 'Empty response from Podman API' };
	}
	let header_buf     = hdrs.header_buf;
	let body_remainder = hdrs.body_remainder;
	let chunk          = '';

	let status_code = parse_status(header_buf);

	// For 204 No Content (success with no body - e.g., start/stop/restart)
	if (status_code === 204) {
		sock.close();
		if (raw) return { status: 204, body: '' };
		return {};
	}

	let content_length = parse_content_length(header_buf);

	// Read body
	let resp_body = `${body_remainder}`;
	if (content_length >= 0) {
		// Read exactly content_length bytes
		while (length(resp_body) < content_length) {
			chunk = sock.recv(65536);
			if (!chunk)
				break;
			resp_body += `${chunk}`;
		}
	} else {
		// No Content-Length - read until EOF
		while (true) {
			chunk = sock.recv(65536);
			if (!chunk)
				break;
			resp_body += `${chunk}`;
		}
	}

	sock.close();

	// Raw mode: return status + body without JSON parsing
	if (raw) {
		if (status_code >= 400)
			return { error: trim(resp_body || `HTTP ${status_code}`) };
		return { status: status_code, body: resp_body };
	}

	// Try to parse JSON body
	if (resp_body !== '') {
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

/**
 * @param {string} id
 */
function encode_id(id) {
	return urlencode(id, ENCODE_FULL);
}


/**
 * @param {object} params
 */
function build_bool_query(params) {
	let parts = [];
	for (let k in params) {
		if (params[k] === true || params[k] === 1)
			push(parts, `${k}=true`);
	}
	return length(parts) ? '?' + join('&', parts) : '';
}

/** @param {any} data */
function to_json_body(data) {
	return (type(data) === 'string') ? data : sprintf('%J', data);
}

// --- Init Script Helpers ---

/**
 * @param {string} name
 */
function init_script_path(name) {
	return `/etc/init.d/container-${name}`;
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

	container_pause: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/containers/${encode_id(req.args.id)}/pause`);
		}
	},

	container_unpause: {
		args: { id: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/containers/${encode_id(req.args.id)}/unpause`);
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
			let body = to_json_body(data);
			return podman_request('POST', `${API_BASE}/containers/create`, body);
		}
	},

	container_rename: {
		args: { id: '', name: '' },
		call: function(req) {
			let err = require_param('id', req.args.id) || validate_id(req.args.id)
				|| require_param('name', req.args.name) || validate_name(req.args.name);
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
				push(query_parts, `restartRetries=${+data.RestartRetries | 0}`);

			let query = length(query_parts) ? '?' + join('&', query_parts) : '';

			// Determine if body is needed (resource/health updates)
			let body_str = sprintf('%J', data);
			let has_body_fields = false;
			for (let k in data) {
				if (k in BODY_KEYS) { has_body_fields = true; break; }
			}

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
			return podman_request('DELETE', `${API_BASE}/images/${encode_id(req.args.id)}${build_bool_query({ force: req.args.force })}`);
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
			let body = `${resp.body || ''}`;
			let output = '';
			let images = null;
			let id = null;

			let lines = split(body, '\n');
			for (let i = 0; i < length(lines); i++) {
				let raw = lines[i];
				if (type(raw) !== 'string') continue;
				let line = trim(raw);
				if (!line) continue;
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
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/networks/${encode_id(req.args.name)}/json`);
		}
	},

	network_remove: {
		args: { name: '', force: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', `${API_BASE}/networks/${encode_id(req.args.name)}${build_bool_query({ force: req.args.force })}`);
		}
	},

	network_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = to_json_body(data);
			return podman_request('POST', `${API_BASE}/networks/create`, body);
		}
	},

	network_connect: {
		args: { name: '', data: {} },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name)
				|| require_param('data', req.args.data);
			if (err) return { error: err };
			let body = to_json_body(req.args.data);
			return podman_request('POST', `${API_BASE}/networks/${encode_id(req.args.name)}/connect`, body);
		}
	},

	network_disconnect: {
		args: { name: '', data: {} },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name)
				|| require_param('data', req.args.data);
			if (err) return { error: err };
			let body = to_json_body(req.args.data);
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
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/volumes/${encode_id(req.args.name)}/json`);
		}
	},

	volume_remove: {
		args: { name: '', force: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', `${API_BASE}/volumes/${encode_id(req.args.name)}${build_bool_query({ force: req.args.force })}`);
		}
	},

	volume_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = to_json_body(data);
			return podman_request('POST', `${API_BASE}/volumes/create`, body);
		}
	},

	volume_import: {
		args: { name: '', compressed: false },
		call: function(req) {
			let name = req.args.name;
			let err = require_param('name', name) || validate_name(name);
			if (err) return { error: err };

			let filepath = '/tmp/podman-import';
			if (!stat(filepath))
				return { error: 'Upload file not found' };

			let existing = podman_request('GET', `${API_BASE}/volumes/${encode_id(name)}/json`);
			if (!existing.Name) {
				let created = podman_request('POST', `${API_BASE}/volumes/create`,
					sprintf('%J', { Name: name }));
				if (created.error) return created;
			}

			let cmd;
			if (req.args.compressed === true || req.args.compressed === 1)
				cmd = sprintf('gunzip -c "%s" | /usr/bin/podman volume import "%s" - 2>&1', filepath, name);
			else
				cmd = sprintf('/usr/bin/podman volume import "%s" "%s" 2>&1', name, filepath);

			let p = popen(cmd, 'r');
			let output = p ? trim(p.read('all') || '') : '';
			let exit_code = p ? p.close() : 1;

			unlink(filepath);

			if (exit_code)
				return { error: output || 'Import failed' };

			return {};
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
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/pods/${encode_id(req.args.name)}/json`);
		}
	},

	pod_start: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/start`);
		}
	},

	pod_stop: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/stop`);
		}
	},

	pod_kill: {
		args: { name: '', signal: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			let sig = req.args.signal || 'SIGKILL';
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/kill?signal=${sig}`);
		}
	},

	pod_restart: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/restart`);
		}
	},

	pod_pause: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/pause`);
		}
	},

	pod_unpause: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('POST', `${API_BASE}/pods/${encode_id(req.args.name)}/unpause`);
		}
	},

	pod_remove: {
		args: { name: '', force: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('DELETE', `${API_BASE}/pods/${encode_id(req.args.name)}${build_bool_query({ force: req.args.force })}`);
		}
	},

	pod_create: {
		args: { data: {} },
		call: function(req) {
			let data = req.args.data;
			let err = require_param('data', data);
			if (err) return { error: err };
			let body = to_json_body(data);
			return podman_request('POST', `${API_BASE}/pods/create`, body);
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
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };
			return podman_request('GET', `${API_BASE}/secrets/${encode_id(req.args.name)}/json`);
		}
	},

	secret_create: {
		args: { name: '', data: '', labels: {} },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name)
				|| require_param('data', req.args.data);
			if (err) return { error: err };
			let query = `?name=${encode_id(req.args.name)}`;
			let labels = req.args.labels;
			if (type(labels) === 'object' && length(labels) > 0)
				query += `&labels=${urlencode(sprintf('%J', labels), ENCODE_FULL)}`;
			return podman_request('POST', `${API_BASE}/secrets/create${query}`, `${req.args.data}`);
		}
	},

	secret_remove: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
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
				let proc = popen('/usr/bin/podman --version 2>/dev/null', 'r');
				let ver = proc ? trim(proc.read('line') || '') : '';
				if (proc) proc.close();
				push(checks, { name: 'podman_binary', label: 'Podman Binary', status: 'ok', detail: '/usr/bin/podman', message: ver });
			} else {
				push(checks, { name: 'podman_binary', label: 'Podman Binary', status: 'error', detail: '/usr/bin/podman', message: 'Not found or not executable' });
			}

			// 2. Podman socket reachable
			let dest = podman_socket.get_dest();
			let local_path = podman_socket.get_local_path();
			let socket_stat = null;
			if (!local_path) {
				push(checks, { name: 'podman_socket', label: 'Podman Socket', status: 'ok', detail: dest, message: 'Remote TCP (cannot stat)' });
			} else {
				socket_stat = stat(local_path);
				if (socket_stat && socket_stat.type === 'socket') {
					push(checks, { name: 'podman_socket', label: 'Podman Socket', status: 'ok', detail: dest, message: 'Socket file exists' });
				} else {
					push(checks, { name: 'podman_socket', label: 'Podman Socket', status: 'error', detail: dest, message: 'Socket not found' });
				}
			}

			// 3. Socket responsive
			if (podman_socket.is_remote() || (socket_stat && socket_stat.type === 'socket')) {
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

			// 7. RPC plugin (self-check - if we're running, we exist)
			push(checks, { name: 'rpc_plugin', label: 'RPC Plugin', status: 'ok', detail: '/usr/share/rpcd/ucode/podman.uc', message: 'Running (ucode)' });

			// 8. Podman API helper
			let api_helper = '/usr/libexec/podman-api';
			let helper_stat = stat(api_helper);
			if (access(api_helper, 'x')) {
				push(checks, { name: 'podman_api_helper', label: 'Podman API Helper', status: 'ok', detail: api_helper, message: 'Executable' });
			} else if (stat(api_helper)) {
				push(checks, { name: 'podman_api_helper', label: 'Podman API Helper', status: 'warn', detail: api_helper, message: 'Exists but not executable' });
			} else {
				push(checks, { name: 'podman_api_helper', label: 'Podman API Helper', status: 'warn', detail: api_helper, message: 'Not found - volume export/import will fail' });
			}

			// 9. UCI config
			let uci_ctx = cursor();
			let socket_cfg = uci_ctx.get('luci-podman', 'globals', 'socket_path');
			let globals_ok = uci_ctx.get('luci-podman', 'globals');
			uci_ctx.unload('luci-podman');
			if (globals_ok) {
				push(checks, { name: 'uci_config', label: 'UCI Config', status: 'ok', detail: 'luci-podman.globals', message: `socket_path=${socket_cfg || 'default'}` });
			} else {
				push(checks, { name: 'uci_config', label: 'UCI Config', status: 'warn', detail: '/etc/config/luci-podman', message: 'Config not found or not loadable' });
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
				let count = length(glob('/etc/containers/networks/*.json') ?? []);
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
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };

			let name = `${req.args.name}`;
			let start_priority = `${INIT_START_PRIORITY}`;
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
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };

			let path = init_script_path(req.args.name);
			let content = readfile(path);
			if (content == null)
				return { error: 'Init script not found' };

			return { content: content, path: path };
		}
	},

	init_script_status: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };

			let script_path = init_script_path(req.args.name);
			let exists = !!stat(script_path);
			let enabled = false;

			if (exists)
				enabled = init_enabled(`container-${req.args.name}`);

			return { exists: exists, enabled: enabled };
		}
	},

	init_script_set_enabled: {
		args: { name: '', enabled: false },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };

			let script_path = init_script_path(req.args.name);
			if (!stat(script_path))
				return { error: 'Init script not found. Generate it first.' };

			let action = (req.args.enabled === true || req.args.enabled === 1) ? 'enable' : 'disable';
			let rc = init_action(`container-${req.args.name}`, action);
			if (rc)
				return { error: `Failed to ${action} service` };

			return { success: true, enabled: (action === 'enable') };
		}
	},

	init_script_remove: {
		args: { name: '' },
		call: function(req) {
			let err = require_param('name', req.args.name) || validate_name(req.args.name);
			if (err) return { error: err };

			let script_path = init_script_path(req.args.name);
			if (!stat(script_path))
				return { success: true, message: 'Init script does not exist' };

			// Disable before removing
			init_action(`container-${req.args.name}`, 'disable');
			unlink(script_path);

			if (stat(script_path))
				return { error: 'Failed to remove init script' };

			return { success: true };
		}
	}
};

// --- Socket check wrapper ---
// Wrap all methods except system_debug with a socket availability check

const no_socket_check = {
	system_debug: true,
	init_script_generate: true,
	init_script_show: true,
	init_script_status: true,
	init_script_set_enabled: true,
	init_script_remove: true
};

const _local_socket_path = podman_socket.get_local_path();

const wrapped_methods = {};
for (let name in methods) {
	let method = methods[name];
	if (no_socket_check[name]) {
		wrapped_methods[name] = method;
	} else {
		wrapped_methods[name] = {
			args: method.args,
			call: function(req) {
				// Cheap pre-check for unix sockets only; TCP relies on actual connect failures.
				if (_local_socket_path) {
					let s = stat(_local_socket_path);
					if (!s || s.type !== 'socket')
						return { error: 'Podman socket not found or not accessible' };
				}
				return method.call(req);
			}
		};
	}
}

return { 'podman': wrapped_methods };
