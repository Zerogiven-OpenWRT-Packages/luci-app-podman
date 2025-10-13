# LuCI App for Podman

A modern LuCI web interface for managing Podman containers on OpenWrt routers.

## Features

### Container Management
- List, create, start, stop, restart, and remove containers
- View container logs in real-time
- Monitor container statistics (CPU, memory, network, I/O)
- Attach terminal to running containers
- Commit container changes to new images
- Comprehensive container creation form with:
  - Port mappings
  - Environment variables
  - Volume mounts
  - Network configuration
  - Resource limits (CPU, memory)
  - Restart policies
  - Auto-update support

### Image Management
- List and pull images from registries
- Remove images (with force and prune options)
- Inspect image details
- Pull latest versions in bulk
- Stream pull progress in real-time

### Volume Management
- Create, inspect, and remove volumes
- Support for multiple volume drivers (local, image)
- Custom mount options
- Volume labels

### Network Management
- Create, inspect, and remove networks
- Multiple network drivers (bridge, macvlan, ipvlan)
- Custom subnet and gateway configuration
- IPv6 support
- Internal network mode

### Pod Management
- Create, start, stop, restart, and remove pods
- Port mappings for pods
- Pod labels and hostnames

### Secret Management
- Create and remove secrets
- Secure encrypted storage
- Secrets cannot be retrieved after creation

### System Overview
- Podman version and API information
- Running containers, images, volumes, networks, pods, and secrets count
- Disk usage statistics with reclaimable space
- System-wide prune operations
- Auto-update for containers

## Requirements

- OpenWrt 21.02 or later
- LuCI web interface
- Podman 3.0+ installed
- Podman socket enabled at `/run/podman/podman.sock`

## Installation

### From Package Source

Build and install the package:

```bash
# Clone the repository
git clone https://github.com/yourusername/luci-app-podman.git
cd luci-app-podman

# Build the package (requires OpenWrt build environment)
make package/luci-app-podman/compile

# Install on your OpenWrt device
scp bin/packages/.../luci-app-podman_*.ipk root@router:/tmp/
ssh root@router 'opkg install /tmp/luci-app-podman_*.ipk'
```

### From Repository

```bash
opkg update
opkg install luci-app-podman
```

## Setup

### 1. Enable Podman Socket

The application communicates with Podman via its REST API over a Unix socket:

```bash
# Create socket directory
mkdir -p /run/podman

# Start the Podman service
podman system service --time=0 unix:///run/podman/podman.sock &
```

### 2. Make It Persistent

Add to `/etc/rc.local` (before `exit 0`):

```bash
mkdir -p /run/podman
podman system service --time=0 unix:///run/podman/podman.sock &
```

Or create a procd init script at `/etc/init.d/podman-socket`:

```bash
#!/bin/sh /etc/rc.common

START=99
STOP=01

USE_PROCD=1

start_service() {
	procd_open_instance
	procd_set_param command podman system service --time=0 unix:///run/podman/podman.sock
	procd_set_param respawn ${respawn_threshold:-3600} ${respawn_timeout:-5} ${respawn_retry:-5}
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_close_instance
}
```

Then enable and start it:

```bash
chmod +x /etc/init.d/podman-socket
/etc/init.d/podman-socket enable
/etc/init.d/podman-socket start
```

### 3. Access the Interface

Navigate to: **System → Podman** in your LuCI interface, or directly at:
```
http://your-router-ip/cgi-bin/luci/admin/podman
```

## Configuration

Configuration file: `/etc/config/podman`

```
config podman 'globals'
	option socket_path '/run/podman/podman.sock'
	option remote_endpoint ''
```

Options:
- `socket_path`: Path to Podman Unix socket (default: `/run/podman/podman.sock`)
- `remote_endpoint`: Optional remote Podman API endpoint (e.g., `tcp://192.168.1.100:8080`)

## Project Structure

```
luci-app-podman/
├── Makefile                                  # OpenWrt build configuration
├── htdocs/luci-static/resources/
│   ├── podman/
│   │   ├── rpc.js                           # RPC API client
│   │   ├── utils.js                         # Shared utility functions
│   │   ├── container-form.js                # Container creation form
│   │   ├── volume-form.js                   # Volume creation form
│   │   ├── network-form.js                  # Network creation form
│   │   ├── pod-form.js                      # Pod creation form
│   │   └── secret-form.js                   # Secret creation form
│   └── view/podman/
│       ├── overview.js                      # System overview page
│       ├── containers.js                    # Container management
│       ├── images.js                        # Image management
│       ├── volumes.js                       # Volume management
│       ├── networks.js                      # Network management
│       ├── pods.js                          # Pod management
│       └── secrets.js                       # Secret management
├── root/
│   ├── etc/config/podman                    # Default configuration
│   ├── etc/uci-defaults/luci-podman         # UCI defaults script
│   ├── usr/libexec/rpcd/luci.podman         # RPC backend (shell script)
│   ├── usr/share/luci/menu.d/
│   │   └── luci-app-podman.json             # Menu definition
│   └── usr/share/rpcd/acl.d/
│       └── luci-app-podman.json             # ACL permissions
└── README.md
```

