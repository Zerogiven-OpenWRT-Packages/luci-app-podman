# Podman API Enhancement Opportunities - REVISED

**Analysis Date:** 2025-10-30
**Source:** Podman API v5.0.0 swagger-latest.yaml
**Current Implementation:** 38 endpoints + system prune functionality

---

## Critical Corrections

### Already Implemented ✅
1. **System Prune** - Unified cleanup in Overview page (`handlePrune()`)
   - Prunes containers, images, networks
   - Optional: all images (not just dangling)
   - Optional: volumes
   - Shows freed space and deleted items count

2. **Auto-Update** - Container auto-update in Overview page (`handleAutoUpdate()`)
   - Dry-run check for available updates
   - Updates containers with `io.containers.autoupdate=registry` label

### OpenWrt-Specific Notes
- **No systemd**: OpenWrt uses **procd** init system, not systemd
- **Generate Systemd** endpoint can still be useful to generate unit files, but they need conversion to procd init scripts
- Alternative: Generate procd init scripts directly (custom implementation)

---

## Revised Top Priority Features

### Phase 1: Quick Wins (Low Complexity, High Value)

#### 1. Image Search ⭐⭐⭐ (HIGHEST PRIORITY)
**Endpoint:** `GET /libpod/images/search?term=nginx&limit=25&filters={"stars":["100"],"is-official":["true"]}`

**Why Critical:**
- Currently users must know exact image names to pull
- No way to discover available images in registries
- Essential for usability

**UI Feature:**
- Search modal/view accessible from Images page
- Input: search term, filters (official only, min stars)
- Results table: Name, Description, Stars, Official badge
- One-click "Pull" button for each result

**Implementation:**
```javascript
// New method in podman/rpc.js
image: {
    search: (term, filters) => callRPC('image_search', { term, filters })
}
```

**Backend RPC:**
```bash
# root/usr/libexec/rpcd/luci.podman
image_search() {
    local params=$(get_json_params)
    local term=$(echo "$params" | jsonfilter -e '@.term')
    local limit=$(echo "$params" | jsonfilter -e '@.limit')
    local filters=$(echo "$params" | jsonfilter -e '@.filters')

    local query="term=$(urlencode "$term")"
    [ -n "$limit" ] && query="${query}&limit=$limit"
    [ -n "$filters" ] && query="${query}&filters=$(urlencode "$filters")"

    curl_request "GET" "/libpod/images/search?$query"
}
```

**Complexity:** Medium (6-8 hours)
**Value:** Very High

---

#### 2. Container Top (Process List) ⭐⭐
**Endpoint:** `GET /libpod/containers/{name}/top?ps_args=aux`

**Why Valuable:**
- Essential for troubleshooting containers
- Monitor resource usage per process
- Identify runaway processes

**UI Feature:**
- New "Processes" tab in container detail view
- Table with columns: PID, User, CPU%, MEM%, Command
- Refresh button
- Optional: auto-refresh every 5 seconds

**Implementation:**
```javascript
// container.js - renderProcessesTab()
const processSection = this.map.section(form.TableSection, 'processes', '', _('Running Processes'));
// Columns for PID, User, CPU%, MEM%, VSZ, RSS, Command
```

**Complexity:** Low (3-4 hours)
**Value:** High

---

#### 3. Container Pause/Unpause ⭐⭐
**Endpoints:**
- `POST /libpod/containers/{name}/pause`
- `POST /libpod/containers/{name}/unpause`

**Why Valuable:**
- Freeze container without terminating processes
- Save resources temporarily
- Debugging aid (freeze state for inspection)

**UI Feature:**
- Add pause/unpause buttons to containers list toolbar
- Show "paused" state in Status column with distinct badge
- Update container detail actions

**Implementation:**
```javascript
// containers.js
customButtons: [
    { text: '⏸', handler: () => this.handlePause(), cssClass: 'apply' },
    { text: '▶️', handler: () => this.handleUnpause(), cssClass: 'positive' }
]
```

**Complexity:** Low (2-3 hours)
**Value:** High

---

