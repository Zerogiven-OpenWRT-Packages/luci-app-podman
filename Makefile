include $(TOPDIR)/rules.mk

PKG_NAME := luci-app-podman
PKG_VERSION := 2.0.0
PKG_RELEASE := 1

LUCI_TITLE := LuCI Support for Podman
LUCI_DESCRIPTION := Modern web interface for managing Podman containers, images, volumes, networks, pods, and secrets on OpenWrt
LUCI_DEPENDS := +podman +rpcd +rpcd-mod-file
LUCI_PKGARCH := all

PKG_MAINTAINER := Your Name <your.email@example.com>
PKG_LICENSE := Apache-2.0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
