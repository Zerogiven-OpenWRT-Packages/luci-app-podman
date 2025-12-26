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
- [Credits](#credits)
- [License](#license)

## Features

- **Container Management**: Start, stop, restart, create, remove with live logs, stats, and health monitoring
- **Import from Run Command**: Convert `docker run` or `podman run` commands to container configurations
- **Auto-start Support**: Automatic init script generation for containers with restart policies
- **Image Management**: Pull, remove, inspect images with streaming progress
- **Volume Management**: Create, delete, export/import volumes with tar backups
- **Network Management**: Bridge, macvlan, ipvlan with VLAN support and optional OpenWrt integration (auto-creates bridge devices, network interfaces, dnsmasq exclusion, and shared `podman` firewall zone with DNS access rules)
- **Pod Management**: Multi-container pods with shared networking
- **Secret Management**: Encrypted storage for sensitive data
- **System Overview**: Resource usage, disk space, system-wide cleanup
- **Mobile friendly Lists**: Optimized for basic usage

## Screenshots

![Container List](docs/screenshots/screenshots.gif)

See more screenshots in [docs/screenshots/](docs/screenshots/)

## Requirements

- OpenWrt 24.10.x or later
- Podman 4.0+ with REST API enabled
- Sufficient storage for images/containers

## Installation

### From Package Feed

You can setup this package feed to install and update it with opkg:

[https://github.com/Zerogiven-OpenWRT-Packages/package-feed](https://github.com/Zerogiven-OpenWRT-Packages/package-feed)

### From IPK Package

```bash
wget https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman/releases/download/v1.5.0/luci-app-podman_1.5.0-r1_all.ipk
opkg update && opkg install luci-app-podman_1.5.0-r1_all.ipk
```

### From Source

```bash
# Clone openwrt repository and prepare build environment. Next:
git clone https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman.git package/luci-app-podman
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

## Credits

Inspired by:
- [openwrt-podman](https://github.com/breeze303/openwrt-podman/) - Podman on OpenWrt
- [luci-app-dockerman](https://github.com/lisaac/luci-app-dockerman) - Docker LuCI design patterns
- [OpenWrt Podman Guide](https://openwrt.org/docs/guide-user/virtualization/podman) - Official documentation

## License

Apache License 2.0 - see [LICENSE](LICENSE) file.