#### 4. Container Changes (Filesystem Diff) ⭐
**Endpoint:** `GET /libpod/containers/{name}/changes?diffType=all`

**Why Valuable:**
- See what files changed since container started
- Useful for debugging and understanding container state
- Help decide what to commit to new image

**UI Feature:**
- New "Changes" tab in container detail view
- Table showing: Path, Change Type (Added/Modified/Deleted)
- Color coding: green=added, yellow=modified, red=deleted
- Filter by change type

**Implementation:**
- Add `container_changes` RPC method
- Create tab with GridSection
- Display changes with badges for type

**Complexity:** Low (2-3 hours)
**Value:** Medium

---

### Phase 2: Core Features (Medium Complexity, High Value)

#### 5. System Events (Real-time Updates) ⭐⭐⭐
**Endpoint:** `GET /libpod/events?stream=true&since=timestamp&filters={"type":["container","image"]}`

**Why Critical:**
- Eliminate polling overhead on OpenWrt (resource-constrained)
- Real-time UI updates across all views
- Better UX with instant feedback

**UI Feature:**
- Global event listener
- Auto-refresh list views on relevant events
- Optional: Event log viewer modal
- Toast notifications for important events

**Implementation Pattern:**
Similar to logs streaming:
- RPC method creates background curl with streaming
- Session-based event tracking
- Frontend polls for new events
- Updates views automatically

**Complexity:** Medium (8-10 hours)
**Value:** Very High

---

#### 6. Volume Export/Import ⭐⭐
**Endpoints:**
- `GET /libpod/volumes/{name}/export` - Downloads tarball
- `POST /libpod/volumes/{name}/import` - Uploads tarball

**Why Critical for OpenWrt:**
- Data backup before system updates
- Migrate volumes between devices
- Disaster recovery

**UI Feature:**
- "Backup Volume" button in volume detail → downloads .tar.gz
- "Restore Volume" button → file upload form
- Show backup metadata (date, size)

**Implementation:**
- Binary file download handling
- File upload with progress indicator
- Validation and error handling

**Complexity:** Medium (5-6 hours)
**Value:** High

---

#### 7. Image Tag/Untag ⭐
**Endpoints:**
- `POST /libpod/images/{name}/tag?repo=myrepo&tag=v1.0`
- `POST /libpod/images/{name}/untag?repo=myrepo&tag=v1.0`

**Why Useful:**
- Organize images with meaningful tags
- Version management
- Create aliases for images

**UI Feature:**
- "Add Tag" button in image detail
- Form with repository and tag inputs
- List current tags with remove buttons
- Tag format validation

**Complexity:** Low-Medium (3-4 hours)
**Value:** Medium

---

#### 8. Image Commit ⭐
**Endpoint:** `POST /libpod/commit?container=id&repo=myimage&tag=v1.0&author=name&comment=msg`

**Why Useful:**
- Create custom images from running containers
- Capture configuration changes
- Build images without Dockerfile

**UI Feature:**
- "Commit as Image" button in container detail
- Form: repository, tag, author, comment
- Option to pause container during commit
- Success notification with link to new image

**Complexity:** Medium (3-4 hours)
**Value:** Medium

---

### Phase 3: Advanced Features

#### 9. Generate Procd Init Script ⭐⭐ (OpenWrt-Specific)
**Podman Endpoint:** `GET /libpod/generate/{name}/systemd` (as reference)

**Why Critical for OpenWrt:**
- Auto-start containers on boot
- Essential for production containers
- Proper integration with OpenWrt init system

**Implementation Approach:**
1. Use Podman's systemd generation as template
2. Convert to procd format with custom logic
3. Generate procd init script format:

```bash
#!/bin/sh /etc/rc.common

START=99
STOP=10

USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command podman start <container-id>
    procd_set_param respawn
    procd_close_instance
}

stop_service() {
    podman stop <container-id>
}
```

**UI Feature:**
- "Generate Startup Script" button in container detail
- Shows generated procd init script
- Copy to clipboard button
- Instructions for installation
- Optional: Direct installation to `/etc/init.d/`

**Complexity:** Medium (6-8 hours)
**Value:** Very High for OpenWrt

