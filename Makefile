include $(TOPDIR)/rules.mk

PKG_NAME          := luci-app-podman
PKG_VERSION       := 1.10.0
PKG_RELEASE       := 1
PKG_MAINTAINER    := Christopher Söllinger <christopher.soellinger@gmail.com>
PKG_URL           := https://github.com/Zerogiven-OpenWRT-Packages/luci-app-podman
PKG_LICENSE       := Apache-2.0
PKG_LICENSE_FILES := LICENSE

LUCI_TITLE         := LuCI Support for Podman
LUCI_DESCRIPTION   := Modern web interface for managing Podman containers with auto-update, auto-start, images, volumes, networks, pods, and secrets
LUCI_DEPENDS       := +rpcd +rpcd-mod-file +curl
LUCI_PKGARCH       := all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# Run uci-defaults scripts
	[ -f /etc/uci-defaults/luci-app-podman ] && (. /etc/uci-defaults/luci-app-podman) && rm -f /etc/uci-defaults/luci-app-podman 2>/dev/null
	# Clear LuCI cache
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache/
	# Restart rpcd
	killall -HUP rpcd 2>/dev/null
	# Add cron job for orphaned session cleanup (idempotent)
	grep -q podman-cleanup /etc/crontabs/root 2>/dev/null || \
		echo '*/2 * * * * /usr/libexec/podman-cleanup' >> /etc/crontabs/root
	/etc/init.d/cron restart 2>/dev/null
}
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# Remove cron job
	sed -i '/podman-cleanup/d' /etc/crontabs/root 2>/dev/null
	/etc/init.d/cron restart 2>/dev/null
}
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
