# LuCI Podman App - Development Notes

## Project Overview
This is a LuCI web interface application for managing Podman containers on OpenWrt. It provides a modern, user-friendly interface for container lifecycle management, resource configuration, networking, and monitoring.

## Architecture

### Frontend (JavaScript)
- **Location**: `htdocs/luci-static/resources/`
- **Framework**: LuCI JavaScript API
- **Key Components**:
  - `view/podman/containers.js` - Container list view with GridSection
  - `view/podman/container.js` - Individual container detail view with tabs
  - `podman/rpc.js` - RPC API client wrapper
  - `podman/utils.js` - Shared utilities
  - `podman/ui.js` - Custom UI components (pui.Button, pui.MultiButton)
  - `podman/container-form.js` - Container creation form

### Backend (Shell/RPC)
- **Location**: `root/usr/libexec/rpcd/luci.podman`
- **Technology**: Shell script with JSON-RPC over ubus
- **API**: Podman REST API v5.0.0 (libpod endpoints)

### Permissions
- **Location**: `root/usr/share/rpcd/acl.d/luci-app-podman.json`
- **Structure**: Separate read/write ACLs for ubus methods

## LuCI Patterns & Best Practices

### Required LuCI JS API Usage

**DO** use these official LuCI APIs:
- `ui.showModal(title, children, classes)` - Display modal dialogs
- `ui.hideModal()` - Close modals
- `ui.addNotification(title, children, classes)` - Persistent notifications (errors)
- `ui.addTimeLimitedNotification(title, children, timeout, classes)` - Auto-dismiss notifications (warnings, info)
- `ui.showIndicator(id, label, handler, style)` - Non-blocking status indicator in header
- `ui.hideIndicator(id)` - Remove status indicator
- `ui.tabs.initTabGroup(panes)` - Initialize tabbed interfaces
- `form.JSONMap(data, title, description)` - Create forms from JSON data
- `form.GridSection(datakey, title, description)` - Create grid/table displays
- `form.DummyValue(name, title)` - Read-only display fields with custom rendering

**DON'T** create custom implementations of:
- Manual table/grid HTML construction (use GridSection/TableSection)
- Custom modal dialogs (use ui.showModal)
- Custom notifications/alerts (use ui.addNotification/addTimeLimitedNotification)
- Custom tab containers (use ui.tabs)
- Custom button elements (use pui.Button/pui.MultiButton)

### Modern JavaScript Patterns

**DO**:
- Use `const` and `let` (no `var`)
- Use `function` keyword for lifecycle methods (`load`, `render`, etc.)
- Use arrow functions for callbacks and event handlers
- Avoid `L.bind()` when arrow functions work (arrow functions capture `this`)
- Use template literals for strings with variables

**Example - Form with GridSection**:
```javascript
render: function(data) {
    const view = this;
    const m = new form.JSONMap(data, _('Containers'));
    const s = m.section(form.GridSection, 'containers', null, _('Description'));

    s.anonymous = true;
    s.sortable = true;
    s.addremove = false;

    // Column with custom rendering and href property
    let o = s.option(form.DummyValue, 'Names', _('Name'));
    o.cfgvalue = (section_id, data) => {
        const container = data.containers[section_id];
        return E('strong', {}, container.Names[0]);
    };
    o.href = (section_id, data) => {
        const container = data.containers[section_id];
        return L.url('admin/podman/container', container.Id);
    };
    o.rawhtml = true;

    return m.render();
}
```

**Example - Arrow Functions vs L.bind**:
```javascript
// WRONG - unnecessary L.bind
podmanRPC.container.start(id).then(L.bind(function(result) {
    this.handleResult(result);
}, this));

// CORRECT - arrow function
podmanRPC.container.start(id).then((result) => {
    this.handleResult(result);
});

// CORRECT - arrow function in button click (using pui.Button)
new pui.Button(_('Stop'), () => this.handleStop(id), 'negative').render()
```

