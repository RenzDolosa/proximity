<?php
// app/services/gadgettable.php
require_once __DIR__ . '/../../config/config.php';
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gadget Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../../public/css/style.css" />
</head>

<body>

  <header class="app-header">
    <div class="header-inner">
      <div class="brand">
        <span class="brand-icon">&#11041;</span>
        <div>
          <h1 class="brand-title">GADGET TRACKER</h1>
          <p class="brand-sub">Inventory Management System</p>
        </div>
      </div>
      <div class="header-actions">
        <span id="record-count" class="badge-count">&#8212; records</span>
        <button class="btn btn-ghost" id="open-import-btn">&#11014; Import CSV</button>
        <button class="btn btn-primary" id="open-add-btn">+ Add Gadget</button>
      </div>
    </div>
  </header>

  <div class="bulk-bar" id="bulk-bar" style="display:none">
    <div class="bulk-bar-inner">
      <span id="bulk-count" class="bulk-count">0 selected</span>
      <button class="btn btn-danger btn-sm" id="bulk-delete-btn">Delete Selected</button>
      <button class="btn btn-ghost btn-sm" id="bulk-deselect-btn">&#10005; Deselect All</button>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-inner">
      <div class="search-wrap">
        <span class="search-icon">&#8981;</span>
        <input type="text" id="search-input" class="search-input" placeholder="Search user, gadget, serial, asset tag, MAC, IMEI&#8230;" />
        <button id="clear-search" class="clear-btn" tabindex="-1" title="Clear">&#10005;</button>
      </div>
      <div class="filters">
        <select id="filter-inv-status" class="filter-select">
          <option value="">All Inventory Status</option>
          <option value="Active">Active</option>
          <option value="In Stock">In Stock</option>
          <option value="In Repair">In Repair</option>
          <option value="Retired">Retired</option>
          <option value="Lost">Lost</option>
          <option value="Disposed">Disposed</option>
        </select>
        <select id="filter-status" class="filter-select">
          <option value="">All Status</option>
          <option value="Good">Good</option>
          <option value="Damaged">Damaged</option>
        </select>
      </div>
    </div>
  </div>


  <!-- ── Tabs (Warehouse + Gadget Details) ───────────────────────────────── -->
  <div class="wh-tabs-wrap" id="wh-tabs-wrap">
    <div class="wh-tabs" id="wh-tabs">
      <button class="wh-tab active" data-warehouse="__ALL__" tabindex="-1">
        <span class="wh-tab-label">All Warehouses</span>
        <span class="wh-tab-count" id="wh-count-all"></span>
      </button>
      <!-- Dynamic warehouse tabs injected here by JS -->
      <div class="wh-tab-separator"></div>
      <button class="wh-tab wh-tab--gd" id="tab-gadget-details" tabindex="-1">
        <span class="wh-tab-icon">&#9881;</span>
        <span class="wh-tab-label">Gadget Details</span>
        <span class="wh-tab-count" id="gd-tab-count"></span>
      </button>
    </div>
  </div>

  <main class="main-content" id="view-inventory">
    <div class="table-container">
      <div id="table-loading" class="table-loading" style="display:none">
        <div class="spinner"></div><span>Loading&#8230;</span>
      </div>
      <table class="data-table" id="gadget-table">
        <thead>
          <tr>
            <th class="col-check"><input type="checkbox" id="check-all" class="row-check" title="Select all on this page" /></th>
            <th class="col-actions">Actions</th>
            <th>User</th>
            <th>Role</th>
            <th>Gadget</th>
            <th>Serial No.</th>
            <th>WH Asset Tag</th>
            <th>Asset Tag</th>
            <th>MAC Address</th>
            <th>Password</th>
            <th>WH Owner</th>
            <th>Remarks</th>
            <th>Recent Resp.</th>
            <th>Description</th>
            <th>IMEI 1</th>
            <th>IMEI 2</th>
            <th>Inv. Status</th>
            <th>Warehouse</th>
            <th>Status</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody id="table-body">
          <tr>
            <td colspan="21" class="empty-cell">No records found.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination">
      <button class="pg-btn" id="prev-btn" tabindex="-1" disabled>&#8249; Prev</button>
      <div class="pg-pages" id="page-numbers"></div>
      <button class="pg-btn" id="next-btn" tabindex="-1" disabled>Next &#8250;</button>
      <select id="limit-select" class="filter-select" style="width:90px">
        <option value="10">10 / pg</option>
        <option value="15" selected>15 / pg</option>
        <option value="25">25 / pg</option>
        <option value="50">50 / pg</option>
      </select>
    </div>
  </main>

  <!-- SHARED OVERLAY — panels swap inside -->
  <div id="modal-overlay" class="modal-overlay" style="display:none">

    <!-- Panel A: Add / Edit -->
    <div class="modal" id="panel-form" style="display:none;flex-direction:column">
      <div class="modal-header">
        <h2 class="modal-title" id="modal-title">Add Gadget</h2>
        <button class="modal-close" id="modal-close">&#10005;</button>
      </div>
      <form id="gadget-form" autocomplete="off">
        <input type="hidden" id="f-id" name="id" />

        <!-- ── Gadget Autofill Search ───────────────────────────────────── -->
        <div class="gadget-search-wrap" id="gadget-search-wrap">
          <label class="gadget-search-label">&#128269; Quick-fill from Gadget Details</label>
          <div class="gadget-search-inner">
            <input type="text" id="gadget-autofill-input" class="gadget-search-input"
              placeholder="Search gadget name, serial, asset tag…" autocomplete="off" />
            <div class="gadget-dropdown" id="gadget-dropdown" style="display:none"></div>
          </div>
          <p class="gadget-search-hint">Select a gadget below to autofill matching fields</p>
        </div>

        <div class="form-grid">
          <div class="form-group"><label for="f-user">User</label><input type="text" id="f-user" name="user" /></div>
          <div class="form-group"><label for="f-role">Role</label><input type="text" id="f-role" name="role" /></div>
          <div class="form-group required"><label for="f-gadget">Gadget</label><input type="text" id="f-gadget" name="gadget" required /></div>
          <div class="form-group"><label for="f-serial">Serial Number</label><input type="text" id="f-serial" name="serial_number" /></div>
          <div class="form-group"><label for="f-wh-asset-tag">Warehouse Asset Tag</label><input type="text" id="f-wh-asset-tag" name="warehouse_asset_tag" /></div>
          <div class="form-group"><label for="f-asset-tag">Asset Tag</label><input type="text" id="f-asset-tag" name="asset_tag" /></div>
          <div class="form-group"><label for="f-mac">MAC Address</label><input type="text" id="f-mac" name="mac_address" placeholder="AA:BB:CC:DD:EE:FF" /></div>
          <div class="form-group"><label for="f-password">Password</label>
            <div class="pw-wrap"><input type="password" id="f-password" name="password" /><button type="button" class="toggle-pw" tabindex="-1">&#128065;</button></div>
          </div>
          <div class="form-group"><label for="f-wh-owner">Warehouse Owner</label><input type="text" id="f-wh-owner" name="warehouse_owner" /></div>
          <div class="form-group"><label for="f-recent">Recent Responsible</label><input type="text" id="f-recent" name="recent_responsible" /></div>
          <div class="form-group"><label for="f-imei1">IMEI 1</label><input type="text" id="f-imei1" name="imei1" maxlength="20" /></div>
          <div class="form-group"><label for="f-imei2">IMEI 2</label><input type="text" id="f-imei2" name="imei2" maxlength="20" /></div>
          <div class="form-group"><label for="f-inv-status">Inventory Status</label>
            <select id="f-inv-status" name="inventory_status">
              <option value="Active">Active</option>
              <option value="In Stock">In Stock</option>
              <option value="In Repair">In Repair</option>
              <option value="Retired">Retired</option>
              <option value="Lost">Lost</option>
              <option value="Disposed">Disposed</option>
            </select>
          </div>
          <div class="form-group"><label for="f-warehouse">Warehouse</label><input type="text" id="f-warehouse" name="warehouse" /></div>
          <div class="form-group"><label for="f-status">Status</label>
            <select id="f-status" name="status">
              <option value="Good">Good</option>
              <option value="Damaged">Damaged</option>
            </select>
          </div>
          <div class="form-group full-width"><label for="f-remarks">Remarks</label><textarea id="f-remarks" name="remarks" rows="2"></textarea></div>
          <div class="form-group full-width"><label for="f-description">Description</label><textarea id="f-description" name="description" rows="2"></textarea></div>
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="submit-btn">Save Gadget</button>
        </div>
      </form>
    </div>

    <!-- Panel B: Single Delete -->
    <div class="modal confirm-modal" id="panel-delete" style="display:none;flex-direction:column">
      <div class="confirm-icon">&#9888;</div>
      <h3 class="confirm-title">Delete Gadget?</h3>
      <p class="confirm-msg" id="confirm-msg">This action cannot be undone.</p>
      <div class="form-footer" style="justify-content:center;border-top:none;padding-top:0">
        <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-ok">Delete</button>
      </div>
    </div>

    <!-- Panel C: Bulk Delete -->
    <div class="modal confirm-modal" id="panel-bulk-delete" style="display:none;flex-direction:column">
      <div class="confirm-icon">&#128465;</div>
      <h3 class="confirm-title">Delete Selected?</h3>
      <p class="confirm-msg" id="bulk-confirm-msg">This cannot be undone.</p>
      <div class="form-footer" style="justify-content:center;border-top:none;padding-top:0">
        <button class="btn btn-ghost" id="bulk-cancel-btn">Cancel</button>
        <button class="btn btn-danger" id="bulk-confirm-ok">Delete All</button>
      </div>
    </div>

    <!-- Panel D: Import CSV -->
    <div class="modal modal-import" id="panel-import" style="display:none;flex-direction:column">
      <div class="modal-header">
        <h2 class="modal-title">Import CSV</h2>
        <button class="modal-close" id="import-close">&#10005;</button>
      </div>
      <div class="import-body">
        <div class="import-tip">
          <span>&#128161;</span>
          <div>
            <strong>Required CSV columns (header row):</strong>
            <code class="csv-cols">user, role, gadget, serial_number, warehouse_asset_tag, asset_tag, mac_address, password, warehouse_owner, remarks, recent_responsible, description, imei1, imei2, inventory_status, warehouse, status</code>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="download-template-btn">&#11015; Download Template CSV</button>
        <div class="drop-zone" id="drop-zone">
          <div class="drop-icon">&#128196;</div>
          <p class="drop-label">Drop CSV file here or <label for="csv-file-input" class="drop-browse">browse</label></p>
          <p class="drop-sub" id="drop-filename">No file chosen</p>
          <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display:none" />
        </div>
        <div id="import-preview" style="display:none">
          <div class="preview-header">
            <span id="preview-count" class="badge-count"></span>
            <span id="preview-errors" class="preview-error-badge" style="display:none"></span>
          </div>
          <div class="preview-table-wrap">
            <table class="data-table" style="font-size:.75rem">
              <thead>
                <tr id="preview-thead"></tr>
              </thead>
              <tbody id="preview-tbody"></tbody>
            </table>
          </div>
        </div>
        <div class="form-footer">
          <button class="btn btn-ghost" id="import-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="import-submit-btn" disabled>Import Records</button>
        </div>
      </div>
    </div>

    <!-- Panel E: Import CSV for Gadget Details -->
    <div class="modal modal-import" id="panel-gd-import" style="display:none;flex-direction:column">
      <div class="modal-header">
        <h2 class="modal-title">Import Gadget Details CSV</h2>
        <button class="modal-close" id="gd-import-close">&#10005;</button>
      </div>
      <div class="import-body">
        <div class="import-tip">
          <span>&#128161;</span>
          <div>
            <strong>Required CSV columns (header row):</strong>
            <code class="csv-cols">gadget, serial_number, asset_tag, mac_address, imei1, imei2, inventory_status, warehouse, status</code>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="gd-download-template-btn">&#11015; Download Template CSV</button>
        <div class="drop-zone" id="gd-drop-zone">
          <div class="drop-icon">&#128196;</div>
          <p class="drop-label">Drop CSV file here or <label for="gd-csv-file-input" class="drop-browse">browse</label></p>
          <p class="drop-sub" id="gd-drop-filename">No file chosen</p>
          <input type="file" id="gd-csv-file-input" accept=".csv,text/csv" style="display:none" />
        </div>
        <div id="gd-import-preview" style="display:none">
          <div class="preview-header">
            <span id="gd-preview-count" class="badge-count"></span>
            <span id="gd-preview-errors" class="preview-error-badge" style="display:none"></span>
          </div>
          <div class="preview-table-wrap">
            <table class="data-table" style="font-size:.75rem">
              <thead>
                <tr id="gd-preview-thead"></tr>
              </thead>
              <tbody id="gd-preview-tbody"></tbody>
            </table>
          </div>
        </div>
        <div class="form-footer">
          <button class="btn btn-ghost" id="gd-import-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="gd-import-submit-btn" disabled>Import Gadget Details</button>
        </div>
      </div>
    </div>

  </div><!-- /#modal-overlay -->

  <!-- ── Gadget Details Tab Panel ──────────────────────────────────────────── -->
  <section class="gd-section" id="view-gadget-details" style="display:none">
    <div class="gd-section-header">
      <div class="gd-section-title-wrap">
        <h2 class="gd-section-title">&#9881; Gadget Details</h2>
        <p class="gd-section-sub">Master catalog — select a gadget here to autofill the main form</p>
      </div>
      <div class="gd-header-actions">
        <span id="gd-record-count" class="badge-count">&#8212; entries</span>
        <div class="gd-search-wrap">
          <span class="search-icon">&#8981;</span>
          <input type="text" id="gd-search-input" class="search-input" placeholder="Search gadget, serial, asset tag…" />
          <button id="gd-clear-search" class="clear-btn" tabindex="-1" title="Clear">&#10005;</button>
        </div>
        <button class="btn btn-ghost btn-sm" id="gd-open-import-btn">&#11014; Import CSV</button>
        <button class="btn btn-primary btn-sm" id="gd-add-btn">+ Add Gadget Detail</button>
      </div>
    </div>

    <div class="table-container">
      <div id="gd-table-loading" class="table-loading" style="display:none">
        <div class="spinner"></div><span>Loading&#8230;</span>
      </div>
      <table class="data-table" id="gd-table">
        <thead>
          <tr>
            <th class="col-actions">Actions</th>
            <th>Gadget</th>
            <th>Serial Number</th>
            <th>Asset Tag</th>
            <th>MAC Address</th>
            <th>IMEI 1</th>
            <th>IMEI 2</th>
            <th>Inv. Status</th>
            <th>Warehouse</th>
            <th>Status</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody id="gd-table-body">
          <tr><td colspan="12" class="empty-cell">No gadget details found.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="pagination" id="gd-pagination">
      <button class="pg-btn" id="gd-prev-btn" tabindex="-1" disabled>&#8249; Prev</button>
      <div class="pg-pages" id="gd-page-numbers"></div>
      <button class="pg-btn" id="gd-next-btn" tabindex="-1" disabled>Next &#8250;</button>
      <select id="gd-limit-select" class="filter-select" style="width:90px">
        <option value="10">10 / pg</option>
        <option value="15" selected>15 / pg</option>
        <option value="25">25 / pg</option>
        <option value="50">50 / pg</option>
      </select>
    </div>
  </section>

  <!-- ── Gadget Details Overlay ──────────────────────────────────────────── -->
  <div id="gd-modal-overlay" class="modal-overlay" style="display:none">
    <div class="modal" id="gd-panel-form" style="display:flex;flex-direction:column;max-width:560px">
      <div class="modal-header">
        <h2 class="modal-title" id="gd-modal-title">Add Gadget Detail</h2>
        <button class="modal-close" id="gd-modal-close">&#10005;</button>
      </div>
      <form id="gd-form" autocomplete="off">
        <input type="hidden" id="gd-f-id" />
        <div class="form-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="form-group full-width required"><label for="gd-f-gadget">Gadget Name</label><input type="text" id="gd-f-gadget" required /></div>
          <div class="form-group"><label for="gd-f-serial">Serial Number</label><input type="text" id="gd-f-serial" /></div>
          <div class="form-group"><label for="gd-f-asset-tag">Asset Tag</label><input type="text" id="gd-f-asset-tag" /></div>
          <div class="form-group"><label for="gd-f-mac">MAC Address</label><input type="text" id="gd-f-mac" placeholder="AA:BB:CC:DD:EE:FF" /></div>
          <div class="form-group"><label for="gd-f-inv-status">Inventory Status</label>
            <select id="gd-f-inv-status">
              <option value="Active">Active</option>
              <option value="In Stock">In Stock</option>
              <option value="In Repair">In Repair</option>
              <option value="Retired">Retired</option>
              <option value="Lost">Lost</option>
              <option value="Disposed">Disposed</option>
            </select>
          </div>
          <div class="form-group"><label for="gd-f-imei1">IMEI 1</label><input type="text" id="gd-f-imei1" maxlength="20" /></div>
          <div class="form-group"><label for="gd-f-imei2">IMEI 2</label><input type="text" id="gd-f-imei2" maxlength="20" /></div>
          <div class="form-group"><label for="gd-f-warehouse">Warehouse</label><input type="text" id="gd-f-warehouse" /></div>
          <div class="form-group"><label for="gd-f-status">Status</label>
            <select id="gd-f-status">
              <option value="Good">Good</option>
              <option value="Damaged">Damaged</option>
            </select>
          </div>
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" id="gd-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="gd-submit-btn">Save</button>
        </div>
      </form>
    </div>

    <!-- Delete confirm -->
    <div class="modal confirm-modal" id="gd-panel-delete" style="display:none;flex-direction:column">
      <div class="confirm-icon">&#9888;</div>
      <h3 class="confirm-title">Delete Gadget Detail?</h3>
      <p class="confirm-msg" id="gd-confirm-msg">This cannot be undone.</p>
      <div class="form-footer" style="justify-content:center;border-top:none;padding-top:0">
        <button class="btn btn-ghost" id="gd-confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="gd-confirm-ok">Delete</button>
      </div>
    </div>
  </div>

  <div id="toast" class="toast" style="display:none"></div>
  <script src="../../public/js/app.js"></script>
</body>

</html>