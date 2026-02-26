include $(TOPDIR)/rules.mk

PKG_NAME          := luci-app-podman
PKG_VERSION       := 1.13.0
PKG_RELEASE       := 1
PKG_MAINTAINER    := Christopher Söllinger <christopher.soellinger@gmail.com>
PKG_URL           := https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman
PKG_LICENSE       := Apache-2.0
PKG_LICENSE_FILES := LICENSE

LUCI_TITLE         := LuCI Support for Podman
LUCI_DESCRIPTION   := Modern web interface for managing Podman containers with auto-update, auto-start, images, volumes, networks, pods, and secrets
LUCI_DEPENDS       := +luci-base +rpcd +rpcd-mod-ucode +ucode-mod-socket +podman
LUCI_PKGARCH       := all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/postinst
sed -i '/podman-cleanup/d' /etc/crontabs/root 2>/dev/null

[ -n "$${IPKG_INSTROOT}" ] || {$(foreach script,$(LUCI_DEFAULTS),
	[ -f /etc/uci-defaults/$(script) ] && (. /etc/uci-defaults/$(script)) && rm -f /etc/uci-defaults/$(script))
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache/
	killall -HUP rpcd 2>/dev/null
	exit 0
}
endef

# call BuildPackage - OpenWrt buildroot signature