**Example - Notifications**:
```javascript
// CORRECT - Persistent error notification (stays until dismissed)
ui.addNotification(null, E('p', _('Failed to start container')), 'error');

// CORRECT - Timed warning/info notification (auto-dismiss after 3 seconds)
ui.addTimeLimitedNotification(null, E('p', _('No containers selected')), 3000, 'warning');
ui.addTimeLimitedNotification(null, E('p', _('Container started successfully')), 3000, 'info');

// WRONG - Using 4 parameters with addNotification
ui.addNotification(null, E('p', _('Warning')), 'warning', 3000);  // Only accepts 3 parameters!
```

### Custom UI Components (podman/ui.js)

This project includes custom UI component wrappers to simplify and standardize UI elements across the application.

**Usage**: Add `'require podman.ui as pui'` to your view file

#### pui.Button

Creates a standard LuCI button with consistent styling.

**Signature**: `new pui.Button(text, href, cssClass)`

**Parameters**:
- `text` (string): Button label text (can include HTML entities like `&#9658;` for symbols)
- `href` (string|function): URL string for navigation, or callback function for click handler
- `cssClass` (string, optional): Button style - maps to `cbi-button-{cssClass}`:
  - `'positive'` - Green/success button (e.g., Start, Create)
  - `'negative'` - Red/danger button (e.g., Stop, Delete)
  - `'remove'` - Red remove/disconnect button
  - `'save'` - Save changes button
  - `'apply'` - Apply/update button
  - `'neutral'` - Default/cancel button
  - Omit for default gray button

**Returns**: Call `.render()` to get the DOM element

**Examples**:
```javascript
// Action button with callback
new pui.Button(_('Start'), () => this.handleStart(id), 'positive').render()

// Navigation button with URL
new pui.Button(_('Back to List'), L.url('admin/podman/containers')).render()

// Button with symbol
new pui.Button('&#9658;', () => this.handleStart()).render()  // Play symbol

// Default styled button
new pui.Button(_('Refresh'), () => this.refreshData()).render()
```

**Old vs New Pattern**:
```javascript
// OLD - Manual E('button') construction
E('button', {
    'class': 'cbi-button cbi-button-negative',
    'click': () => this.handleStop(id)
}, _('Stop'))

// NEW - Using pui.Button
new pui.Button(_('Stop'), () => this.handleStop(id), 'negative').render()
```

#### pui.MultiButton

Creates a dropdown button menu using LuCI's ComboButton component. Useful for grouping related actions.

**Signature**: `new pui.MultiButton(items, cssClass)`

**Parameters**:
- `items` (array|object, optional): Initial items (usually omit and use `.addItem()`)
- `cssClass` (string, optional): Button style (same options as pui.Button)

**Methods**:
- `.addItem(text, href)` - Add menu item; returns `this` for chaining
  - `text` (string): Menu item label
  - `href` (string|function): URL or callback function
- `.render()` - Returns the DOM element

**Examples**:
```javascript
// Create button with method chaining
const createButton = new pui.MultiButton({}, 'add')
    .addItem(_('Create Container'), () => this.handleCreateContainer())
    .addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
    .addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
    .render();

// With navigation URLs
const exportButton = new pui.MultiButton({}, 'save')
    .addItem(_('Export as JSON'), () => this.exportJson())
    .addItem(_('Export as YAML'), () => this.exportYaml())
    .render();
```

**When to Use**:
- Use `pui.Button` for single actions
- Use `pui.MultiButton` for 2+ related actions that would clutter the UI
- Common use cases: Create menu, Export options, Import options

#### pui.ListViewHelper

A comprehensive helper class that encapsulates all common list view operations, eliminating code duplication across list views.

**Signature**: `new pui.ListViewHelper(options)`

**Parameters**:
- `options` (object): Configuration object
  - `prefix` (string): Checkbox name prefix (e.g., 'containers', 'images')
  - `itemName` (string): Singular item name (e.g., 'container', 'image')
  - `rpc` (object): RPC module reference (e.g., `podmanRPC.container`)
  - `data` (array): Data array from load()
  - `view` (object, optional): View context reference

**Methods**:

##### setupSelectAll(rendered)
Setup "select all" checkbox functionality for table views.
- `rendered` (HTMLElement): The rendered table container

