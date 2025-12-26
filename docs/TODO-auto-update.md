# Feature: Custom Container Auto-Update

## Overview

Implement container auto-update functionality in the web UI using `podman generate spec` to preserve container configuration.

## Background

Podman's built-in `auto-update` API requires systemd integration which OpenWrt doesn't have (uses procd). This feature implements the same functionality using `podman generate spec` which provides the exact container create command.

## How It Works

### Key Insight

`podman generate spec --name <container>` returns JSON with `containerCreateCommand` array - the exact `podman run` command to recreate the container. This eliminates complex config extraction.

### Update Process

1. **Pull latest image** for containers with `io.containers.autoupdate` label
2. **Check if update available** by comparing image digests
3. **Generate spec** to get `containerCreateCommand`
4. **Stop & remove** old container
5. **Recreate** container using the exact same command
6. **Start** if it was running before

> **Note**: Init scripts use container name, not ID. Same name = init script still works. No regeneration needed.

---

## Implementation Tasks

### Phase 1: Backend - Add generate spec RPC

- [ ] **1.1** Add `container_generate_spec` method to `luci.podman`
  ```sh
  podman generate spec --name "$name"
  ```
- [ ] **1.2** Add RPC declaration in `podman/rpc.js`
  ```javascript
  generateSpec: rpc.declare({
    object: 'luci.podman',
    method: 'container_generate_spec',
    params: ['name']
  })
  ```
- [ ] **1.3** Add ACL permission for new method

### Phase 2: Update Check Logic

- [ ] **2.1** Create `podman/auto-update.js` module
- [ ] **2.2** Implement `getAutoUpdateContainers()`
  - Filter containers by `io.containers.autoupdate` label
  - Return list with name, image, running state
- [ ] **2.3** Implement `checkForUpdates(containers)`
  - For each container: pull latest image
  - Compare current vs pulled image digest
  - Return list of containers with available updates

### Phase 3: Update Execution

- [ ] **3.1** Implement `updateContainer(name, wasRunning)`
  ```
  1. Generate spec → get containerCreateCommand
  2. Stop container (if running)
  3. Remove container
  4. Execute create command (exact same command)
  5. Start container (if wasRunning)
  ```
- [ ] **3.2** Implement `parseCreateCommand(commandArray)`
  - Convert command array to create spec object
  - Use command exactly as returned by Podman
- [ ] **3.3** Implement `executeUpdate(containers)`
  - Batch update with progress tracking
  - Handle errors per-container

### Phase 4: UI Integration

- [ ] **4.1** Add "Check for Updates" button to Overview
- [ ] **4.2** Create update check modal
  - Show progress while checking
  - List containers with updates available
  - Checkboxes to select which to update
- [ ] **4.3** Create update progress modal
  - Step-by-step progress per container
  - Success/failure status
  - Final summary

### Phase 5: Error Handling

- [ ] **5.1** Pre-update validation
  - Verify image pulled successfully before removing container
- [ ] **5.2** Rollback info
  - Save old image reference
  - If new container fails to start, show recovery instructions
- [ ] **5.3** Partial failure handling
  - Continue with other containers if one fails
  - Clear error reporting

---

## API Calls

### Existing (in rpc.js)
| Method | Purpose |
|--------|---------|
| `container.list()` | Find containers with label |
| `container.inspect()` | Get current image digest |
| `container.stop()` | Stop before remove |
| `container.remove()` | Remove old container |
| `container.create()` | Create with new image |
| `container.start()` | Start new container |
| `image.pull()` | Pull latest image |
| `image.inspect()` | Get image digest |

### New (to add)
| Method | Purpose |
|--------|---------|
| `container.generateSpec()` | Get containerCreateCommand |

---

## Example: Generate Spec Output

```json
{
  "containerCreateCommand": [
    "podman",
    "run",
    "-d",
    "--name", "grafana",
    "--hostname", "mon.example.com",
    "--network", "podlan",
    "--ip", "192.168.20.14",
    "--restart", "unless-stopped",
    "--label", "io.containers.autoupdate=registry",
    "-e", "TZ=Europe/Vienna",
    "-v", "grafana_data:/var/lib/grafana:Z",
    "--health-cmd", "wget -qO- http://localhost:3000/api/health || exit 1",
    "docker.io/grafana/grafana:12.2.1"
  ]
}
```

To update:
1. Pull the image (same tag as in command)
2. If digest changed, execute the exact same create command
3. Podman uses the freshly pulled image automatically

---

## UI Mockups

### Check for Updates Result
```
┌─────────────────────────────────────────┐
│ Container Updates                       │
├─────────────────────────────────────────┤
│                                         │
│ Updates available:                      │
│ ☑ grafana      grafana:12.2.1 → 12.3.0  │
│ ☑ nginx        nginx:1.25 → 1.27        │
│                                         │
│ Already up-to-date:                     │
│   mariadb, homeassistant, mosquitto     │
│                                         │
├─────────────────────────────────────────┤
│      [Update Selected]  [Cancel]        │
└─────────────────────────────────────────┘
```

### Update Progress
```
┌─────────────────────────────────────────┐
│ Updating Containers                     │
├─────────────────────────────────────────┤
│                                         │
│ grafana (1/2):                          │
│   ✓ Generated spec                      │
│   ✓ Stopped container                   │
│   ✓ Removed container                   │
│   ✓ Created new container               │
│   ✓ Started container                   │
│                                         │
│ nginx (2/2):                            │
│   ● Generating spec...                  │
│                                         │
└─────────────────────────────────────────┘
```

---

## File Changes

### New Files
- `htdocs/luci-static/resources/podman/auto-update.js`

### Modified Files
- `root/usr/libexec/rpcd/luci.podman` - Add generate_spec method
- `root/usr/share/rpcd/acl.d/luci-app-podman.json` - Add ACL
- `htdocs/luci-static/resources/podman/rpc.js` - Add RPC declaration
- `htdocs/luci-static/resources/view/podman/overview.js` - Add UI button

---

## Testing Checklist

- [ ] Simple container (image only)
- [ ] Container with port mappings
- [ ] Container with volume mounts
- [ ] Container with environment variables
- [ ] Container with custom network + static IP
- [ ] Container with health check
- [ ] Container with restart policy
- [ ] Container that was stopped (should stay stopped after update)
- [ ] Container with init script (should still work after update)
- [ ] Multiple containers batch update
- [ ] Network error during pull
- [ ] Container fails to start after update

---

## Advantages of This Approach

1. **Simple** - No complex config extraction, Podman gives us the exact command
2. **Reliable** - Uses Podman's own spec generation, guaranteed accurate
3. **Complete** - All options preserved (capabilities, security, health checks, etc.)
4. **Maintainable** - Less code, fewer edge cases
