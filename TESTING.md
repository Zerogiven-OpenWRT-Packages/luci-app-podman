# LuCI App Podman - Testing Plan

This document provides a comprehensive testing plan for validating all features of the LuCI Podman application.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Test Environment Setup](#test-environment-setup)
- [Test Execution](#test-execution)
  - [1. Installation & Access](#1-installation--access)
  - [2. System Overview](#2-system-overview)
  - [3. Container Management](#3-container-management)
  - [4. Image Management](#4-image-management)
  - [5. Volume Management](#5-volume-management)
  - [6. Network Management](#6-network-management)
  - [7. Pod Management](#7-pod-management)
  - [8. Secret Management](#8-secret-management)
  - [9. Error Handling](#9-error-handling)
  - [10. Performance & Stability](#10-performance--stability)
- [Test Results Template](#test-results-template)
- [Known Issues](#known-issues)

## Prerequisites

### System Requirements
- OpenWrt 24.10.x installed
- Podman 4.0+ installed and configured
- LuCI web interface accessible
- Sufficient storage space (minimum 2GB recommended)

### Required Packages
```bash
opkg update
opkg install podman
opkg install luci-app-podman
```

### Verify Podman Service
```bash
# Check Podman is running
/etc/init.d/podman status

# Verify socket exists
ls -l /run/podman/podman.sock

# Test Podman CLI
podman version
podman info
```

## Test Environment Setup

### Sample Test Images
Pull these images for testing:

```bash
# Small test image (~5MB)
podman pull alpine:latest

# Web server (~150MB)
podman pull nginx:alpine

# Database (~400MB)
podman pull redis:alpine
```

### Test Data Preparation
Create test files for volume mounting:

```bash
mkdir -p /tmp/test-data
echo "Hello from OpenWrt" > /tmp/test-data/test.txt
```

## Test Execution

### 1. Installation & Access

#### Test 1.1: Package Installation
- [ ] Install `luci-app-podman` package
- [ ] Verify no installation errors
- [ ] Check all files installed in correct locations
- [ ] Verify ACL file: `/usr/share/rpcd/acl.d/luci-app-podman.json`
- [ ] Verify RPC backend: `/usr/libexec/rpcd/luci.podman`
- [ ] Restart rpcd: `/etc/init.d/rpcd restart`

**Expected**: Package installs without errors, all files present

#### Test 1.2: Web Interface Access
- [ ] Navigate to LuCI → System → Podman
- [ ] Verify menu item appears
- [ ] Access overview page without errors
- [ ] Check console for JavaScript errors (F12)

**Expected**: Interface loads successfully, no errors in browser console

#### Test 1.3: RPC Backend Connectivity
```bash
# Test RPC methods
ubus call luci.podman version '{}'
ubus call luci.podman info '{}'
ubus call luci.podman containers_list '{"query":"all=true"}'
```

- [ ] All RPC calls return valid JSON
- [ ] No "Access denied" errors
- [ ] Version shows correct Podman version

**Expected**: All RPC calls succeed, valid data returned

---

### 2. System Overview

#### Test 2.1: Dashboard Display
- [ ] Navigate to Overview page
- [ ] Verify Podman version displayed
- [ ] Check resource counts (containers, images, volumes, networks, pods, secrets)
- [ ] Verify disk usage statistics shown

**Expected**: All system information displayed correctly

#### Test 2.2: System Prune
- [ ] Create unused resources (stopped container, unused image)
- [ ] Click "Prune System" button
- [ ] Select options (all images, volumes)
- [ ] Confirm prune operation
- [ ] Verify unused resources removed

**Expected**: Prune completes successfully, disk space reclaimed

#### Test 2.3: Auto-Update
- [ ] Create container with auto-update label: `io.containers.autoupdate=registry`
- [ ] Click "Auto Update" button
- [ ] Verify update check runs
- [ ] Check notification for results

**Expected**: Auto-update runs without errors

---

### 3. Container Management

#### Test 3.1: Container List View
- [ ] Navigate to Containers page
- [ ] Verify all containers listed with correct status
- [ ] Check status badges (running=green, stopped=gray, etc.)
- [ ] Test "Select All" checkbox
- [ ] Verify container names are clickable links

**Expected**: All containers displayed with correct information

#### Test 3.2: Create Simple Container
- [ ] Click "Create" button
- [ ] Enter name: `test-alpine`
- [ ] Enter image: `alpine:latest`
- [ ] Enter command: `/bin/sh -c "sleep 3600"`
- [ ] Click "Create"
- [ ] Verify success notification
- [ ] Check container appears in list

**Expected**: Container created successfully

#### Test 3.3: Create Container with Port Mapping
- [ ] Click "Create" button
- [ ] Name: `test-nginx`
- [ ] Image: `nginx:alpine`
- [ ] Add port mapping: Host `8080` → Container `80`
- [ ] Click "Create"
- [ ] Start container
- [ ] Verify port accessible: `curl http://localhost:8080`

**Expected**: Container accessible on mapped port

#### Test 3.4: Create Container with Environment Variables
- [ ] Create container: `test-redis`
- [ ] Image: `redis:alpine`
- [ ] Add environment variable: `REDIS_PASSWORD=test123`
- [ ] Create and start container
- [ ] Inspect container, verify env var present

**Expected**: Environment variables set correctly

#### Test 3.5: Create Container with Volume Mount
- [ ] Create container: `test-volume`
- [ ] Image: `alpine:latest`
- [ ] Command: `/bin/sh -c "cat /data/test.txt && sleep 3600"`
- [ ] Add volume: Host `/tmp/test-data` → Container `/data`
- [ ] Create and start container
- [ ] Check logs: should show "Hello from OpenWrt"

**Expected**: Volume mounted and accessible

#### Test 3.6: Container Lifecycle Operations
- [ ] Select stopped container
- [ ] Click "Start" → verify starts successfully
- [ ] Click "Restart" → verify restarts
- [ ] Click "Stop" → verify stops
- [ ] Click "Remove" → verify removed after confirmation

**Expected**: All lifecycle operations work correctly

#### Test 3.7: Bulk Operations
- [ ] Select multiple containers (2+)
- [ ] Click "Start Selected" → verify all start
- [ ] Click "Stop Selected" → verify all stop
- [ ] Click "Remove Selected" → verify confirmation dialog shows count
- [ ] Confirm → verify all removed

**Expected**: Bulk operations affect all selected containers

#### Test 3.8: Container Detail View - Info Tab
- [ ] Click on running container name
- [ ] Verify Info tab loads
- [ ] Check all sections: Basic Info, Configuration, Network, Environment, Mounts
- [ ] Verify container name is editable
- [ ] Change name → verify update works
- [ ] Verify restart policy is editable
- [ ] Change restart policy → verify update works

**Expected**: All container information displayed correctly, edits work

#### Test 3.9: Container Detail View - Resources Tab
- [ ] Navigate to Resources tab
- [ ] Set CPU Limit: `1.0`
- [ ] Set Memory Limit: `512m`
- [ ] Set CPU Shares: `512`
- [ ] Click "Update Resources"
- [ ] Verify success notification
- [ ] Verify tab remains on Resources (not switching back to Info)
- [ ] Inspect container → verify limits applied

**Expected**: Resource limits updated without container restart

#### Test 3.10: Container Detail View - Stats Tab
- [ ] Navigate to Stats tab with running container
- [ ] Verify CPU usage displayed
- [ ] Verify Memory usage and limit displayed
- [ ] Verify Memory percentage displayed
- [ ] Verify Network I/O displayed
- [ ] Verify Block I/O displayed
- [ ] Verify PIDs count displayed

**Expected**: All stats update and display correctly

#### Test 3.11: Container Detail View - Logs Tab (Non-Streaming)
- [ ] Navigate to Logs tab
- [ ] Set Lines: `100`
- [ ] Click "Refresh"
- [ ] Verify logs appear
- [ ] Test "Clear" button
- [ ] Verify logs cleared

**Expected**: Logs load and display correctly

#### Test 3.12: Container Detail View - Logs Tab (Live Streaming)
- [ ] Start container that generates logs (e.g., nginx)
- [ ] Navigate to Logs tab
- [ ] Enable "Live Stream" checkbox
- [ ] Verify initial logs load
- [ ] Generate new logs: `podman exec <container> sh -c "echo 'Test log message'"`
- [ ] Verify NEW logs appear in real-time (without old logs duplicating)
- [ ] Disable "Live Stream" checkbox
- [ ] Verify streaming stops

**Expected**: Only NEW logs appear during streaming, no duplication

#### Test 3.13: Container Detail View - Logs Stream Cleanup
- [ ] Enable "Live Stream"
- [ ] Verify session created: `ls /tmp/podman_logs_*`
- [ ] Disable "Live Stream"
- [ ] Verify session files cleaned up immediately
- [ ] Enable "Live Stream" again
- [ ] Close browser tab/window (do NOT disable stream)
- [ ] Wait 6+ minutes
- [ ] Check for orphaned files: `ls /tmp/podman_logs_*`

**Expected**: Manual stop cleans immediately, orphaned sessions cleaned by cron

#### Test 3.14: Container Network Management
- [ ] Create a custom bridge network (see Network tests)
- [ ] In container detail, go to Info tab
- [ ] Use "Connect to" dropdown → select network
- [ ] Optionally enter static IP
- [ ] Click "Connect"
- [ ] Verify network appears in connections list
- [ ] Click "Disconnect" on network
- [ ] Confirm → verify network removed

**Expected**: Connect/disconnect operations work correctly

---

### 4. Image Management

#### Test 4.1: Image List View
- [ ] Navigate to Images page
- [ ] Verify all images listed
- [ ] Check image details: Repository, Tag, ID (short), Size, Created
- [ ] Test "Select All" checkbox

**Expected**: All images displayed with correct information

#### Test 4.2: Pull Image (Simple)
- [ ] Click "Pull Image" button
- [ ] Enter image: `busybox:latest`
- [ ] Click "Pull"
- [ ] Verify streaming progress modal appears
- [ ] Wait for completion
- [ ] Verify success notification
- [ ] Verify image appears in list

**Expected**: Image pulls successfully with progress feedback

#### Test 4.3: Pull Image (Private Registry)
- [ ] Try pulling from authenticated registry
- [ ] Verify auth error handled gracefully
- [ ] Note: This test requires registry credentials

**Expected**: Clear error message if auth fails

#### Test 4.4: Image Inspection
- [ ] Click "Inspect" icon on an image
- [ ] Verify modal shows JSON data
- [ ] Check fields: Config, Architecture, OS, Layers
- [ ] Close modal

**Expected**: Image details displayed correctly

#### Test 4.5: Remove Single Image
- [ ] Select unused image (not referenced by containers)
- [ ] Click "Remove"
- [ ] Confirm deletion
- [ ] Verify image removed from list

**Expected**: Image removed successfully

#### Test 4.6: Remove Image with Force
- [ ] Create container from image
- [ ] Try removing image (should fail)
- [ ] Try with "Force" option checked
- [ ] Verify image and container removed

**Expected**: Force removal works correctly

#### Test 4.7: Bulk Image Operations
- [ ] Select multiple images
- [ ] Click "Remove Selected"
- [ ] Verify confirmation shows count
- [ ] Confirm → verify all removed

**Expected**: Bulk removal works correctly

---

### 5. Volume Management

#### Test 5.1: Volume List View
- [ ] Navigate to Volumes page
- [ ] Verify all volumes listed
- [ ] Check volume details: Name, Driver, Mount Point, Created
- [ ] Test "Select All" checkbox

**Expected**: All volumes displayed correctly

#### Test 5.2: Create Simple Volume
- [ ] Click "Create Volume" button
- [ ] Enter name: `test-volume`
- [ ] Select driver: `local`
- [ ] Click "Create"
- [ ] Verify success notification
- [ ] Verify volume appears in list

**Expected**: Volume created successfully

#### Test 5.3: Create Volume with Labels
- [ ] Create volume: `test-labels`
- [ ] Add label: Key `environment`, Value `testing`
- [ ] Add label: Key `project`, Value `luci-podman`
- [ ] Create volume
- [ ] Inspect volume → verify labels present

**Expected**: Labels saved correctly

#### Test 5.4: Create Volume with Options
- [ ] Create volume with custom mount options
- [ ] Driver: `local`
- [ ] Add option: Key `type`, Value `tmpfs`
- [ ] Create volume
- [ ] Verify volume created

**Expected**: Volume with options created successfully

#### Test 5.5: Volume Inspection
- [ ] Click "Inspect" on a volume
- [ ] Verify JSON data displayed
- [ ] Check fields: Name, Driver, Mountpoint, Options, Labels

**Expected**: Volume details correct

#### Test 5.6: Remove Volume
- [ ] Create unused volume
- [ ] Click "Remove"
- [ ] Confirm → verify removed

**Expected**: Volume removed successfully

#### Test 5.7: Remove Volume in Use
- [ ] Create container with volume mount
- [ ] Try removing volume (should fail)
- [ ] Stop/remove container
- [ ] Try again → should succeed

**Expected**: Volume removal prevented when in use

#### Test 5.8: Bulk Volume Operations
- [ ] Create multiple test volumes
- [ ] Select all test volumes
- [ ] Click "Remove Selected"
- [ ] Confirm → verify all removed

**Expected**: Bulk removal works

---

### 6. Network Management

#### Test 6.1: Network List View
- [ ] Navigate to Networks page
- [ ] Verify all networks listed
- [ ] Check: Name, Driver, Subnet, Gateway, IPv6, OpenWrt status
- [ ] Test "Select All" checkbox

**Expected**: All networks displayed correctly

#### Test 6.2: Create Simple Bridge Network
- [ ] Click "Create Network" button
- [ ] Enter name: `test-bridge`
- [ ] Select driver: `bridge`
- [ ] Enter subnet: `172.20.0.0/24`
- [ ] Enter gateway: `172.20.0.1`
- [ ] **UNCHECK** "Setup OpenWrt Integration"
- [ ] Click "Create"
- [ ] Verify success notification
- [ ] Verify network appears in list
- [ ] Verify OpenWrt column shows `—` (no integration)

**Expected**: Network created without OpenWrt integration

#### Test 6.3: Create Network with OpenWrt Integration
- [ ] Click "Create Network"
- [ ] Name: `test-openwrt`
- [ ] Driver: `bridge`
- [ ] Subnet: `172.21.0.0/24`
- [ ] Gateway: `172.21.0.1`
- [ ] **CHECK** "Setup OpenWrt Integration"
- [ ] Optional: Change bridge name to `testbr0`
- [ ] Click "Create"
- [ ] Verify success notification
- [ ] Verify network in list
- [ ] Verify OpenWrt column shows `✓` (green)
- [ ] Verify in OpenWrt:
  ```bash
  # Check device
  cat /etc/config/network | grep -A 5 "config device.*testbr0"

  # Check interface
  cat /etc/config/network | grep -A 5 "config interface 'test-openwrt'"

  # Check firewall zone
  cat /etc/config/firewall | grep -A 7 "config zone.*test-openwrt"

  # Check DNS rule
  cat /etc/config/firewall | grep -A 5 "Allow-test-openwrt-DNS"
  ```

**Expected**: Full OpenWrt integration configured correctly

#### Test 6.4: Setup Integration for Existing Network
- [ ] Create network WITHOUT integration (test-existing)
- [ ] Verify OpenWrt column shows `⚠` (alert icon)
- [ ] Click on the alert icon
- [ ] Verify modal shows detected subnet/gateway
- [ ] Confirm setup
- [ ] Verify OpenWrt column updates to `✓`
- [ ] Verify OpenWrt configs created

**Expected**: Integration setup works for existing networks

#### Test 6.5: Create Network with IPv6
- [ ] Create network: `test-ipv6`
- [ ] Enable IPv6
- [ ] Enter IPv6 subnet: `fd00::/64`
- [ ] Create network
- [ ] Verify network created

**Expected**: IPv6 network created successfully

#### Test 6.6: Create Internal Network
- [ ] Create network: `test-internal`
- [ ] Check "Internal" option
- [ ] Create network
- [ ] Connect container to network
- [ ] Verify container cannot reach external networks

**Expected**: Internal network isolated correctly

#### Test 6.7: Network Inspection
- [ ] Click "Inspect" on a network
- [ ] Verify JSON data displayed
- [ ] Check: Name, Driver, Subnets, Options, Labels

**Expected**: Network details correct

#### Test 6.8: Remove Network (with OpenWrt Integration)
- [ ] Create network with OpenWrt integration
- [ ] Click "Remove"
- [ ] Verify confirmation mentions OpenWrt cleanup
- [ ] Confirm removal
- [ ] Verify network removed
- [ ] Verify OpenWrt configs cleaned up:
  ```bash
  cat /etc/config/network | grep test-network  # Should be empty
  cat /etc/config/firewall | grep test-network  # Should be empty
  ```

**Expected**: Network and OpenWrt configs removed

#### Test 6.9: Remove Network in Use
- [ ] Create network and connect container
- [ ] Try removing network (should fail)
- [ ] Disconnect container
- [ ] Try again → should succeed

**Expected**: Network removal prevented when in use

#### Test 6.10: Bulk Network Operations
- [ ] Create multiple test networks
- [ ] Select all test networks
- [ ] Click "Remove Selected"
- [ ] Verify confirmation shows OpenWrt cleanup notice
- [ ] Confirm → verify all removed
- [ ] Verify OpenWrt configs cleaned for all networks

**Expected**: Bulk removal with OpenWrt cleanup works

---

### 7. Pod Management

#### Test 7.1: Pod List View
- [ ] Navigate to Pods page
- [ ] Verify all pods listed
- [ ] Check: Name, Status, Containers, Created
- [ ] Test "Select All" checkbox

**Expected**: All pods displayed correctly

#### Test 7.2: Create Simple Pod
- [ ] Click "Create Pod" button
- [ ] Enter name: `test-pod`
- [ ] Click "Create"
- [ ] Verify success notification
- [ ] Verify pod appears in list

**Expected**: Pod created successfully

#### Test 7.3: Create Pod with Port Mappings
- [ ] Create pod: `web-pod`
- [ ] Add port mapping: Host `9080` → Container `80`
- [ ] Add port mapping: Host `9443` → Container `443`
- [ ] Create pod
- [ ] Verify pod created

**Expected**: Pod with port mappings created

#### Test 7.4: Create Pod with Hostname & Labels
- [ ] Create pod: `app-pod`
- [ ] Set hostname: `appserver`
- [ ] Add label: `environment=production`
- [ ] Create pod
- [ ] Inspect → verify hostname and labels

**Expected**: Pod created with metadata

#### Test 7.5: Pod Lifecycle Operations
- [ ] Create pod with containers
- [ ] Test "Start" → verify pod starts
- [ ] Test "Pause" → verify pod pauses
- [ ] Test "Unpause" → verify pod unpauses
- [ ] Test "Restart" → verify pod restarts
- [ ] Test "Stop" → verify pod stops
- [ ] Test "Remove" → verify pod removed after confirmation

**Expected**: All pod operations work correctly

#### Test 7.6: Pod Inspection
- [ ] Click "Inspect" on a pod
- [ ] Verify JSON data displayed
- [ ] Check: Name, ID, Containers, Networks, Resources

**Expected**: Pod details correct

#### Test 7.7: Pod Stats
- [ ] Create pod with running containers
- [ ] Navigate to pod in list
- [ ] Check if stats displayed (CPU, Memory)
- [ ] Or use inspect to check resources

**Expected**: Pod resource usage visible

#### Test 7.8: Bulk Pod Operations
- [ ] Create multiple test pods
- [ ] Select all test pods
- [ ] Test "Start Selected"
- [ ] Test "Stop Selected"
- [ ] Test "Remove Selected"

**Expected**: Bulk operations work correctly

---

### 8. Secret Management

#### Test 8.1: Secret List View
- [ ] Navigate to Secrets page
- [ ] Verify all secrets listed
- [ ] Check: Name, Driver, Created
- [ ] Test "Select All" checkbox

**Expected**: All secrets displayed correctly

#### Test 8.2: Create Secret
- [ ] Click "Create Secret" button
- [ ] Enter name: `test-secret`
- [ ] Enter data: `my-secret-password-123`
- [ ] Click "Create"
- [ ] Verify success notification
- [ ] Verify secret appears in list

**Expected**: Secret created successfully

#### Test 8.3: Secret Inspection
- [ ] Click "Inspect" on secret
- [ ] Verify metadata displayed (Name, ID, Created)
- [ ] Verify secret data is NOT shown (security)

**Expected**: Metadata shown, data hidden

#### Test 8.4: Use Secret in Container
- [ ] Create secret: `db-password` with value `supersecret`
- [ ] Create container with secret mount
- [ ] Verify container can read secret from `/run/secrets/db-password`

**Expected**: Secret accessible in container

#### Test 8.5: Remove Secret
- [ ] Create unused secret
- [ ] Click "Remove"
- [ ] Confirm → verify removed

**Expected**: Secret removed successfully

#### Test 8.6: Remove Secret in Use
- [ ] Create secret and use in container
- [ ] Try removing secret (should fail)
- [ ] Remove container
- [ ] Try again → should succeed

**Expected**: Secret removal prevented when in use

#### Test 8.7: Bulk Secret Operations
- [ ] Create multiple test secrets
- [ ] Select all test secrets
- [ ] Click "Remove Selected"
- [ ] Confirm → verify all removed

**Expected**: Bulk removal works

---

### 9. Error Handling

#### Test 9.1: Invalid Input Validation
- [ ] Try creating container with empty name → verify error
- [ ] Try creating container with invalid image → verify error
- [ ] Try creating network with invalid subnet → verify error
- [ ] Try port mapping with invalid port (e.g., `abc`) → verify error

**Expected**: Clear validation errors shown

#### Test 9.2: Network Errors
- [ ] Stop Podman service: `/etc/init.d/podman stop`
- [ ] Try any operation in LuCI
- [ ] Verify clear error: "Podman socket not found"
- [ ] Start service: `/etc/init.d/podman start`
- [ ] Verify operations work again

**Expected**: Clear error when Podman unavailable, recovery after restart

#### Test 9.3: Permission Errors
- [ ] Remove ACL file: `mv /usr/share/rpcd/acl.d/luci-app-podman.json /tmp/`
- [ ] Restart rpcd: `/etc/init.d/rpcd restart`
- [ ] Try operations → verify "Access denied" error
- [ ] Restore ACL: `mv /tmp/luci-app-podman.json /usr/share/rpcd/acl.d/`
- [ ] Restart rpcd
- [ ] Verify operations work

**Expected**: Clear error when permissions missing

#### Test 9.4: Resource Conflicts
- [ ] Try creating network with duplicate name → verify error
- [ ] Try creating volume with duplicate name → verify error
- [ ] Try creating container with duplicate name → verify error

**Expected**: Clear conflict errors

#### Test 9.5: Browser Console Errors
- [ ] Open browser console (F12)
- [ ] Navigate through all pages
- [ ] Perform various operations
- [ ] Check for JavaScript errors

**Expected**: No JavaScript errors in console

---

### 10. Performance & Stability

#### Test 10.1: Large Container List
- [ ] Create 20+ containers
- [ ] Navigate to Containers page
- [ ] Verify page loads reasonably fast (< 3 seconds)
- [ ] Test bulk operations on 10+ containers

**Expected**: Interface remains responsive

#### Test 10.2: Large Image List
- [ ] Pull 15+ different images
- [ ] Navigate to Images page
- [ ] Verify page loads efficiently

**Expected**: No performance degradation

#### Test 10.3: Long-Running Log Stream
- [ ] Start container with continuous output
- [ ] Enable live log streaming
- [ ] Let it run for 10+ minutes
- [ ] Verify no memory leaks in browser
- [ ] Verify logs continue streaming
- [ ] Stop stream → verify cleanup

**Expected**: Stable streaming, proper cleanup

#### Test 10.4: Multiple Concurrent Operations
- [ ] Start 5 containers simultaneously (bulk start)
- [ ] Pull 3 images simultaneously (if possible)
- [ ] Verify all operations complete successfully

**Expected**: Concurrent operations handled correctly

#### Test 10.5: Session Persistence
- [ ] Perform various operations
- [ ] Close browser tab
- [ ] Reopen LuCI Podman
- [ ] Verify state is current (no stale data)

**Expected**: Fresh data loaded on each visit

#### Test 10.6: Orphaned Stream Cleanup
- [ ] Start 3 log streams
- [ ] Close browser without stopping streams
- [ ] Wait 6 minutes
- [ ] Check temp files: `ls -lh /tmp/podman_logs_*`
- [ ] Verify cron cleaned up old sessions

**Expected**: Old sessions cleaned by cron (runs every 5 minutes)

---

## Test Results Template

Use this template to record test results:

```markdown
## Test Results - [Date]

**Tester**: [Name]
**OpenWrt Version**: [e.g., 24.10.0]
**Podman Version**: [e.g., 4.9.0]
**Browser**: [e.g., Chrome 120]

### Summary
- Total Tests: X
- Passed: Y
- Failed: Z
- Blocked: N/A

### Failed Tests

#### Test X.Y: [Test Name]
**Status**: FAILED
**Expected**: [Expected behavior]
**Actual**: [What actually happened]
**Error Message**: [If any]
**Steps to Reproduce**:
1. Step 1
2. Step 2
3. ...

**Screenshots**: [If applicable]
**Logs**:
```bash
[Relevant log output]
```

### Notes
[Any additional observations or comments]
```

---

## Known Issues

### Issue 1: Stats Complex Objects
**Status**: Pending Implementation
**Description**: Network I/O, Block I/O, and PIDs in Stats tab show raw JSON instead of formatted display
**Workaround**: Use `podman stats` CLI for detailed stats
**Tracking**: See TODO in CLAUDE.md

### Issue 2: Console Tab
**Status**: Not Implemented
**Description**: Console tab in container detail view shows "Terminal access coming soon..."
**Workaround**: Use `podman exec` CLI for shell access

---

## Additional Testing Scenarios

### Edge Cases
- [ ] Test with no containers/images/volumes (empty state)
- [ ] Test with very long container names (>100 chars)
- [ ] Test with special characters in names
- [ ] Test with containers that exit immediately
- [ ] Test with containers in unusual states (paused, restarting, etc.)

### Regression Testing
After any code changes, run at minimum:
- [ ] Test 1.2: Web Interface Access
- [ ] Test 3.6: Container Lifecycle Operations
- [ ] Test 3.12: Live Log Streaming
- [ ] Test 6.3: Network with OpenWrt Integration
- [ ] Test 9.2: Network Errors

### Browser Compatibility
Test on multiple browsers:
- [ ] Chrome/Chromium (latest)
- [ ] Firefox (latest)
- [ ] Safari (if on macOS)
- [ ] Edge (latest)

---

## Test Completion Checklist

After completing all tests:

- [ ] All critical features tested
- [ ] Test results documented
- [ ] Failed tests reported as issues
- [ ] Performance acceptable
- [ ] No console errors
- [ ] Documentation accurate
- [ ] Screenshots captured (if needed)
- [ ] Ready for release

---

**Note**: This testing plan should be updated as new features are added or issues are discovered.