##### getSelected(extractFn)
Get selected items from checkboxes using an extractor function.
- `extractFn` (function): Function to extract data from each selected item
- Returns: Array of extracted values

##### createToolbar(options)
Create standard toolbar with buttons for list views.
- `options` (object): Toolbar configuration
  - `onDelete` (function|null, optional): Delete handler (if null, uses default bulk delete)
  - `onCreate` (function, optional): Create handler
  - `onRefresh` (function, optional): Refresh handler
  - `customButtons` (array, optional): Additional buttons `[{text, handler, cssClass}]`
- Returns: Object with `{container, buttons, addButton, prependButton}`
  - `container` (HTMLElement): The toolbar container element
  - `buttons` (array): Array of button elements
  - `addButton(button)` (function): Helper to append buttons at the end of toolbar
  - `prependButton(button)` (function): Helper to prepend buttons at the beginning of toolbar

##### handleBulkDelete(options)
Handle bulk delete with confirmation and error handling (uses default implementation).
- `options` (object, optional): Override options for bulk delete

##### showInspect(identifier, hiddenFields, closeButtonFn)
Show inspect modal for an item.
- `identifier` (string): Item identifier (ID or name)
- `hiddenFields` (array, optional): Fields to hide (e.g., `['SecretData']`)
- `closeButtonFn` (function, optional): Custom close button renderer

**Complete Example - List View Pattern**:
```javascript
'use strict';
'require view';
'require form';
'require ui';
'require podman.rpc as podmanRPC';
'require podman.utils as utils';
'require podman.ui as pui';

return view.extend({
    handleSaveApply: null,
    handleSave: null,
    handleReset: null,

    map: null,
    listHelper: null,

    generic_failure: function(message) {
        return E('div', {
            'class': 'alert-message error'
        }, [_('RPC call failure: '), message]);
    },

    load: async () => {
        return podmanRPC.volume.list()
            .then((volumes) => {
                return { volumes: volumes || [] };
            })
            .catch((err) => {
                return { error: err.message || _('Failed to load volumes') };
            });
    },

    render: function(data) {
        if (data && data.error) {
            return this.generic_failure(data.error);
        }

        // Initialize list helper
        this.listHelper = new pui.ListViewHelper({
            prefix: 'volumes',
            itemName: 'volume',
            rpc: podmanRPC.volume,
            data: data.volumes,
            view: this
        });

        const getVolumeData = (sectionId) => data.volumes[sectionId.replace('volumes', '')];

        this.map = new form.JSONMap(data, _('Volumes'));
        const section = this.map.section(form.TableSection, 'volumes', '', _('Manage volumes'));
        let o;

        section.anonymous = true;
        section.nodescriptions = true;

        // Checkbox column for selection
        o = section.option(form.DummyValue, 'Name', new ui.Checkbox(0, { hiddenname: 'all' }).render());
        o.cfgvalue = (sectionId) => {
            return new ui.Checkbox(0, { hiddenname: sectionId }).render();
        };

        // Name column with inspect link
        o = section.option(form.DummyValue, 'VolumeName', _('Name'));
        o.cfgvalue = (sectionId) => {
            const volume = getVolumeData(sectionId);
            return E('a', {
                href: '#',
                click: (ev) => {
                    ev.preventDefault();
                    this.handleInspect(volume.Name);
                }
            }, E('strong', {}, volume.Name || _('Unknown')));
        };
        o.rawhtml = true;

        // Create toolbar using helper
        const toolbar = this.listHelper.createToolbar({
            onDelete: () => this.handleDeleteSelected(),
            onRefresh: () => this.handleRefresh(),
            onCreate: () => this.handleCreate()
        });

        return this.map.render().then((rendered) => {
            const header = rendered.querySelector('.cbi-section');
            if (header) {
                header.insertBefore(toolbar.container, header.firstChild);
            }

            // Setup "select all" checkbox using helper
            this.listHelper.setupSelectAll(rendered);

            return rendered;
        });
    },

    getSelectedVolumes: function() {
        return this.listHelper.getSelected((volume) => volume.Name);
    },

    handleDeleteSelected: function() {
        utils.handleBulkDelete({
            selected: this.getSelectedVolumes(),
            itemName: 'volume',
            deletePromiseFn: (name) => podmanRPC.volume.remove(name, false)
        });
    },

    handleRefresh: function() {
        window.location.reload();
    },

    handleCreate: function() {
        // Show create dialog
    },

    handleInspect: function(name) {
        this.listHelper.showInspect(name);
    }
});
```

