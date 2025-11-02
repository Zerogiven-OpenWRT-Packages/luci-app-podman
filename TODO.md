# Must do

- Pods list should have action buttons like container list

# Should have

- Remove environment variables from container.js because there can be risky information
    - Another way would be to consore the values till the user click on it so the values are only shown after user action not just after loading the container details.

# Nice to have, features only.

- Start/Stop/Restart container inside container.js without reloading the page.
- Show the full inspect json for one container in the container details in its own tab (inspect)
- Show parts from inspect json as tooltip(title) for the inspect links. For example, network could show if IPv6 is enabled so user can get neccessary informations without the need to open the inspect modal
- Pods list views container ids with link to container details instead of just the number of containers
- Poll the container stats
- Console for container
