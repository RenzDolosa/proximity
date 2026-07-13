// resource/js/ea-attendancelog.js

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT LOG  — in-session ledger of every export, rendered as a sticky table
// ─────────────────────────────────────────────────────────────────────────────
const _exportLog = {
  entries: [],

  /** Inject the Export Log panel into the DOM once, lazily */
  _ensurePanel() {
    if (document.getElementById("eal-panel")) return;

    const panel = document.createElement("div");
    panel.id = "eal-panel";
    panel.innerHTML = `
      <div class="eal-header">
        <div class="eal-title">
          <span class="eal-icon">📋</span>
          <span>Export Log</span>
          <span class="eal-badge" id="eal-badge">0</span>
        </div>
        <button class="eal-clear-btn" onclick="_exportLog.clear()">
          <i class="fas fa-trash-alt"></i> Clear
        </button>
      </div>
      <div class="eal-scroll">
        <table class="eal-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Export Type</th>
              <th>Filename</th>
              <th>Records</th>
              <th>Filters Applied</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody id="eal-body">
            <tr id="eal-empty-row">
              <td colspan="8" class="eal-empty">
                <span>No exports yet.</span>
                <small>Use <strong>Export Data</strong> above to get started.</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;

    // Insert after .container (before pagination)
    const pagination = document.getElementById("pagination");
    if (pagination) {
      pagination.parentNode.insertBefore(panel, pagination);
    } else {
      document.body.appendChild(panel);
    }

    this._injectStyles();
  },

  _injectStyles() {
    if (document.getElementById("eal-styles")) return;
    const s = document.createElement("style");
    s.id = "eal-styles";
    s.textContent = `
      #eal-panel {
        margin: 28px 0 0;
        background: #fff;
        border: 1.5px solid #e2e8f0;
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 2px 12px rgba(0,0,0,.06);
        font-family: inherit;
      }
      .eal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 20px;
        background: linear-gradient(90deg, #1e3a5f 0%, #2563eb 100%);
        color: #fff;
      }
      .eal-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: .93rem;
        font-weight: 700;
        letter-spacing: .03em;
        text-transform: uppercase;
      }
      .eal-icon { font-size: 1.1rem; }
      .eal-badge {
        background: rgba(255,255,255,.25);
        border: 1.5px solid rgba(255,255,255,.4);
        border-radius: 999px;
        padding: 1px 9px;
        font-size: .72rem;
        font-weight: 800;
        min-width: 22px;
        text-align: center;
        letter-spacing: 0;
      }
      .eal-clear-btn {
        background: rgba(255,255,255,.15);
        border: 1px solid rgba(255,255,255,.35);
        border-radius: 7px;
        color: #fff;
        font-size: .78rem;
        font-weight: 600;
        padding: 5px 13px;
        cursor: pointer;
        transition: background .15s;
      }
      .eal-clear-btn:hover { background: rgba(255,255,255,.28); }
      .eal-scroll {
        overflow-x: auto;
        max-height: 340px;
        overflow-y: auto;
      }
      .eal-table {
        width: 100%;
        border-collapse: collapse;
        font-size: .83rem;
        min-width: 720px;
      }
      .eal-table thead tr {
        background: #f8fafc;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .eal-table th {
        padding: 9px 14px;
        text-align: left;
        font-weight: 700;
        font-size: .75rem;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: #64748b;
        border-bottom: 1.5px solid #e2e8f0;
        white-space: nowrap;
      }
      .eal-table td {
        padding: 10px 14px;
        border-bottom: 1px solid #f1f5f9;
        color: #334155;
        vertical-align: middle;
      }
      .eal-table tr:last-child td { border-bottom: none; }
      .eal-table tr:hover td { background: #f8fafc; }
      .eal-sn {
        font-variant-numeric: tabular-nums;
        color: #94a3b8;
        font-weight: 600;
        text-align: center;
        width: 36px;
      }
      .eal-type {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        color: #1e40af;
      }
      .eal-type .eal-type-icon {
        width: 26px; height: 26px;
        background: #dbeafe;
        border-radius: 6px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: .8rem;
      }
      .eal-filename {
        font-family: 'Courier New', monospace;
        font-size: .78rem;
        color: #475569;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .eal-records {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        color: #0f172a;
      }
      .eal-filters {
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #64748b;
        font-size: .78rem;
      }
      .eal-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border-radius: 999px;
        padding: 3px 11px;
        font-size: .73rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .eal-status-success { background: #dcfce7; color: #15803d; }
      .eal-status-failed  { background: #fee2e2; color: #b91c1c; }
      .eal-status-pending { background: #fef9c3; color: #a16207; }
      .eal-duration {
        font-variant-numeric: tabular-nums;
        color: #64748b;
        font-size: .78rem;
        white-space: nowrap;
      }
      .eal-ts {
        color: #94a3b8;
        font-size: .78rem;
        white-space: nowrap;
      }
      .eal-empty {
        text-align: center;
        padding: 36px 20px !important;
        color: #94a3b8;
      }
      .eal-empty span {
        display: block;
        font-weight: 600;
        font-size: .88rem;
        margin-bottom: 4px;
        color: #64748b;
      }
      .eal-empty small { font-size: .8rem; }

      /* Pending row animation */
      @keyframes eal-pulse {
        0%, 100% { opacity: 1; }
        50%       { opacity: .45; }
      }
      .eal-row-pending td { animation: eal-pulse 1.4s ease-in-out infinite; }
    `;
    document.head.appendChild(s);
  },

  /**
   * Add a pending entry and return its row ID so it can be resolved later.
   * @param {string} type    e.g. "Export All", "Export Filtered", "Export with Images"
   * @param {string} filters Readable filter summary, or "None"
   * @returns {string} rowId
   */
  addPending(type, filters = "None") {
    this._ensurePanel();
    const emptyRow = document.getElementById("eal-empty-row");
    if (emptyRow) emptyRow.remove();

    const id = "eal-row-" + Date.now();
    const sn = ++this.entries.length;
    const ts = new Date().toLocaleString();
    const entry = { id, type, filters, status: "pending", ts };
    this.entries.push(entry);

    const tbody = document.getElementById("eal-body");
    const tr = document.createElement("tr");
    tr.id = id;
    tr.className = "eal-row-pending";
    tr.innerHTML = `
      <td class="eal-sn">${sn}</td>
      <td><span class="eal-type"><span class="eal-type-icon">⬇️</span>${_ealEsc(type)}</span></td>
      <td class="eal-filename" title="">—</td>
      <td class="eal-records">—</td>
      <td class="eal-filters" title="${_ealEsc(filters)}">${_ealEsc(filters)}</td>
      <td><span class="eal-status-pill eal-status-pending">⏳ Exporting…</span></td>
      <td class="eal-duration">—</td>
      <td class="eal-ts">${ts}</td>`;
    tbody.insertBefore(tr, tbody.firstChild);

    this._updateBadge();
    return id;
  },

  /**
   * Resolve a pending row with final result.
   * @param {string} rowId     ID returned by addPending
   * @param {"success"|"failed"} status
   * @param {object} details   { filename, records, durationMs }
   */
  resolve(rowId, status, { filename = "—", records = 0, durationMs = 0 } = {}) {
    const tr = document.getElementById(rowId);
    if (!tr) return;
    tr.classList.remove("eal-row-pending");

    const cells = tr.querySelectorAll("td");
    const durationTx =
      durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(1)}s`;

    // filename
    cells[2].textContent = filename;
    cells[2].title = filename;
    // records
    cells[3].textContent =
      status === "success" ? Number(records).toLocaleString() : "—";
    // status
    if (status === "success") {
      cells[5].innerHTML = `<span class="eal-status-pill eal-status-success">✅ Success</span>`;
    } else {
      cells[5].innerHTML = `<span class="eal-status-pill eal-status-failed">❌ Failed</span>`;
    }
    // duration
    cells[6].textContent = durationTx;

    this._updateBadge();
  },

  clear() {
    this.entries = [];
    const tbody = document.getElementById("eal-body");
    if (tbody) {
      tbody.innerHTML = `
        <tr id="eal-empty-row">
          <td colspan="8" class="eal-empty">
            <span>No exports yet.</span>
            <small>Use <strong>Export Data</strong> above to get started.</small>
          </td>
        </tr>`;
    }
    this._updateBadge();
  },

  _updateBadge() {
    const badge = document.getElementById("eal-badge");
    if (badge) badge.textContent = this.entries.length;
  },
};

function _ealEsc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE FETCH HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch every row from the backend, bypassing pagination.
 * Passes an arbitrarily large limit so the server returns everything in one shot.
 * Optionally forwards active filter params so the server-side WHERE clause matches.
 *
 * @param {Object} filters  Key-value filter map (same shape as activeFilters in dtl.js)
 * @returns {Promise<Array>}
 */
async function fetchAllAttendanceForExport(filters = {}) {
  try {
    const params = new URLSearchParams({
      action: "get",
      page: 1,
      limit: 999999,
    });

    for (const [key, value] of Object.entries(filters)) {
      const noneMap = [
        "position",
        "brand",
        "status",
        "shift",
        "violation",
        "user_id",
      ];
      if (noneMap.includes(key) && value === "__none__") {
        params.append(key + "_none", "1");
      } else if (key === "user_id") {
        params.append("gate_name", value);
      } else {
        params.append(key, value);
      }
    }

    const response = await fetch(`${AttendanceBackend}?${params.toString()}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return data.data || [];
    } else {
      throw new Error(data.message || "Failed to fetch employee data");
    }
  } catch (error) {
    console.error("Fetch employees error:", error);
    throw error;
  }
}

// Build a readable filter summary for the log
function _filterSummary(filters) {
  const keys = Object.keys(filters);
  if (!keys.length) return "None";
  return keys.map((k) => `${k}=${filters[k]}`).join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT ENTRY POINTS  (called from button onclick in attendacelog.php)
// ─────────────────────────────────────────────────────────────────────────────

async function exportAllData() {
  showAlert("Fetching all attendance records for export…", "info");
  const rowId = _exportLog.addPending("Export All", "None");
  const t0 = Date.now();

  try {
    const rows = await fetchAllAttendanceForExport();
    if (!rows.length) {
      showAlert("No attendance records found!", "warning");
      _exportLog.resolve(rowId, "failed", { durationMs: Date.now() - t0 });
      return;
    }
    const filename = await _buildAndDownloadXlsx(rows, "All");
    _exportLog.resolve(rowId, "success", {
      filename,
      records: rows.length,
      durationMs: Date.now() - t0,
    });
    showAlert(`Exported ${rows.length} record(s) → ${filename}`, "success");
  } catch (err) {
    console.error("exportAllData:", err);
    _exportLog.resolve(rowId, "failed", { durationMs: Date.now() - t0 });
    showAlert("Export failed: " + err.message, "error");
  }
}

async function exportFilteredData() {
  const currentFilters =
    typeof activeFilters !== "undefined" ? activeFilters : {};
  const isFiltered = Object.keys(currentFilters).length > 0;

  if (!isFiltered) {
    exportAllData();
    return;
  }

  showAlert("Fetching filtered attendance records…", "info");
  const summary = _filterSummary(currentFilters);
  const rowId = _exportLog.addPending("Export Filtered", summary);
  const t0 = Date.now();

  try {
    const rows = await fetchAllAttendanceForExport(currentFilters);
    if (!rows.length) {
      showAlert("No records match the current filters!", "warning");
      _exportLog.resolve(rowId, "failed", { durationMs: Date.now() - t0 });
      return;
    }
    const filename = await _buildAndDownloadXlsx(rows, "Filtered");
    _exportLog.resolve(rowId, "success", {
      filename,
      records: rows.length,
      durationMs: Date.now() - t0,
    });
    showAlert(`Exported ${rows.length} record(s) → ${filename}`, "success");
  } catch (err) {
    console.error("exportFilteredData:", err);
    _exportLog.resolve(rowId, "failed", { durationMs: Date.now() - t0 });
    showAlert("Export failed: " + err.message, "error");
  }
}

async function exportWithImages() {
  showAlert("Preparing image export — loading engine…", "info");

  try {
    await _loadExcelJS();
  } catch (err) {
    showAlert("Could not load image export library: " + err.message, "error");
    return;
  }

  const currentFilters =
    typeof activeFilters !== "undefined" ? activeFilters : {};
  const isFiltered = Object.keys(currentFilters).length > 0;
  const exportType = isFiltered ? "Filtered" : "All";
  const summary = isFiltered ? _filterSummary(currentFilters) : "None";
  const rowId = _exportLog.addPending("Export with Images", summary);
  const t0 = Date.now();

  showAlert(`Fetching ${exportType.toLowerCase()} records…`, "info");

  let rows = [];
  try {
    rows = await fetchAllAttendanceForExport(isFiltered ? currentFilters : {});
  } catch (err) {
    showAlert("Error fetching data: " + err.message, "error");
    _exportLog.resolve(rowId, "failed", { durationMs: Date.now() - t0 });
    return;
  }

  if (!rows.length) {
    showAlert("No data found!", "warning");
    _exportLog.resolve(rowId, "failed", { durationMs: Date.now() - t0 });
    return;
  }

  showAlert("Matching employee images…", "info");
  let qrImageMap = {};
  try {
    qrImageMap = await buildQRToImageMap();
  } catch (e) {
    /* non-fatal */
  }

  showAlert(`Building Excel with images for ${rows.length} record(s)…`, "info");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Attendance Log System";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Attendance Log");

  const ROW_HEIGHT = 55;
  const IMG_COL_WIDTH = 14;
  const IMG_PX_W = 60;
  const IMG_PX_H = 48;

  worksheet.columns = [
    { header: "SN", key: "sn", width: 5 },
    { header: "EMPID", key: "employee_id", width: 12 },
    { header: "Photo", key: "photo", width: IMG_COL_WIDTH },
    { header: "Fullname", key: "fullname", width: 26 },
    { header: "Position", key: "position", width: 22 },
    { header: "Brand / Department", key: "brand", width: 22 },
    { header: "Status", key: "status", width: 12 },
    { header: "Shift", key: "shift", width: 15 },
    { header: "Remarks", key: "violation", width: 20 },
    { header: "Proximity Code", key: "qr_code", width: 16 },
    { header: "Timestamp", key: "access_timestamp", width: 22 },
    { header: "Access Type", key: "access_type", width: 18 },
    { header: "Gate", key: "gate", width: 16 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = _thinBorderExcelJS();
  });

  let successImages = 0,
    missingImages = 0;

  for (let i = 0; i < rows.length; i++) {
    const emp = rows[i];
    const qrKey = (emp.qr_code || "").trim().toLowerCase();
    const matched = qrImageMap[qrKey] || null;

    const dataRow = worksheet.addRow({
      sn: i + 1,
      employee_id: matched ? String(matched.id) : emp.employee_id || "",
      photo: "",
      fullname: toProperCase(matched ? matched.fullname : emp.fullname || ""),
      position: toProperCase(matched ? matched.position : emp.position || ""),
      brand: toProperCase(matched ? matched.brand : emp.brand || ""),
      status: emp.status || "",
      shift: emp.shift || "",
      violation: emp.violation || "None",
      qr_code: emp.qr_code || "",
      access_timestamp: formatDate(emp.access_timestamp),
      access_type: emp.access_type || "",
      gate: emp.gate_name || emp.user_id || "",
    });

    dataRow.height = ROW_HEIGHT;
    dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border = _thinBorderExcelJS();
      cell.alignment = {
        vertical: "middle",
        horizontal: colNum === 1 ? "center" : "left",
        wrapText: false,
      };
    });

    const imgPath =
      matched && matched.image ? matched.image : emp.image || null;
    if (imgPath) {
      const imgUrl = `${window.location.origin}/../public/uploads/user/${imgPath}`;
      const imgResult = await fetchImageBase64(imgUrl);
      if (imgResult) {
        try {
          const squared = await resizeImageToSquare(
            imgResult.base64,
            imgResult.extension,
            IMG_PX_W,
          );
          const imageId = workbook.addImage({
            base64: (squared || imgResult).base64,
            extension: (squared || imgResult).extension,
          });
          worksheet.addImage(imageId, {
            tl: { col: 2.08, row: i + 1.08 },
            ext: { width: IMG_PX_W, height: IMG_PX_H },
            editAs: "oneCell",
          });
          successImages++;
        } catch (e) {
          missingImages++;
        }
      } else {
        missingImages++;
      }
    } else {
      missingImages++;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `Attendance_${exportType}_With_Images_${_dateStamp()}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  _exportLog.resolve(rowId, "success", {
    filename,
    records: rows.length,
    durationMs: Date.now() - t0,
  });

  const msg =
    missingImages > 0
      ? `Exported ${rows.length} records (${successImages} with photos, ${missingImages} without) → ${filename}`
      : `Exported ${rows.length} records with photos → ${filename}`;
  showAlert(msg, missingImages > 0 ? "warning" : "success");
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX BUILDER  (no images, SheetJS)
// ─────────────────────────────────────────────────────────────────────────────

async function _buildAndDownloadXlsx(rows, type) {
  const headers = [
    "SN",
    "EMPID",
    "Fullname",
    "Position",
    "Brand / Department",
    "Status",
    "Shift",
    "Remarks",
    "Proximity Code",
    "Timestamp",
    "Access Type",
    "Gate",
  ];

  const data = [headers].concat(
    rows.map((emp, i) => [
      String(i + 1),
      String(emp.employee_id ?? ""),
      toProperCase(emp.fullname) || "",
      toProperCase(emp.position) || "",
      toProperCase(emp.brand) || "",
      emp.status || "",
      emp.shift || "",
      emp.violation || "None",
      emp.qr_code || "",
      formatDate(emp.access_timestamp) || "",
      emp.access_type || "",
      emp.gate_name || emp.user_id || "",
    ]),
  );

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);

  ws["!cols"] = [
    { wch: 5 },
    { wch: 10 },
    { wch: 25 },
    { wch: 20 },
    { wch: 20 },
    { wch: 10 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 16 },
    { wch: 10 },
  ];

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1E3A5F" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: _thinBorderXlsx(),
    };
  }
  for (let r = 1; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      ws[addr].s = { border: _thinBorderXlsx() };
      if (c === 0)
        ws[addr].s.alignment = { horizontal: "center", vertical: "center" };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Attendance Log");
  const filename = `Attendance_Log_${type}_${_dateStamp()}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE HELPERS  (same as ea-dtl.js)
// ─────────────────────────────────────────────────────────────────────────────

function _loadExcelJS() {
  return new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve();
    const s = document.createElement("script");
    s.src =
      "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load ExcelJS"));
    document.head.appendChild(s);
  });
}

async function fetchImageBase64(url) {
  const exts = ["jpg", "jpeg", "png", "webp"];
  const base = url.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  const urls = [
    url,
    ...exts.map((e) => `${base}.${e}`).filter((u) => u !== url),
  ];

  for (const tryUrl of urls) {
    try {
      const res = await fetch(tryUrl);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) continue;
      const ext = blob.type.split("/")[1] || "jpeg";
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { base64, extension: ext === "jpeg" ? "jpeg" : ext };
    } catch {
      /* try next */
    }
  }
  return null;
}

function resizeImageToSquare(base64, extension, size = 60) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale,
        h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve({
        base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1],
        extension: "jpeg",
      });
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/${extension === "jpeg" ? "jpeg" : extension};base64,${base64}`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(ds) {
  if (!ds) return "";
  try {
    const d = new Date(ds);
    if (isNaN(d)) return ds;
    return (
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
    );
  } catch {
    return ds;
  }
}

function _dateStamp() {
  const n = new Date();
  return (
    `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}` +
    `_${String(n.getHours()).padStart(2, "0")}-${String(n.getMinutes()).padStart(2, "0")}`
  );
}

function _thinBorderXlsx() {
  const s = { style: "thin", color: { rgb: "000000" } };
  return { top: s, bottom: s, left: s, right: s };
}

function _thinBorderExcelJS() {
  const s = { style: "thin", color: { argb: "FF000000" } };
  return { top: s, bottom: s, left: s, right: s };
}

// toProperCase is already defined in attendancelog.js — guard against redeclaration
if (typeof toProperCase === "undefined") {
  function toProperCase(str) {
    if (!str) return "";
    return String(str)
      .toLowerCase()
      .replace(/(^|[\s\-,])(\w)/g, (c) => c.toUpperCase());
  }
}

// showAlert is already in attendancelog.js — guard
if (typeof showAlert === "undefined") {
  function showAlert(msg, type = "info") {
    document.querySelectorAll(".alert").forEach((a) => a.remove());
    const el = document.createElement("div");
    el.className = `alert alert-${type}`;
    el.innerHTML = `<span>${msg}</span><button style="float:right;background:none;border:none;font-size:18px;cursor:pointer;margin-left:5px;" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
    document.body.insertBefore(el, document.body.firstChild);
    setTimeout(() => {
      if (el.parentElement) el.remove();
    }, 5000);
  }
}

// Escape key closes export dropdown
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && typeof hideExportOptions === "function")
    hideExportOptions();
});