## Architecture

### Frontend
- Built with modern JavaScript (ES6+)
- Uses LuCI's `form.JSONMap` for form handling
- Shared RPC module for API communication
- Shared utility functions for common operations
- Modal-based forms for resource creation

### Backend
- Shell script RPC handler using `curl` to communicate with Podman API
- Communicates via Unix socket at `/run/podman/podman.sock`
- Uses Podman libpod API v5.0.0
- UCI configuration integration

### RPC API

All RPC methods are exposed under the `luci.podman` namespace:

#### Containers
- `container_list(all)` - List containers
- `container_inspect(id)` - Inspect container
- `container_start(id)` - Start container
- `container_stop(id)` - Stop container
- `container_restart(id)` - Restart container
- `container_remove(id, force)` - Remove container
- `container_create(spec)` - Create container
- `container_logs(id, follow, tail)` - Get container logs
- `container_stats(id, stream)` - Get container stats
- `container_commit(id, repo, tag, comment, author)` - Commit container
- `container_prune()` - Remove unused containers

#### Images
- `image_list()` - List images
- `image_inspect(name)` - Inspect image
- `image_remove(name, force)` - Remove image
- `image_pull(reference)` - Pull image
- `image_pull_stream(reference, offset)` - Stream pull progress
- `image_prune(all)` - Remove unused images

#### Volumes
- `volume_list()` - List volumes
- `volume_inspect(name)` - Inspect volume
- `volume_create(spec)` - Create volume
- `volume_remove(name, force)` - Remove volume
- `volume_prune()` - Remove unused volumes

#### Networks
- `network_list()` - List networks
- `network_inspect(name)` - Inspect network
- `network_create(spec)` - Create network
- `network_remove(name, force)` - Remove network
- `network_prune()` - Remove unused networks

#### Pods
- `pod_list()` - List pods
- `pod_inspect(name)` - Inspect pod
- `pod_create(spec)` - Create pod
- `pod_start(name)` - Start pod
- `pod_stop(name)` - Stop pod
- `pod_restart(name)` - Restart pod
- `pod_remove(name, force)` - Remove pod
- `pod_prune()` - Remove unused pods

#### Secrets
- `secret_list()` - List secrets
- `secret_inspect(name)` - Inspect secret
- `secret_create(name, data)` - Create secret
- `secret_remove(name)` - Remove secret

#### System
- `system_version()` - Get Podman version
- `system_info()` - Get system information
- `system_df()` - Get disk usage
- `system_prune(all, volumes)` - System-wide prune
- `auto_update()` - Auto-update containers

## Development

### Code Style
- Modern JavaScript (ES6+) with `const`/`let` and arrow functions
- Comprehensive JSDoc comments for all functions
- Consistent error handling and user feedback
- Shared utilities to minimize code duplication

### Testing
Test the RPC backend directly:

```bash
# Test container list
ubus call luci.podman container_list '{"all":"true"}'

# Test image list
ubus call luci.podman image_list '{}'

# Test system info
ubus call luci.podman system_info '{}'
```

### Building

Requires OpenWrt build environment:

```bash
# In your OpenWrt build root
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig  # Select LuCI → Applications → luci-app-podman
make package/luci-app-podman/compile V=s
```

## Troubleshooting

### Podman Socket Not Found
```bash
# Check if socket exists
ls -la /run/podman/podman.sock

# Start the service
podman system service --time=0 unix:///run/podman/podman.sock &
```

### Permission Denied
```bash
# Check socket permissions
chmod 666 /run/podman/podman.sock
```

### RPC Errors
```bash
# Check ubus permissions
ubus list luci.podman

# Test RPC call
ubus call luci.podman system_version '{}'

# Check logs
logread | grep podman
```

## License

Apache-2.0

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## Credits

- Inspired by [luci-app-dockerman](https://github.com/lisaac/luci-app-dockerman)
- Built for OpenWrt and LuCI
- Uses Podman libpod REST API