---

#### 10. Image Build
**Endpoint:** `POST /libpod/build` (multipart form with Dockerfile)

**Complexity:** High (2-3 days)
**Value:** High but complex

---

#### 11. Container Exec (Interactive Console)
**Endpoints:** `POST /libpod/containers/{name}/exec` + `POST /libpod/exec/{id}/start`

**Complexity:** High (1-2 weeks) - WebSocket/terminal emulation required
**Value:** Very High but very complex

---

## Revised Implementation Priority

### Phase 1: Quick Wins (~18-20 hours, 3-4 days)
1. **Image Search** (8h) - HIGHEST PRIORITY
2. **Container Top** (4h)
3. **Container Pause/Unpause** (3h)
4. **Container Changes** (3h)

### Phase 2: Core Features (~22-26 hours, 1 week)
5. **System Events** (10h) - VERY HIGH VALUE
6. **Volume Export/Import** (6h)
7. **Image Tag/Untag** (4h)
8. **Image Commit** (4h)

### Phase 3: OpenWrt Integration (~6-8 hours)
9. **Generate Procd Init** (8h) - CRITICAL FOR PRODUCTION USE

### Phase 4: Advanced (Future)
10. Image Build
11. Container Exec
12. Container Attach
13. Image Push

---

## Removed from Plan (Already Implemented)

### ❌ Container Prune
**Reason:** Already implemented in Overview page (`handlePrune()`)
- Prunes all stopped containers
- Part of unified system cleanup

### ❌ Image Prune
**Reason:** Already implemented in Overview page (`handlePrune()`)
- Option to prune dangling images only
- Option to prune all unused images
- Shows freed space

### ❌ Volume Prune
**Reason:** Already implemented in Overview page (`handlePrune()`)
- Optional checkbox in prune dialog
- Removes unused volumes

### ❌ Network Prune
**Reason:** Already implemented in Overview page (`handlePrune()`)
- Part of system prune operation

---

## Implementation Timeline (Revised)

### Week 1: Image Discovery & Monitoring
- Image Search (8h) - Day 1-2
- Container Top (4h) - Day 2
- Container Pause/Unpause (3h) - Day 3
- Container Changes (3h) - Day 3

**Total: 18 hours**

### Week 2: Real-time Updates & Backup
- System Events (10h) - Day 1-2
- Volume Export/Import (6h) - Day 3
- Image Tag/Untag (4h) - Day 4
- Image Commit (4h) - Day 4

**Total: 24 hours**

### Week 3: OpenWrt Integration
- Generate Procd Init (8h) - Day 1-2
- Testing and refinement (4h) - Day 3
- Documentation (2h) - Day 3

**Total: 14 hours**

**Grand Total:** ~56 hours of development (2-3 weeks)

---

## Success Metrics

### After Phase 1:
- ✅ Users can discover and pull images without knowing exact names
- ✅ Monitor container processes for troubleshooting
- ✅ Pause/unpause containers for resource management
- ✅ View filesystem changes for debugging

### After Phase 2:
- ✅ Real-time UI updates without manual refresh
- ✅ Backup and restore volume data
- ✅ Organize images with tags
- ✅ Create custom images from containers

### After Phase 3:
- ✅ Auto-start containers on OpenWrt boot
- ✅ Production-ready container deployment
- ✅ Proper OpenWrt init system integration

---

## Next Steps

1. ✅ Review and approve this revised plan
2. Start with **Image Search** (highest priority, immediate user value)
3. Implement **Container Top** (quick win, high value)
4. Add **Container Pause/Unpause** (simple, useful)
5. Tackle **System Events** (eliminates polling, better performance)
6. Implement **Generate Procd Init** (critical for production use on OpenWrt)

---

## References

- Podman API Swagger: `docs/swagger-latest.yaml`
- Current Backend: `root/usr/libexec/rpcd/luci.podman`
- Overview Page: `htdocs/luci-static/resources/view/podman/overview.js`
- OpenWrt Init System: https://openwrt.org/docs/techref/initscripts
- Procd Documentation: https://openwrt.org/docs/techref/procd
