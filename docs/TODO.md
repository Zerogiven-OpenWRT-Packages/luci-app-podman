# LuCI Podman App - TODO List

This document tracks planned features and enhancements for the LuCI Podman web interface.

## 📑 Table of Contents

- [Quick Wins (Low Complexity, High Value)](#-quick-wins-low-complexity-high-value)
  - [Container Pause/Unpause UI](#1-container-pauseunpause-ui)
- [Container Management](#-container-management)
  - [Smart Container Stop with Kill Fallback](#1-smart-container-stop-with-kill-fallback)
- [Pod Management](#-pod-management)
  - [Pod Detail Page](#1-pod-detail-page)
  - [Smart Pod Stop with Kill Fallback](#2-smart-pod-stop-with-kill-fallback)
- [Explicitly Excluded Features](#-explicitly-excluded-features)
- [Implementation Notes](#-implementation-notes)

---

## ⚡ Quick Wins (Low Complexity, High Value)

### 1. Container Pause/Unpause UI
**Status:** Not Started
**Complexity:** Low (1 hour)
**Priority:** ⭐⭐⭐ High (Quick win - backend already exists)
**Backend:** ✅ Already implemented (`container_pause`, `container_unpause`)

**Implementation:**
- Add Pause/Unpause buttons to container actions in list view
- Add Pause/Unpause button to container detail view
- Show pause state in container status badge
- Use existing RPC methods (no backend changes needed)

**UI Location:**
- Containers list toolbar (bulk operations)
- Container detail page (single container)

**Why Priority:** Backend already complete, only UI changes needed, provides immediate value for testing/troubleshooting containers.

---

## 🐳 Container Management

### 1. Smart Container Stop with Kill Fallback
**Status:** Not Started
**Complexity:** Medium (3 hours)
**Priority:** ⭐⭐⭐ High (Safety feature - prevents stuck containers)
**Backend:** Need to add `container_kill` RPC method

**Implementation:**
- When Stop fails, show modal: "Container failed to stop gracefully. Force kill?"
- Options: "Cancel" or "Force Kill (SIGKILL)"
- Add visual warning about data loss risk
- Handle timeout scenarios

**Backend RPC Method Needed:**
```bash
container_kill)
    get_json_params id signal
    require_param id
    signal="${signal:-SIGKILL}"  # Default to SIGKILL
    curl_request "POST" "${API_BASE}/containers/${id}/kill?signal=${signal}"
    ;;
```

**UI Flow:**
1. User clicks "Stop"
2. Stop fails → Show modal with warning
3. User confirms → Call kill endpoint
4. Refresh view

**Why Priority:** Prevents frustration when containers hang, provides safety mechanism without requiring CLI access.

---

## 📦 Pod Management

### 1. Pod Detail Page
**Status:** Not Started
**Complexity:** Medium (6 hours)
**Priority:** ⭐⭐ Medium (Improves pod management UX significantly)
**Backend:** Need `pod_top` RPC method

**Features:**
- Dedicated detail page for pods (like containers have)
- **Info Tab:** Pod metadata, status, created date
- **Containers Tab:** List of containers in pod with links
- **Processes Tab:** Show all processes running in pod containers (`pod_top`)
- **Actions:** Start, Stop, Restart, Pause, Unpause, Kill, Remove

**URL Pattern:** `/admin/podman/pod/{pod_name}`

**Backend RPC Method Needed:**
```bash
pod_top)
    get_json_params name ps_args
    require_param name
    curl_request "GET" "${API_BASE}/pods/${name}/top"
    ;;
```

**UI Implementation:**
- Create new `view/podman/pod.js` (similar to `container.js`)
- Use tabbed interface (`ui.tabs`)
- Link from pods list (make Name column clickable)
- Show pod infra container details

**Why Priority:** Provides consistent UX with container detail view, essential for users managing multi-container applications.

---

### 2. Smart Pod Stop with Kill Fallback
**Status:** Not Started
**Complexity:** Medium (1 hour - reuse container kill pattern)
**Priority:** ⭐⭐ Medium (Same as container kill, but for pods)
**Backend:** Need to add `pod_kill` RPC method

**Implementation:**
- Same pattern as container kill fallback
- Handle pod-level stop failures
- Show modal with warning for all containers in pod

**Backend RPC Method Needed:**
```bash
pod_kill)
    get_json_params name signal
    require_param name
    signal="${signal:-SIGKILL}"
    curl_request "POST" "${API_BASE}/pods/${name}/kill?signal=${signal}"
    ;;
```

**Why Priority:** Essential for pod management, should be implemented together with container kill for consistency.

**Recommended Implementation Order (by priority/effectiveness):**
1. **Container Pause/Unpause UI** (1h) - Quick win, backend exists
2. **Smart Container Stop with Kill Fallback** (3h) - High safety value
3. **Image Search** (4h) - High user value for discovery
4. **Smart Pod Stop with Kill Fallback** (1h) - Consistency with containers
5. **Pod Detail Page** (6h) - Complete pod management UX
6. **Generate Procd Init Script** (8-10h) - Production deployment feature

---

## 🚫 Explicitly Excluded Features

The following features were considered but explicitly excluded:

### Prune Operations
- ❌ Container Prune - Already available via System Prune in Overview
- ❌ Image Prune - Already available via System Prune in Overview
- ❌ Network Prune - Already available via System Prune in Overview
- ❌ Volume Prune - Already available via System Prune in Overview
- ❌ Pod Prune - Already available via System Prune in Overview

**Reason:** Global system prune in overview.js handles all cleanup operations

### Image Management
- ❌ Image Tag - Not needed for typical use cases
- ❌ Image History - Not needed for typical use cases

**Reason:** Low value for typical OpenWrt/embedded use cases

### Advanced Features
- ❌ Container Exec - Too complex, SSH/CLI available
- ❌ Container Archive (Copy Files) - Too complex UI
- ❌ Container Checkpoint/Restore - May not work on OpenWrt (needs CRIU)
- ❌ Image Build - Too complex, build elsewhere and pull
- ❌ Generate Systemd Units - OpenWrt doesn't use systemd
- ❌ Manifest Management - Too niche
- ❌ System Events (Real-time Updates) - Events disabled on system (`events_logger = "none"`)

---

## 📝 Implementation Notes

### Development Workflow
1. **One task at a time** - Complete, commit, and test before moving to next
2. **Backend first** - Add RPC methods and test with `ubus call`
3. **Upload and restart** - `scp` files and restart rpcd
4. **Manual testing** - User tests each feature before proceeding
5. **Commit when working** - Git commit after successful test

### Code Quality Standards
- Follow existing patterns in codebase
- Use LuCI form components (no custom HTML tables)
- Use `podman.ui` components (pui.Button, pui.MultiButton)
- Use `podman.list` helper for list views
- Use arrow functions for callbacks, `function` for lifecycle methods
- Add JSDoc comments for new functions
- Update ACL permissions for new RPC methods

### Testing Checklist
- [ ] RPC method works via `ubus call`
- [ ] UI renders correctly
- [ ] Actions complete successfully
- [ ] Error handling works (show proper error messages)
- [ ] Success notifications appear
- [ ] View refreshes after action
- [ ] No console errors
- [ ] Works on actual OpenWrt device (not just dev machine)