**Advanced Toolbar Usage - Adding Custom Buttons**:
```javascript
// Create toolbar with custom action buttons
const toolbar = this.listHelper.createToolbar({
    onDelete: () => this.handleRemove(),
    onRefresh: undefined,  // Skip refresh button
    onCreate: undefined,   // Will add custom create menu instead
    customButtons: [
        {
            text: '&#9658;',  // Play symbol
            handler: () => this.handleStart(),
            cssClass: 'positive'
        },
        {
            text: '&#9724;',  // Stop symbol
            handler: () => this.handleStop(),
            cssClass: 'negative'
        }
    ]
});

// Add a multi-button menu to the beginning of the toolbar
const createButton = new pui.MultiButton({}, 'add')
    .addItem(_('Create Container'), () => this.handleCreateContainer())
    .addItem(_('Import from Run Command'), () => this.handleImportFromRunCommand())
    .addItem(_('Import from Compose File'), () => this.handleImportFromCompose())
    .render();

// Use prependButton to add at beginning (Create, Delete, Play, Stop)
toolbar.prependButton(createButton);

// Or use addButton to append at end (Delete, Play, Stop, Create)
// toolbar.addButton(createButton);

// Insert the toolbar into the view
return this.map.render().then((rendered) => {
    const header = rendered.querySelector('.cbi-section');
    if (header) {
        header.insertBefore(toolbar.container, header.firstChild);
    }
    this.listHelper.setupSelectAll(rendered);
    return rendered;
});
```

**Benefits**:
- Eliminates 20-40 lines of duplicated code per list view
- Consistent UX across all list views
- Centralized bug fixes and improvements
- Type-safe item extraction with custom extractFn
- Built-in bulk operations with confirmation dialogs

### Utility Functions (podman/utils.js)

Common utility functions available across all views.

**Usage**: Add `'require podman.utils as utils'` to your view file

#### utils.setupSelectAllCheckbox(rendered, prefix)
Setup "select all" checkbox functionality (usually called via ListViewHelper).

#### utils.getSelectedFromCheckboxes(prefix, dataArray, extractFn)
Get selected items from checkboxes (usually called via ListViewHelper).

#### utils.handleBulkDelete(options)
Generic bulk delete handler with confirmation and progress modal.
- `options` (object):
  - `selected` (array): Array of items to delete
  - `itemName` (string): Singular item name for messages
  - `deletePromiseFn` (function): Function that returns a promise for each delete
  - `formatItemName` (function, optional): Custom formatter for item names in messages

#### utils.showInspectModal(title, data, hiddenFields, closeButton)
Show a modal with JSON data inspection (usually called via ListViewHelper).

#### utils.formatDate(timestamp)
Format Unix timestamp to human-readable date string.

#### utils.formatBytes(bytes)
Format bytes to human-readable size (KB, MB, GB).

#### utils.truncate(str, maxLength)
Truncate string to maximum length with ellipsis.

## Podman API Integration

### REST API Version
- Using Podman libpod API v5.0.0
- Swagger documentation: Check swagger files for endpoint schemas

### Common Patterns

**Container Update Endpoint**:
```javascript
// Endpoint: POST /libpod/containers/{id}/update
// Body: JSON with update fields
const updateData = {
    RestartPolicy: policy
};
if (policy === 'on-failure') {
    updateData.RestartRetries = 5;  // Only add when needed
}
// Don't send undefined values - they serialize as strings
podmanRPC.container.update(containerId, JSON.stringify(updateData));
```

**Network Operations**:
```javascript
// Connect - use static_ips as array
const params = {
    container: containerId,
    static_ips: [ip]  // Array format
};
podmanRPC.network.connect(networkName, JSON.stringify(params));

// Disconnect - capital C for Container (per schema)
podmanRPC.network.disconnect(networkName,
    JSON.stringify({ Container: containerId }));
```

