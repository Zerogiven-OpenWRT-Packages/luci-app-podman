- Container Pause/Unpause UI
- Smart Container Stop with Kill Fallback
- Smart Pod Stop with Kill Fallback
- Image Search
- Pod Detail Page
- Optimize Container Detail Mobile View
- Repair network with IPv6 configured creates this uci config:
      config device 'podman0'
        option type 'bridge'
        option name 'podman0'
        option bridge_empty '1'
        option ipv6 '0'

      config interface 'podman'
        option proto 'static'
        option device 'podman0'
        option ipaddr '10.88.0.1'
        option netmask '255.255.0.0'
