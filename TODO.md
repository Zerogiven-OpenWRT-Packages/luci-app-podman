# Must do

- Pods list should not have the actions column. Should be handled like the containers list.


# Should have

- Managing health check for a container
- Running health check for container(s)
- Remove environment variables from container.js because there can be risky information
    - Another way would be to consore the values till the user click on it so the values are only shown after user action not just after loading the container details.
- Logout if session expired: Failed to start container: Login session is expired at notifySessionExpiry (https://r4.lies47.net/luci-static/resources/luci.js?v=25.280.58391~b7e4a9c-1761133839:187:464) at async Promise.all (index 0)

# Nice to have, features only.

- Start/Stop/Restart container inside container.js without reloading the page.
- Show the full inspect json for one container in the container details in its own tab (inspect)
- Show parts from inspect json as tooltip(title) for the inspect links. For example, network could show if IPv6 is enabled so user can get neccessary informations without the need to open the inspect modal
- Pods list views container ids with link to container details instead of just the number of containers
- Poll the container stats
- Console