## Key Features Implemented

### Container List View (`containers.js`)
- GridSection-based table display
- Container actions: Start, Stop, Restart, Remove
- Direct links to individual container details
- Create container button with modal form
- Refresh functionality

### Container Detail View (`container.js`)
- **Multi-tab interface** using ui.tabs:
  - **Info Tab**: Basic details, editable name, restart policy
  - **Resources Tab**: CPU, memory limits (editable with save)
  - **Stats Tab**: Real-time resource usage monitoring
  - **Logs Tab**: Configurable log viewer with live streaming
  - **Console Tab**: Terminal access (if implemented)

- **Tab persistence**: After resource updates, returns to Resources tab
- **Network management**: Connect/disconnect networks with optional static IP
- **Logs features**:
  - Customizable line count (10-10000)
  - Live streaming toggle
  - Clear logs button
  - Scrollable terminal view with fixed height (600px, resizable)

### Form Handling
- Proper validation using LuCI form validators
- Error display using ui.addNotification
- Loading states with ui.showModal
- Reload after modifications to reflect changes

## Common Issues & Solutions

### Issue: Restart Policy Update Not Working
**Problem**: JavaScript `undefined` was being serialized as string "undefined"
**Solution**: Only add properties to update object when they have values
```javascript
// WRONG
const updateData = {
    RestartRetries: policy === 'on-failure' ? 5 : undefined
};

// CORRECT
const updateData = { RestartPolicy: policy };
if (policy === 'on-failure') {
    updateData.RestartRetries = 5;
}
```

### Issue: Tab Not Persisting After Save
**Solution**: Use sessionStorage to remember active tab
```javascript
// Before reload
sessionStorage.setItem('podman_active_tab', 'resources');

// On load
const savedTab = sessionStorage.getItem('podman_active_tab');
if (savedTab) {
    sessionStorage.removeItem('podman_active_tab');
    // Set data-tab-active attribute based on savedTab
}
```

### Issue: Error Handling in Views
**Problem**: Errors from `load()` method not handled gracefully in `render()`
**Solution**: Implement `generic_failure()` method and catch errors in load
```javascript
return view.extend({
    handleSaveApply: null,
    handleSave: null,
    handleReset: null,

    generic_failure: function(message) {
        return E('div', {
            'class': 'alert-message error'
        }, [_('RPC call failure: '), message]);
    },

    load: function() {
        return podmanRPC.container.list('all=true')
            .then((containers) => {
                return { containers: containers || [] };
            })
            .catch((err) => {
                return { error: err.message || _('Failed to load') };
            });
    },

    render: function(data) {
        // Check for errors from load()
        if (data && data.error) {
            return this.generic_failure(data.error);
        }
        // ... rest of render
    }
});
```

## Translation
- POT file: `po/templates/podman.pot`
- All user-facing strings wrapped in `_('String')`
- Formatted strings: `_('Failed: %s').format(error)`

## Development Workflow

1. **Check Swagger/API docs** for correct endpoint schemas
2. **Use proper LuCI components** - don't reinvent the wheel
3. **Test with real Podman** - backend requires actual podman daemon
4. **Follow existing patterns** - look at other LuCI apps for examples
5. **Keep it simple** - leverage framework instead of custom code

## References
- LuCI JS API: https://openwrt.github.io/luci/jsapi/
- LuCI UI Tabs: https://openwrt.github.io/luci/jsapi/LuCI.ui.tabs.html
- LuCI UI Notifications: https://openwrt.github.io/luci/jsapi/LuCI.ui.html#addNotification
- Example Apps: https://github.com/openwrt/luci/tree/master/applications
- Example App: https://github.com/openwrt/luci/tree/master/applications/luci-app-example
- Podman API: https://storage.googleapis.com/libpod-master-releases/swagger-latest.yaml

## Code Quality Checklist

