// resource/js/exportAll-datalog.js --> datalog table export all

// ─────────────────────────────────────────────────────────────────────────────
// CORE FETCH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch every row from the backend, bypassing pagination.
 * Passes an arbitrarily large limit so the server returns everything in one shot.
 * Optionally forwards active filter params so the server-side WHERE clause matches.
 *
 * @param {Object} filters  Key-value filter map (same shape as activeFilters in dtl.js)
 * @returns {Promise<Array>}
 */
async function fetchAllEmployeesForExport(filters = {}) {
  try {
    const params = new URLSearchParams({
      action: "get",
      page: 1,
      limit: 999999,
      filter_options: "0"
    });

    for (const [key, value] of Object.entries(filters)) {
      if (key === "position" && value === "__none__") {
        params.append("position_none", "1");
      } else if (key === "brand" && value === "__none__") {
        params.append("brand_none", "1");
      } else if (key === "status" && value === "__none__") {
        params.append("status_none", "1");
      } else if (key === "shift" && value === "__none__") {
        params.append("shift_none", "1");
      } else if (key === "violation" && value === "__none__") {
        params.append("violation_none", "1");
      } else if (key === "user_id" && value === "__none__") {
        params.append("user_id_none", "1");
      } else if (key === "user_id") {
        params.append("gate_name", value);
      } else {
        params.append(key, value);
      }
    }

    const response = await fetch(`${AccessLogBackend}?${params.toString()}`, {
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────
async function exportAllData() {
  showAlert("Fetching all data for export…", "info");

  try {
    const allEmployees = await fetchAllEmployeesForExport();

    if (!allEmployees || allEmployees.length === 0) {
      showAlert("No employee data found!", "warning");
      return;
    }

    await exportEmployeeData(allEmployees, "All");
  } catch (error) {
    console.error("Export all data error:", error);
    showAlert("Error exporting all data: " + error.message, "error");
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

  showAlert("Fetching all filtered data for export…", "info");

  try {
    const filteredEmployees = await fetchAllEmployeesForExport(currentFilters);

    if (!filteredEmployees || filteredEmployees.length === 0) {
      showAlert("No filtered employee data found!", "warning");
      return;
    }

    await exportEmployeeData(filteredEmployees, "Filtered");
  } catch (error) {
    console.error("Export filtered data error:", error);
    showAlert("Error exporting filtered data: " + error.message, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX EXPORT (no images)
// ─────────────────────────────────────────────────────────────────────────────
function toProperCase(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/(^|[\s\-,])(\w)/g, (char) => char.toUpperCase());
}

/**
 * Build and download an .xlsx file from an employee array.
 *
 * @param {Array}  employees  Flat array of employee objects from the backend
 * @param {string} type       Label used in the filename (e.g. "All", "Filtered")
 */
async function exportEmployeeData(employees, type = "Data") {
  try {
    if (!employees || employees.length === 0) {
      showAlert("No employee data to export!", "warning");
      return;
    }

    const data = [];

    const headers = [
      "SN",
      "EMPID",
      "Fullname",
      "Position",
      "Brand / Department",
      "Status",
      "Shift",
      "Remarks",          // Violation
      "Proximity Code",
      "Timestamp",
      "Check Status",
      "Gate",
    ];
    data.push(headers);

    employees.forEach((employee, index) => {
      const rowData = [
        String(index + 1),
        String(employee.employee_id ?? ""),
        toProperCase(employee.fullname)  || "",
        toProperCase(employee.position)  || "",
        toProperCase(employee.brand)     || "",
        employee.status       || "",
        employee.shift        || "",
        employee.violation    || "None",
        employee.qr_code      || "",
        formatDate(employee.access_timestamp) || "",
        employee.check_status || "",
        employee.gate_name || employee.user_id || "",
      ];
      data.push(rowData);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    ws["!cols"] = [
      { wch: 5  }, // SN
      { wch: 10 }, // EMPID
      { wch: 25 }, // Fullname
      { wch: 20 }, // Position
      { wch: 20 }, // Brand
      { wch: 10 }, // Status
      { wch: 15 }, // Shift
      { wch: 15 }, // Remarks
      { wch: 15 }, // Proximity Code
      { wch: 20 }, // Timestamp
      { wch: 12 }, // Check Status
      { wch: 10 }, // Gate
    ];

    const headerRange = XLSX.utils.decode_range(ws["!ref"]);

    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;
      ws[cellAddress].s = {
        font:      { bold: true, color: { rgb: "FFFFFF" } },
        fill:      { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border:    _thinBorderXlsx(),
      };
    }

    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) ws[cellAddress] = { v: "", t: "s" };
        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.border = _thinBorderXlsx();
        if (col === 0) {
          ws[cellAddress].s.alignment = { horizontal: "center", vertical: "center" };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Scan History");

    const filename = `Scan_History_${type}_${_dateStamp()}.xlsx`;
    XLSX.writeFile(wb, filename);

    showAlert(
      `Successfully exported ${employees.length} record(s) → ${filename}`,
      "success"
    );
  } catch (error) {
    console.error("Export employee data error:", error);
    showAlert("Error creating Excel file: " + error.message, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM-TABLE EXPORT (current visible page only — intentional, mirrors what user sees)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export the rows currently rendered in the HTML table.
 * QR code is read from the data-qr attribute on the <td class="Col9"> cell.
 *
 * @param {string} type  Label used in the filename
 */
function exportToExcelDTL(type = "Filtered") {
  showAlert("Exporting visible page to Excel…", "info");

  try {
    const tableBody = document.getElementById("employeeTableBody");
    if (!tableBody) {
      showAlert("Table not found!", "warning");
      return;
    }

    const rows = tableBody.querySelectorAll("tr");
    if (rows.length === 0) {
      showAlert("No data to export!", "warning");
      return;
    }

    const data = [];

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
      "Check Status",
      "Gate",
    ];
    data.push(headers);

    // Column layout produced by renderEmployeeTable() in dtl.js:
    //  [0] SN  [1] Fullname+EMPID  [2] Brand+Position  [3] Status
    //  [4] Shift  [5] Violation(Col7)  [6] Image(Col8, skip)
    //  [7] QR(Col9, data-qr attr)  [8] Timestamp  [9] CheckStatus  [10] Gate
    rows.forEach((row) => {
      if (row.style.display === "none") return;

      const cells = row.querySelectorAll("td");
      if (cells.length === 0) return;

      // Helper: grab trimmed text, stripping any nested label text
      const text = (cell) => (cell ? cell.textContent.trim() : "");

      // EMPID lives in a sub-div with class "emp-id" inside cell[1]
      const empIdEl = cells[1]?.querySelector(".emp-id");
      const empId   = empIdEl
        ? empIdEl.textContent.replace(/EMPID:/i, "").trim()
        : "";

      // Fullname is in the first <strong> inside cell[1]
      const fullnameEl = cells[1]?.querySelector("strong:first-child");
      const fullname   = fullnameEl ? fullnameEl.textContent.trim() : text(cells[1]);

      // Brand is the first div's text inside cell[2]; position is in sub-div
      const brandEl    = cells[2]?.querySelector("div:first-child");
      const positionEl = cells[2]?.querySelector(".emp-position");
      const brand      = brandEl   ? brandEl.textContent.trim()   : "";
      const position   = positionEl
        ? positionEl.textContent.replace(/Position:/i, "").trim()
        : "";

      // Status strip the span wrapper
      const statusEl = cells[3]?.querySelector("span") || cells[3];
      const status   = statusEl ? statusEl.textContent.trim() : "";

      // QR: read from data-qr attribute on Col9 cell (cell index 7)
      const qrCell   = cells[7];
      const qrCode   = qrCell ? (qrCell.dataset.qr || "") : "";

      const rowData = [
        text(cells[0]),    // SN
        empId,             // EMPID
        fullname,          // Fullname
        position,          // Position
        brand,             // Brand
        status,            // Status
        text(cells[4]),    // Shift
        text(cells[5]),    // Remarks / Violation
        qrCode,            // Proximity Code (from data-qr)
        text(cells[8]),    // Timestamp
        text(cells[9]),    // Check Status
        text(cells[10]),   // Gate
      ];
      data.push(rowData);
    });

    if (data.length <= 1) {
      showAlert("No visible data to export!", "warning");
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    ws["!cols"] = [
      { wch: 5  },
      { wch: 10 },
      { wch: 25 },
      { wch: 20 },
      { wch: 20 },
      { wch: 10 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
      { wch: 12 },
      { wch: 10 },
    ];

    const headerRange = XLSX.utils.decode_range(ws["!ref"]);

    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const ca = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[ca]) continue;
      ws[ca].s = {
        font:      { bold: true, color: { rgb: "FFFFFF" } },
        fill:      { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border:    _thinBorderXlsx(),
      };
    }

    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const ca = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[ca]) continue;
        if (!ws[ca].s) ws[ca].s = {};
        ws[ca].s.border = _thinBorderXlsx();
        if (col === 0) ws[ca].s.alignment = { horizontal: "center", vertical: "center" };
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Scan History");

    const filename = `Scan_History_${type}_${_dateStamp()}.xlsx`;
    XLSX.writeFile(wb, filename);

    showAlert(
      `Successfully exported ${data.length - 1} record(s) → ${filename}`,
      "success"
    );
  } catch (error) {
    console.error("Export error:", error);
    showAlert("Error exporting to Excel: " + error.message, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExcelJS IMAGE EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function loadExcelJS() {
  return new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve();
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
    script.onload  = resolve;
    script.onerror = () => reject(new Error("Failed to load ExcelJS"));
    document.head.appendChild(script);
  });
}

async function fetchImageBase64(url) {
  const extensions = ["jpg", "jpeg", "png", "webp"];
  const urlsToTry  = [url];
  const base        = url.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  extensions.forEach((ext) => {
    const alt = `${base}.${ext}`;
    if (alt !== url) urlsToTry.push(alt);
  });

  for (const tryUrl of urlsToTry) {
    try {
      const res = await fetch(tryUrl);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) continue;
      const ext = blob.type.split("/")[1] || "jpeg";
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(",")[1]);
        reader.onerror   = reject;
        reader.readAsDataURL(blob);
      });
      return { base64, extension: ext === "jpeg" ? "jpeg" : ext };
    } catch {
    }
  }
  return null;
}

function resizeImageToSquare(base64, extension, size = 60) {
  return new Promise((resolve) => {
    const img    = new Image();
    img.onload   = () => {
      const canvas  = document.createElement("canvas");
      canvas.width  = size;
      canvas.height = size;
      const ctx     = canvas.getContext("2d");
      const scale   = Math.max(size / img.width, size / img.height);
      const scaledW = img.width  * scale;
      const scaledH = img.height * scale;
      ctx.drawImage(img, (size - scaledW) / 2, (size - scaledH) / 2, scaledW, scaledH);
      const resizedBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      resolve({ base64: resizedBase64, extension: "jpeg" });
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/${extension === "jpeg" ? "jpeg" : extension};base64,${base64}`;
  });
}

async function exportWithImages() {
  showAlert("Preparing export — loading image engine…", "info");

  try {
    await loadExcelJS();
  } catch (err) {
    showAlert("Could not load image export library: " + err.message, "error");
    return;
  }

  const currentFilters =
    typeof activeFilters !== "undefined" ? activeFilters : {};
  const isFiltered = Object.keys(currentFilters).length > 0;
  let exportEmployees = [];
  let exportType      = "All";

  if (isFiltered) {
    showAlert("Fetching all filtered records…", "info");
    exportType = "Filtered";
    try {
      exportEmployees = await fetchAllEmployeesForExport(currentFilters);
    } catch (err) {
      showAlert("Error fetching filtered data: " + err.message, "error");
      return;
    }
  } else {
    showAlert("Fetching all scan history data…", "info");
    try {
      exportEmployees = await fetchAllEmployeesForExport();
    } catch (err) {
      showAlert("Error fetching data: " + err.message, "error");
      return;
    }
  }

  if (!exportEmployees || exportEmployees.length === 0) {
    showAlert("No data found!", "warning");
    return;
  }

  showAlert("Matching employee images…", "info");
  let qrImageMap = {};
  try {
    qrImageMap = await buildQRToImageMap();
  } catch (err) {
    console.warn("Could not build QR image map:", err);
  }

  showAlert(`Building Excel with images for ${exportEmployees.length} record(s)…`, "info");

  const workbook  = new ExcelJS.Workbook();
  workbook.creator = "Employee Management System";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Scan History");

  const ROW_HEIGHT    = 55;
  const IMG_COL_WIDTH = 14;
  const IMG_PX_W      = 60;
  const IMG_PX_H      = 48;

  worksheet.columns = [
    { header: "SN",                 key: "sn",               width: 5            },
    { header: "EMPID",              key: "employee_id",      width: 12           },
    { header: "Photo",              key: "photo",            width: IMG_COL_WIDTH},
    { header: "Fullname",           key: "fullname",         width: 26           },
    { header: "Position",           key: "position",         width: 22           },
    { header: "Brand / Department", key: "brand",            width: 22           },
    { header: "Status",             key: "status",           width: 12           },
    { header: "Shift",              key: "shift",            width: 15           },
    { header: "Remarks",            key: "violation",        width: 20           },
    { header: "Proximity Code",     key: "qr_code",          width: 16           },
    { header: "Timestamp",          key: "access_timestamp", width: 22           },
    { header: "Check Status",       key: "check_status",     width: 14           },
    { header: "Gate",               key: "gate",             width: 16           },
  ];

  // Header styling
  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border    = _thinBorderExcelJS();
  });

  let successCount  = 0;
  let missingImages = 0;

  for (let i = 0; i < exportEmployees.length; i++) {
    const emp = exportEmployees[i];

    const qrKey       = (emp.qr_code || "").trim().toLowerCase();
    const matchedData = qrImageMap[qrKey] || null;

    const displayName  = matchedData ? matchedData.fullname : (emp.fullname  || "");
    const displayPos   = matchedData ? matchedData.position : (emp.position  || "");
    const displayBrand = matchedData ? matchedData.brand    : (emp.brand     || "");
    const displayId    = matchedData ? String(matchedData.id) : (emp.employee_id || "");

    const dataRow = worksheet.addRow({
      sn:               i + 1,
      employee_id:      displayId,
      photo:            "",
      fullname:         toProperCase(displayName),
      position:         toProperCase(displayPos),
      brand:            toProperCase(displayBrand),
      status:           emp.status        || "",
      shift:            emp.shift         || "",
      violation:        emp.violation     || "None",
      qr_code:          emp.qr_code       || "",
      access_timestamp: formatDate(emp.access_timestamp),
      check_status:     emp.check_status  || "",
      gate:             emp.gate_name || emp.user_id || "",
    });

    dataRow.height = ROW_HEIGHT;
    dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border    = _thinBorderExcelJS();
      cell.alignment = {
        vertical:   "middle",
        horizontal: colNum === 1 ? "center" : "left",
        wrapText:   false,
      };
    });

    let imgUrl = null;
    if (matchedData && matchedData.image) {
      imgUrl = `${window.location.origin}/../public/uploads/user/${matchedData.image}`;
    } else if (emp.image) {
      imgUrl = `${window.location.origin}/../public/uploads/user/${emp.image}`;
    }

    if (imgUrl) {
      const imgResult = await fetchImageBase64(imgUrl);
      if (imgResult) {
        try {
          const squared = await resizeImageToSquare(
            imgResult.base64,
            imgResult.extension,
            IMG_PX_W
          );
          const imageId = workbook.addImage({
            base64:    (squared || imgResult).base64,
            extension: (squared || imgResult).extension,
          });
          worksheet.addImage(imageId, {
            tl:     { col: 2.08, row: i + 1.08 },
            ext:    { width: IMG_PX_W, height: IMG_PX_H },
            editAs: "oneCell",
          });
          successCount++;
        } catch (imgErr) {
          console.warn(`Could not embed image for QR ${emp.qr_code}:`, imgErr);
          missingImages++;
        }
      } else {
        missingImages++;
      }
    } else {
      missingImages++;
    }
  }

  const buffer   = await workbook.xlsx.writeBuffer();
  const blob     = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `Scan_History_${exportType}_With_Images_${_dateStamp()}.xlsx`;
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement("a");
  a.href         = url;
  a.download     = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const msg =
    missingImages > 0
      ? `Exported ${exportEmployees.length} records (${successCount} with photos, ${missingImages} without) → ${filename}`
      : `Successfully exported ${exportEmployees.length} records with photos → ${filename}`;

  showAlert(msg, missingImages > 0 ? "warning" : "success");
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function formatDate(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return (
      date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0") + " " +
      String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0") + ":" +
      String(date.getSeconds()).padStart(2, "0")
    );
  } catch {
    return dateString;
  }
}

function _dateStamp() {
  const now = new Date();
  return (
    now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0")
  );
}

function _thinBorderXlsx() {
  const side = { style: "thin", color: { rgb: "000000" } };
  return { top: side, bottom: side, left: side, right: side };
}

function _thinBorderExcelJS() {
  const side = { style: "thin", color: { argb: "FF000000" } };
  return { top: side, bottom: side, left: side, right: side };
}

function showAlert(message, type = "info") {
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach((alert) => alert.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText =
    "float:right;background:none;border:none;font-size:18px;cursor:pointer;margin-left:5px;";
  closeBtn.innerHTML = `<i class="fas fa-times"></i>`;
  closeBtn.onclick = () => alert.remove();

  alert.appendChild(msgSpan);
  alert.appendChild(closeBtn);

  document.body.insertBefore(alert, document.body.firstChild);

  setTimeout(() => {
    if (alert.parentElement) alert.remove();
  }, 5000);
}

document.addEventListener("keydown", function (e) {
  if (
    e.key === "Escape" &&
    typeof isDropdownOpen !== "undefined" &&
    isDropdownOpen
  ) {
    if (typeof hideExportOptions === "function") {
      hideExportOptions();
    }
  }
});