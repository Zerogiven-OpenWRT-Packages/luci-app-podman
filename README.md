# LuCI App Podman

Modern LuCI web interface for managing Podman containers on OpenWrt.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-24.10.x-green.svg)](https://openwrt.org/)

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Container Auto-Update](#container-auto-update)
- [Container Auto-Start](#container-auto-start)
- [Credits](#credits)

## Features

- **Container Management**: Start, stop, restart, create, remove with live logs, stats, and health monitoring
- **Container Auto-Update**: Check for image updates and recreate containers with latest images (see [Auto-Update](#container-auto-update))
- **Import from Run Command**: Convert `docker run` or `podman run` commands to container configurations
- **Auto-start Support**: Automatic init script generation for containers with restart policies
- **Image Management**: Pull, remove, inspect images with streaming progress
- **Volume Management**: Create, delete, export/import volumes with tar backups
- **Network Management**: Bridge, macvlan, ipvlan with VLAN support and optional OpenWrt integration (auto-creates bridge devices, network interfaces, dnsmasq exclusion, and shared `podman` firewall zone with DNS access rules)
- **Pod Management**: Multi-container pods with shared networking
- **Secret Management**: Encrypted storage for sensitive data
- **System Overview**: Resource usage, disk space, system-wide cleanup
- **Mobile Friendly Lists**: Optimized for basic usage

## Screenshots

![Container List](docs/screenshots/screenshots.gif)

See more screenshots in [docs/screenshots/](docs/screenshots/)

## Requirements

- OpenWrt 24.10.x or later
- Podman
- Curl
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
git clone https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman.git package/luci-app-podman
make menuconfig  # Navigate to: LuCI → Applications → luci-app-podman
make package/luci-app-podman/compile V=s
```

**Note:** You mabye have to select curl and podman yourself if you build it yourself. This is because they are declared as runtime dependencies to fasten build time for luci app alone.

## Usage

Access via **Podman** in LuCI, or directly at:

```
http://your-router-ip/cgi-bin/luci/admin/podman
```

If encountering socket errors:

```bash
/etc/init.d/podman start
/etc/init.d/podman enable
```

## Container Auto-Start

If you want save startup scripts during an upgrade you have to config your `/etc/sysupgrade.conf` with `/etc/init.d/container-*`.

```bash
echo "/etc/init.d/container-*" >> /etc/sysupgrade.conf
```

## Container Auto-Update

The auto-update feature checks for newer container images and recreates containers with the updated images while preserving all configuration.

### Setup

To enable auto-update for a container, add the label when creating it:

```bash
podman run -d --name mycontainer \
  --label io.containers.autoupdate=registry \
  nginx:latest
```

Or add via the LuCI interface in the container creation form under "Labels".

### How to Update

1. Go to **Podman → Overview**
2. Click **"Check for Updates"** in the System Maintenance section
3. The system pulls latest images and compares digests
4. Select which containers to update
5. Click **"Update Selected"** to recreate containers with new images

### How it Works

1. Finds containers with `io.containers.autoupdate` label
2. Pulls the latest image for each container
3. Compares image digests to detect changes
4. For containers with updates:
   - Extracts original create command from container config
   - Stops and removes the old container
   - Recreates with the exact same configuration
   - Starts if it was running before

Container names and init scripts are preserved - no manual reconfiguration needed.

## Credits

Inspired by:

- [openwrt-podman](https://github.com/breeze303/openwrt-podman/) - Podman on OpenWrt
- [luci-app-dockerman](https://github.com/lisaac/luci-app-dockerman) - Docker LuCI design patterns
- [OpenWrt Podman Guide](https://openwrt.org/docs/guide-user/virtualization/podman) - Official documentation