### LuCI Framework Usage
- [ ] Using form.GridSection/TableSection for tables
- [ ] Using ui.showModal/hideModal for dialogs
- [ ] Using ui.addTimeLimitedNotification for warnings/info (3000ms timeout)
- [ ] Using ui.addNotification for persistent error messages only
- [ ] Always prefer official OpenWRT jsapi
- [ ] Use DummyValue `href` property instead of custom anchor elements

### Custom Components (pui.*)
- [ ] Using pui.Button instead of E('button') for consistency
- [ ] Using pui.MultiButton for grouped actions (2+ related items)
- [ ] Using pui.ListViewHelper for all list views
- [ ] Using toolbar.container instead of direct toolbar element
- [ ] Using toolbar.addButton() to append buttons at end
- [ ] Using toolbar.prependButton() to add buttons at beginning (for primary actions)

### Modern JavaScript
- [ ] Arrow functions for callbacks, `function` for lifecycle methods
- [ ] Const/let instead of var
- [ ] No custom HTML tables when form components exist

### Code Organization
- [ ] Implement `generic_failure()` method in views
- [ ] Catch errors in `load()` and return error objects
- [ ] Check for errors in `render()` before processing data
- [ ] Place save handlers at top of view.extend() object
- [ ] Include all necessary data (like IDs) in load() return values
- [ ] Initialize listHelper in render() before table setup
- [ ] Use utils.handleBulkDelete() instead of custom delete logic

### Translation & API
- [ ] All strings translated with _()
- [ ] Error handling with proper user feedback
- [ ] API calls match Podman swagger schemas


## OpenWrt Network Integration

### Overview

Podman networks created via the API need matching OpenWrt network/firewall configuration to function properly. This app provides **opt-in OpenWrt integration** that automatically configures:

1. **Bridge device** (`/etc/config/network`) - Virtual bridge interface
2. **Network interface** (`/etc/config/network`) - Static IP configuration
3. **Firewall zone** (`/etc/config/firewall`) - Network isolation
4. **Firewall rules** (`/etc/config/firewall`) - DNS access for containers

Without this integration, containers may not have proper network connectivity, as Podman's built-in firewall is disabled on OpenWrt (configured with `firewall_driver = "none"`).

### Architecture

**Module**: `podman/openwrt-network.js`  
**Technology**: LuCI JavaScript API (network, uci modules)  
**No RPC required**: Direct UCI/network manipulation from frontend

### Key Components

#### 1. OpenWrt Network Helper (`podman/openwrt-network.js`)

Provides integration methods using native LuCI APIs:

**Main Methods**:
- `createIntegration(networkName, options)` - Create OpenWrt config
- `removeIntegration(networkName, bridgeName)` - Remove OpenWrt config
- `hasIntegration(networkName)` - Check if integration exists
- `getIntegration(networkName)` - Get integration details
- `validateIntegration(networkName, options)` - Validate before creation

**Example Usage**:
```javascript
'require podman.openwrt-network as openwrtNetwork';

// Create integration
openwrtNetwork.createIntegration('mynetwork', {
    bridgeName: 'podman0',
    subnet: '10.129.0.0/24',
    gateway: '10.129.0.1'
}).then(() => {
    console.log('OpenWrt integration created');
});

// Check integration status
openwrtNetwork.hasIntegration('mynetwork').then((exists) => {
    if (exists) {
        console.log('Integration active');
    }
});

// Remove integration
openwrtNetwork.removeIntegration('mynetwork', 'podman0').then(() => {
    console.log('Integration removed');
});
```

#### 2. Network Creation Form (`podman/network-form.js`)

Enhanced with OpenWrt integration checkbox:

**New Form Fields**:
- `setup_openwrt` (Flag) - Enable/disable integration (default: enabled)
- `bridge_name` (Value) - Custom bridge name (default: `<network>0`)

**Workflow**:
1. User creates network with subnet/gateway
2. Checks "Setup OpenWrt Integration" (enabled by default)
3. Form validates required fields (subnet + gateway for integration)
4. Creates Podman network via RPC
5. If integration enabled, calls `openwrtNetwork.createIntegration()`
6. Displays appropriate success/warning messages

**Error Handling**:
- If Podman network fails → Show error, abort
- If Podman succeeds but OpenWrt fails → Show warning, suggest manual config
- If both succeed → Show success message

