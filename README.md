# LuCI App Podman

Modern LuCI web interface for managing Podman containers on OpenWrt.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-24.10.x-green.svg)](https://openwrt.org/)

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Installation](#installation)
  - [From IPK Package](#from-ipk-package)
  - [From Source](#from-source)
- [Getting Started](#getting-started)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)
- [Contributing](#contributing)
  - [Key Files](#key-files)
- [License](#license)
- [Support](#support)

## Features

- **Container Management**: Start, stop, restart, create, remove with live logs and stats
- **Auto-start Support**: Automatic init script generation for containers with restart policies
- **Image Management**: Pull, remove, inspect images with streaming progress
- **Volume Management**: Create, delete, export/import volumes with tar backups
- **Network Management**: Bridge, macvlan, ipvlan with optional OpenWrt firewall integration (create new `podman_<name>` zone or select existing `podman*` zones)
- **Pod Management**: Multi-container pods with shared networking
- **Secret Management**: Encrypted storage for sensitive data
- **System Overview**: Resource usage, disk space, system-wide cleanup

## Screenshots

### Container List View
![Container List](docs/screenshots/containers.png)
*Manage multiple containers with bulk operations, auto-start indicators, and health status*

### Container Detail View
![Container Detail](docs/screenshots/container-detail.png)
*Comprehensive container information with tabbed interface for logs, stats, and configuration*

### Network Creation
![Network Creation](docs/screenshots/network-create.png)
*Create Podman networks with optional OpenWrt firewall integration*

## Requirements

- OpenWrt 24.10.x or later
- Podman 4.0+ with REST API enabled
- Sufficient storage for images/containers

## Installation

### From IPK Package

```bash
scp luci-app-podman_*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
opkg update && opkg install /tmp/luci-app-podman_*.ipk
```

### From Source

```bash
# Clone openwrt repository and prepare build environment. Next:
git clone https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman.git package/luci-app-podma
cd luci-app-podman
# In OpenWrt build environment:
make package/luci-app-podman/compile V=s
```

## Getting Started

Access via **Podman** in LuCI, or directly at:
```
http://your-router-ip/cgi-bin/luci/admin/podman
```

If encountering socket errors:
```bash
/etc/init.d/podman start
/etc/init.d/podman enable
```

## Troubleshooting

**Access denied:**
```bash
cat /usr/share/rpcd/acl.d/luci-app-podman.json
/etc/init.d/rpcd restart
```

**RPC debugging:**
```bash
ubus call luci.podman containers_list '{"query":"all=true"}'
logread | grep -i podman
```

## Credits

Inspired by:
- [openwrt-podman](https://github.com/breeze303/openwrt-podman/) - Podman on OpenWrt
- [luci-app-dockerman](https://github.com/lisaac/luci-app-dockerman) - Docker LuCI design patterns
- [OpenWrt Podman Guide](https://openwrt.org/docs/guide-user/virtualization/podman) - Official documentation

## Contributing

Contributions welcome! See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

### Key Files

```
htdocs/luci-static/resources/
├── podman/
│   ├── rpc.js               # RPC API client
│   ├── utils.js             # Shared utilities
│   ├── ui.js                # Custom UI components
│   ├── form.js              # Form components
│   ├── format.js            # Date/size formatting
│   ├── list.js              # List view helpers
│   ├── container-util.js    # Container operations
│   ├── openwrt-network.js   # OpenWrt integration
│   ├── run-command-parser.js # Docker run parser
│   ├── constants.js         # Shared constants
│   └── ipv6.js              # IPv6 utilities
└── view/podman/
    ├── overview.js          # Dashboard
    ├── containers.js        # Container list
    ├── container.js         # Container detail
    ├── images.js            # Images
    ├── volumes.js           # Volumes
    ├── networks.js          # Networks
    ├── pods.js              # Pods
    └── secrets.js           # Secrets

root/usr/libexec/rpcd/luci.podman  # RPC backend
```

## License

Apache License 2.0 - see [LICENSE](LICENSE) file.

## Support

- [Issues](https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman/issues)
