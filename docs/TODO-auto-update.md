# Feature: Custom Container Auto-Update

## Overview

Implement container auto-update functionality in the web UI without relying on Podman's systemd-dependent auto-update API.

## Background

Podman's built-in `auto-update` requires systemd integration which OpenWrt doesn't have (uses procd). This feature implements the same functionality using existing Podman APIs.

## How It Works

### Update Detection
1. Find containers with `io.containers.autoupdate=registry` label
2. Get current container's image digest
3. Pull latest image from registry
4. Compare digests to detect available updates

### Update Process
1. Inspect container to save full configuration
2. Stop container
3. Remove container (volumes preserved)
4. Create new container with same config + new image
5. Start container
6. Reconnect networks if needed

---

## Implementation Tasks

### Phase 1: Check for Updates (Dry Run)

- [ ] **1.1** Add "Check for Updates" button to Overview page
- [ ] **1.2** Create `getContainersWithAutoUpdate()` helper
  - Filter containers by `io.containers.autoupdate` label
  - Return list with container name, image, current digest
- [ ] **1.3** Create `checkImageUpdate(imageName)` function
  - Pull latest image (or check manifest)
  - Compare pulled digest vs container's image digest
  - Return: `{hasUpdate: bool, currentDigest, newDigest}`
- [ ] **1.4** Create UI modal for update check results
  - Show list of containers with available updates
  - Show containers already up-to-date
  - Button to proceed with update

### Phase 2: Perform Updates

- [ ] **2.1** Create `extractContainerSpec(inspectData)` function
  - Extract all config needed to recreate container:
    - Name, Image, Command, Entrypoint
    - Environment variables
    - Port mappings
    - Volume mounts
    - Labels
    - Network mode/connections
    - Restart policy
    - Resource limits (CPU, memory)
    - Privileged, capabilities
    - Hostname, working directory
    - Health check config
- [ ] **2.2** Create `updateContainer(containerId)` function
  - Step 1: Inspect and save config
  - Step 2: Pull latest image (if not already pulled)
  - Step 3: Stop container
  - Step 4: Remove container
  - Step 5: Create container with saved config + new image
  - Step 6: Reconnect to networks
  - Step 7: Start container
  - Handle errors at each step with rollback info
- [ ] **2.3** Create progress modal UI
  - Show step-by-step progress
  - Show success/failure for each container
  - Final summary

### Phase 3: Batch Operations

- [ ] **3.1** Add "Update All" functionality
  - Update all containers with available updates
  - Sequential updates (safer) or parallel (faster)
- [ ] **3.2** Add "Update Selected" functionality
  - Checkbox selection in update list
  - Update only selected containers
- [ ] **3.3** Add update status to container list view
  - Column or icon showing update available
  - Click to update single container

### Phase 4: Error Handling & Rollback

- [ ] **4.1** Implement pre-update validation
  - Check image can be pulled before removing container
  - Verify network exists before reconnect
- [ ] **4.2** Save rollback information
  - Store old image ID
  - Store original container config
- [ ] **4.3** Add manual rollback option
  - If update fails, offer to recreate with old image
- [ ] **4.4** Handle partial failures
  - If container won't start after update, show clear error
  - Don't break other containers in batch update

---

## API Calls Required

All APIs already exist in `podman/rpc.js`:

| Function | RPC Method | Purpose |
|----------|------------|---------|
| List containers | `container.list()` | Find containers with label |
| Inspect container | `container.inspect()` | Get full config |
| Pull image | `image.pull()` | Get latest image |
| Inspect image | `image.inspect()` | Get image digest |
| Stop container | `container.stop()` | Stop before remove |
| Remove container | `container.remove()` | Remove old container |
| Create container | `container.create()` | Create with new image |
| Start container | `container.start()` | Start new container |
| Connect network | `network.connect()` | Reconnect networks |

---

## Container Spec Fields to Preserve

```javascript
{
  // Basic
  name: string,
  image: string,  // Updated to new image
  command: string[],
  entrypoint: string[],

  // Environment
  env: {key: value},

  // Networking
  portmappings: [{host_port, container_port, protocol}],
  hostname: string,
  dns_server: string[],
  dns_search: string[],

  // Storage
  mounts: [{source, destination, type, options}],

  // Labels
  labels: {key: value},  // Preserve all including autoupdate

  // Runtime
  privileged: boolean,
  cap_add: string[],
  cap_drop: string[],
  user: string,
  work_dir: string,

  // Resources
  resource_limits: {
    cpu: {quota, period},
    memory: {limit}
  },

  // Health
  healthconfig: {Test, Interval, Timeout, Retries},

  // Restart
  restart_policy: string,
  restart_tries: number,

  // Other
  stdin: boolean,
  terminal: boolean
}
```

---

## UI Mockups

### Check for Updates Modal
```
┌─────────────────────────────────────────┐
│ Check for Container Updates             │
├─────────────────────────────────────────┤
│                                         │
│ Checking 5 containers...                │
│ [████████████░░░░░░░░] 3/5              │
│                                         │
└─────────────────────────────────────────┘
```

### Updates Available Modal
```
┌─────────────────────────────────────────┐
│ Updates Available                       │
├─────────────────────────────────────────┤
│                                         │
│ ☑ nginx        nginx:latest    → new    │
│ ☑ grafana      grafana:latest  → new    │
│ ☐ mariadb      mariadb:10      → new    │
│                                         │
│ ─────────────────────────────────────── │
│ Already up-to-date:                     │
│   homeassistant, mosquitto              │
│                                         │
├─────────────────────────────────────────┤
│ [Update Selected]  [Update All] [Close] │
└─────────────────────────────────────────┘
```

### Update Progress Modal
```
┌─────────────────────────────────────────┐
│ Updating Containers (1/2)               │
├─────────────────────────────────────────┤
│                                         │
│ nginx:                                  │
│   ✓ Pulling image                       │
│   ✓ Stopping container                  │
│   ✓ Removing old container              │
│   ● Creating new container...           │
│   ○ Starting container                  │
│   ○ Reconnecting networks               │
│                                         │
└─────────────────────────────────────────┘
```

---

## File Changes

### New Files
- `htdocs/luci-static/resources/podman/auto-update.js` - Core update logic

### Modified Files
- `htdocs/luci-static/resources/view/podman/overview.js` - Add button & UI
- `po/templates/podman.pot` - New translation strings

---

## Testing Checklist

- [ ] Container with simple config (image only)
- [ ] Container with port mappings
- [ ] Container with volume mounts
- [ ] Container with environment variables
- [ ] Container with custom network
- [ ] Container with resource limits
- [ ] Container with health check
- [ ] Container with restart policy
- [ ] Batch update (multiple containers)
- [ ] Failed pull (network error)
- [ ] Failed start (config error)
- [ ] Rollback after failure

---

## Notes

- Updates are opt-in via `io.containers.autoupdate=registry` label
- Container name is preserved (required for init scripts)
- Volumes are not deleted (data persists)
- Networks are reconnected after recreation
- Init scripts continue to work (same container name)