#### 3. Network List View (`networks.js`)

Enhanced with integration status column and cleanup on delete:

**New Column**: "OpenWrt" - Shows integration status
- `✓` (green) - Integration active
- `—` (gray) - No integration
- `✗` (red) - Check failed

**Status Check**: Async check for each network after rendering

**Delete Behavior**:
1. Check integration status for selected networks
2. Show confirmation with OpenWrt cleanup notice
3. Delete Podman network
4. If integration exists, remove OpenWrt configs
5. Display results (Podman deleted, OpenWrt cleanup status)

### User Workflow

#### Creating a Network with OpenWrt Integration

1. Navigate to **Networks** → **Create Network**
2. Enter network details:
   - Name: `mynetwork`
   - Subnet: `10.129.0.0/24`
   - Gateway: `10.129.0.1`
3. Ensure **Setup OpenWrt Integration** is checked (default)
4. Optional: Customize **Bridge Interface Name** (default: `mynetwork0`)
5. Click **Create**

**Result**:
- Podman network `mynetwork` created
- Bridge device `mynetwork0` created
- Network interface `mynetwork` with IP `10.129.0.1` created
- Firewall zone `mynetwork` created with restrictive rules
- DNS access rule created (containers can resolve DNS)
- Container network traffic properly routed

#### Deleting a Network with OpenWrt Integration

1. Navigate to **Networks**
2. Select networks to delete (OpenWrt column shows `✓` for integrated networks)
3. Click **Delete Selected**
4. Confirm deletion (notice mentions OpenWrt cleanup)
5. System removes:
   - Podman network
   - Firewall rules
   - Firewall zone
   - Network interface
   - Bridge device (if not used by other networks)

### Technical Details

#### UCI Configuration Created

**Network Device** (`/etc/config/network`):
```
config device
	option type 'bridge'
	option name 'mynetwork0'
	option bridge_empty '1'
	option ipv6 '0'
```

**Network Interface** (`/etc/config/network`):
```
config interface 'mynetwork'
	option proto 'static'
	option device 'mynetwork0'
	option ipaddr '10.129.0.1'
	option netmask '255.255.255.0'
```

**Firewall Zone** (`/etc/config/firewall`):
```
config zone
	option name 'mynetwork'
	option input 'DROP'
	option output 'ACCEPT'
	option forward 'REJECT'
	list network 'mynetwork'
```

**Firewall DNS Rule** (`/etc/config/firewall`):
```
config rule
	option name 'Allow-mynetwork-DNS'
	option src 'mynetwork'
	option dest_port '53'
	option target 'ACCEPT'
```

#### LuCI API Usage

The module uses official LuCI JavaScript APIs (no shell scripts):

**Network API**:
- `network.flushCache()` - Reload network state
- `network.prefixToMask(prefix)` - Convert CIDR to netmask

**UCI API**:
- `uci.load(packages)` - Load configs (network, firewall)
- `uci.add(conf, type, name)` - Create new section
- `uci.set(conf, sid, opt, val)` - Set option value
- `uci.get(conf, sid, opt)` - Get option value
- `uci.sections(conf, type)` - List sections
- `uci.remove(conf, sid)` - Remove section
- `uci.save()` - Save changes to ubus
- `uci.apply(timeout)` - Apply changes with rollback protection

**Benefits**:
- ✅ No shell script dependencies
- ✅ Proper Promise-based error handling
- ✅ Automatic UCI transaction management
- ✅ Rollback protection on apply
- ✅ Type-safe JavaScript code

### Configuration Requirements

For proper OpenWrt integration, ensure `/etc/containers/containers.conf` contains:

```
[network]
network_backend = "netavark"
firewall_driver = "none"
network_config_dir = "/etc/containers/networks/"
default_network = "podman"
default_subnet = "10.129.0.0/24"
```

**Important**: `firewall_driver = "none"` disables Podman's built-in firewall, requiring OpenWrt firewall configuration.

### Troubleshooting

**Problem**: Container can't resolve DNS  
**Solution**: Check if DNS rule exists in firewall. Integration creates rule allowing containers to access port 53.

