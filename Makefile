# See /LICENSE for more information.

include $(TOPDIR)/rules.mk

PKG_NAME          := luci-app-podman
PKG_VERSION       := 1.7.0
PKG_RELEASE       := 1
PKG_MAINTAINER    := Christopher Söllinger <christopher.soellinger@gmail.com>
PKG_URL           := https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman
PKG_LICENSE       := Apache-2.0
PKG_LICENSE_FILES := LICENSE

LUCI_TITLE         := LuCI Support for Podman
LUCI_DESCRIPTION   := Modern web interface for managing Podman containers with auto-update, auto-start, images, volumes, networks, pods, and secrets
#LUCI_DEPENDS       := +rpcd +rpcd-mod-file +podman +curl
LUCI_EXTRA_DEPENDS       := +rpcd +rpcd-mod-file +podman +curl
LUCI_PKGARCH       := all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