**Problem**: Container can't reach external networks  
**Solution**: Check firewall zone configuration. Integration sets `output = ACCEPT` for outbound traffic.

**Problem**: OpenWrt integration fails with "already exists"  
**Solution**: Network interface name conflicts with existing config. Choose different network name or manually remove conflicting config.

**Problem**: Bridge device not created  
**Solution**: Check UCI apply status. Integration uses 90-second rollback timeout. May need manual UCI commit.

**Problem**: After network deletion, bridge still exists  
**Solution**: Bridge is shared if multiple networks use same device. Integration only removes bridge when no other interfaces use it.

### Best Practices

1. **Always enable OpenWrt integration** for bridge networks on OpenWrt
2. **Use descriptive network names** (e.g., `frontend`, `backend`, not `net1`)
3. **Plan subnet ranges** to avoid conflicts with existing networks
4. **Test with one container** before deploying multiple containers
5. **Document custom firewall rules** if you modify the generated zone
6. **Backup configs** before bulk network operations
7. **Check integration status** column before deleting networks

### Future Enhancements

Potential improvements for OpenWrt integration:

- [ ] Support for custom firewall rules in creation form
- [ ] Integration with OpenWrt firewall zones (forward to lan/wan)
- [ ] IPv6 support
- [ ] Port forwarding configuration UI
- [ ] Network traffic statistics
- [ ] Automatic detection and repair of broken integrations
- [ ] Bulk integration setup for existing networks
- [ ] Integration status details modal (show UCI config)
- [ ] Custom netmask/CIDR calculation in form
- [ ] Bridge STP configuration options

## OpenWrt Network Integration - Shared Zone Architecture

### Zone Management Strategy

The implementation uses a **shared firewall zone** approach for all Podman networks:

**Shared Zone Benefits:**
- ✅ Simpler management - one zone, one DNS rule for all Podman networks
- ✅ Less UCI configuration clutter
- ✅ Consistent with Docker's single-zone approach
- ✅ Easier to enable inter-network communication if needed
- ✅ Podman networks already have Layer 2 isolation via separate bridges

**Zone Name:** `podman` (fixed, shared by all integrated networks)

**Workflow:**

**Creating First Network:**
1. Create Podman network
2. Create bridge device
3. Create network interface
4. Create shared `podman` firewall zone
5. Create DNS rule for `podman` zone (once)
6. Add network to zone's network list

**Creating Subsequent Networks:**
1. Create Podman network
2. Create bridge device
3. Create network interface
4. Add network to existing `podman` zone's network list

**Deleting Network:**
1. Delete Podman network
2. Remove network from `podman` zone's network list
3. Delete network interface
4. Delete bridge device (if not used by others)
5. If last network removed: Delete `podman` zone and DNS rule

**UCI Configuration (Shared Zone):**

```
config zone 'podman_zone'
	option name 'podman'
	option input 'DROP'
	option output 'ACCEPT'
	option forward 'REJECT'
	list network 'frontend'
	list network 'backend'
	list network 'database'

config rule 'podman_dns'
	option name 'Allow-Podman-DNS'
	option src 'podman'
	option dest_port '53'
	option target 'ACCEPT'
```

### Alert Icon for Incomplete Integration

Networks without complete OpenWrt integration show a **warning icon (⚠)** next to their name:

**Detection:**
- Checks for: device, interface, and zone membership
- Missing any component → Shows alert icon

**Click Behavior:**
1. Extracts subnet/gateway from Podman network data
2. Shows confirmation modal with detected configuration
3. On confirm: Creates all missing components
4. On success: Hides alert icon (in-place update)
5. User sees immediate feedback without page reload

**User Experience:**
```
Network List:
  [✓] frontend     bridge  10.10.0.0/24   10.10.0.1  ...
  [✓] backend ⚠    bridge  10.20.0.0/24   10.20.0.1  ...
           ↑
  Click here to setup OpenWrt integration
```

**Tooltip:** "OpenWrt integration incomplete. Click to setup. Missing: device, zone_membership"

This provides a seamless way to fix networks that were created before the integration feature was added or where integration failed partially.
