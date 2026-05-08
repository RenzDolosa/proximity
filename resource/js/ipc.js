// resource/js/ipc.js --> proximity table import

const CONFIG = {
  BACKEND_URL: "proxcode_backend.php",
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  TIMEOUT: 30000,
};

// ===== HELPER FUNCTIONS =====
function escapeHtml(text) {
  if (typeof text !== "string") text = String(text);
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function safeGetElement(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`Element with id "${id}" not found`);
  return el;
}

// ===== WIRE IMPORT BUTTON =====
function _wireImportButton() {
  const importBtn = document.querySelector(".btn-import");
  if (!importBtn) return;

  importBtn.type = "button";

  const fresh = importBtn.cloneNode(true);
  importBtn.parentNode.replaceChild(fresh, importBtn);
  fresh.type = "button";
  fresh.addEventListener("click", handleImportSubmit);

  const fileInput = safeGetElement("dataFile");
  if (fileInput && !fileInput._ipcBound) {
    fileInput._ipcBound = true;
    fileInput.addEventListener("change", function (e) {
      const lbl = document.querySelector("#dataFile + .file-upload-label");
      if (!lbl) return;
      if (e.target.files.length > 0) {
        const name = e.target.files[0].name;
        const ext = name.split(".").pop().toLowerCase();
        const icon =
          ext === "csv"
            ? `<i class="fas fa-file-alt"></i>`
            : `<i class="fas fa-file-excel"></i>`;
        lbl.innerHTML = `${icon} ${escapeHtml(name)}`;
      } else {
        lbl.innerHTML = `<i class="fas fa-file-alt"></i> Click to select file (.csv, .xlsx, .xls)`;
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _wireImportButton);
} else {
  _wireImportButton();
}

// ===== MODAL =====
function openImportModal() {
  const modal = safeGetElement("importModal");
  const form = safeGetElement("importForm");
  const preview = safeGetElement("importPreview");
  const progress = safeGetElement("importProgress");
  const label = document.querySelector("#dataFile + .file-upload-label");

  if (modal) modal.style.display = "block";
  if (form) form.reset();
  if (preview) preview.style.display = "none";
  if (progress) progress.style.display = "none";
  if (label)
    label.innerHTML = `<i class="fas fa-file"></i> Click to select file (.csv, .xlsx, .xls)`;

  _wireImportButton();
}

// ===== PREVIEW =====
async function previewFile() {
  const fileInput = safeGetElement("dataFile");
  if (!fileInput) {
    showAlert("File input element not found", "error");
    return;
  }

  const file = fileInput.files[0];
  if (!file) {
    showAlert("Please select a file first", "error");
    return;
  }

  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showAlert(
      `File size exceeds ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB limit`,
      "error",
    );
    return;
  }

  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    showAlert("Please select a valid file format (.csv, .xlsx, .xls)", "error");
    return;
  }

  try {
    const data =
      ext === "csv"
        ? await _parseCSVPreview(file)
        : await _parseExcelPreview(file);

    if (!data || data.length === 0) {
      showAlert("No data found in file", "error");
      return;
    }
    _displayPreview(data);
  } catch (err) {
    console.error("Preview error:", err);
    showAlert("Error reading file: " + err.message, "error");
  }
}

async function _parseCSVPreview(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) throw new Error("CSV file is empty");
  const skip = safeGetElement("skipHeader")?.checked ?? true;
  const start = skip ? 1 : 0;
  return lines
    .slice(start, Math.min(start + 5, lines.length))
    .map(_parseCSVLine);
}

async function _parseExcelPreview(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("XLSX library not loaded"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), {
          type: "array",
        });
        if (!wb.SheetNames.length) {
          reject(new Error("No sheets found"));
          return;
        }
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
        });
        if (!json.length) {
          reject(new Error("Sheet is empty"));
          return;
        }
        const skip = safeGetElement("skipHeader")?.checked ?? true;
        const start = skip ? 1 : 0;
        resolve(json.slice(start, Math.min(start + 5, json.length)));
      } catch (err) {
        reject(new Error("Failed to parse Excel: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function _displayPreview(data) {
  const container = safeGetElement("importPreview");
  if (!container) return;

  if (!data || !data.length) {
    container.innerHTML = '<p style="color:#dc3545;">No data to preview</p>';
    container.style.display = "block";
    return;
  }

  let html =
    '<h4>Preview (First 5 rows):</h4><table class="preview-table"><thead><tr><th>SN</th><th>Proximity Code</th></tr></thead><tbody>';
  data.forEach((row, i) => {
    let qr = "";
    if (Array.isArray(row)) qr = (row[0] || "").toString().trim();
    else if (row && typeof row === "object")
      qr = (row.qr_code || row["Proximity Code"] || "").toString().trim();
    html += `<tr><td><span class="badge badge-info">${i + 1}</span></td><td>${
      qr ? escapeHtml(qr) : '<em style="color:#6c757d;">Empty / Skipped</em>'
    }</td></tr>`;
  });
  html += "</tbody></table>";
  container.innerHTML = html;
  container.style.display = "block";
}

// ===== CSV LINE PARSER =====
function _parseCSVLine(line) {
  const result = [];
  let current = "",
    inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

// ===== FULL FILE PROCESSORS =====
async function _processCSVFull(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) throw new Error("CSV file is empty");
  const skip = safeGetElement("skipHeader")?.checked ?? true;
  return (skip ? lines.slice(1) : lines).map(_parseCSVLine);
}

async function _processExcelFull(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("XLSX library not loaded"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), {
          type: "array",
        });
        if (!wb.SheetNames.length) {
          reject(new Error("No sheets found"));
          return;
        }
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
        });
        const skip = safeGetElement("skipHeader")?.checked ?? true;
        const rows = (skip ? json.slice(1) : json).filter(
          (r) =>
            r &&
            Array.isArray(r) &&
            r.some((c) => c !== null && c !== undefined && c !== ""),
        );
        if (!rows.length) {
          reject(new Error("No data rows found"));
          return;
        }
        resolve(rows);
      } catch (err) {
        reject(new Error("Failed to process Excel: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

// ===== POST-IMPORT REFRESH =====
async function _refreshAfterImport() {
  if (typeof employeeDataCache !== "undefined") employeeDataCache = null;
  if (typeof qrImageMapCache !== "undefined") qrImageMapCache = null;
  if (typeof loadEmployees === "function") {
    await loadEmployees({}, false, true);
  } else if (typeof refreshTable === "function") {
    await refreshTable();
  }

  if (typeof updateTotalAvailable === "function") {
    await updateTotalAvailable();
  }

  if (typeof syncOrphanStatuses === "function") {
    await syncOrphanStatuses();
  }

  if (typeof updateActiveEmployees === "function") {
    await updateActiveEmployees();
  }
}

// ===== MAIN IMPORT HANDLER =====
async function handleImportSubmit(e) {
  if (e) e.preventDefault();

  const fileInput = safeGetElement("dataFile");
  if (!fileInput) {
    showAlert("File input element not found", "error");
    return;
  }

  const file = fileInput.files[0];
  if (!file) {
    showAlert("Please select a file", "error");
    return;
  }

  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showAlert(
      `File size exceeds ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB limit`,
      "error",
    );
    return;
  }

  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    showAlert("Please select a valid file format (.csv, .xlsx, .xls)", "error");
    return;
  }

  try {
    showImportProgress(true);
    updateImportStatus("Reading file...");
    updateProgress(10);

    let dataRows;
    if (ext === "csv") {
      dataRows = await _processCSVFull(file);
    } else {
      if (typeof XLSX === "undefined") {
        showAlert("Excel library not loaded", "error");
        showImportProgress(false);
        return;
      }
      dataRows = await _processExcelFull(file);
    }

    if (!dataRows || !dataRows.length) {
      showAlert("No data found in file", "error");
      showImportProgress(false);
      return;
    }

    updateProgress(20);
    updateImportStatus(`Processing ${dataRows.length} row(s)...`);

    const proximityCodes = [];
    const errors = [];
    const skip = safeGetElement("skipHeader")?.checked ?? true;

    dataRows.forEach((row, index) => {
      const rowNumber = skip ? index + 2 : index + 1;
      let qrCode = "";
      if (Array.isArray(row)) {
        qrCode = (row[0] || "").toString().trim();
      } else if (row && typeof row === "object") {
        qrCode = (row.qr_code || row["Proximity Code"] || "").toString().trim();
      }

      if (qrCode) {
        proximityCodes.push({ qr_code: qrCode });
      } else {
        errors.push(`Row ${rowNumber}: Missing proximity code`);
      }
    });

    if (proximityCodes.length === 0) {
      showAlert(
        `No valid proximity codes found.\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? "\n...and more" : ""}`,
        "error",
      );
      showImportProgress(false);
      return;
    }

    if (errors.length > 0) {
      const proceed = confirm(
        `Found ${errors.length} empty row(s) that will be skipped.\n` +
          `Continue importing ${proximityCodes.length} valid code(s)?\n\n` +
          `${errors.slice(0, 3).join("\n")}${errors.length > 3 ? "\n...and more" : ""}`,
      );
      if (!proceed) {
        showImportProgress(false);
        return;
      }
    }

    updateProgress(40);
    updateImportStatus("Preparing upload...");

    const formData = new FormData();
    formData.append("action", "import");
    formData.append("code", JSON.stringify(proximityCodes));

    updateProgress(60);
    updateImportStatus("Uploading to database...");
    console.log(
      `[ipc] Sending ${proximityCodes.length} record(s) to ${CONFIG.BACKEND_URL}`,
    );

    const response = await fetch(CONFIG.BACKEND_URL, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`);

    updateProgress(80);
    const data = await response.json();
    console.log("[ipc] Response:", data);

    if (data.success) {
      updateProgress(100);

      const imported = data.imported_count || proximityCodes.length;
      const duplicates = data.duplicates_count || 0;

      let statusMsg = `Successfully imported ${imported} code(s)!`;
      let alertMsg = `Import completed!\n${imported} code(s) imported.`;
      if (duplicates > 0) {
        statusMsg += ` (${duplicates} duplicate(s) skipped)`;
        alertMsg += `\n${duplicates} duplicate(s) skipped.`;
      }
      if (data.warnings?.length) {
        alertMsg += `\n\nWarnings:\n${data.warnings.slice(0, 3).join("\n")}`;
      }

      updateImportStatus(statusMsg);
      showAlert(alertMsg, "success");

      setTimeout(async () => {
        closeModal();
        await _refreshAfterImport();
      }, 2000);
    } else {
      showAlert(data.message || "Import failed. Please try again.", "error");
      console.error("[ipc] Backend error:", data);
    }
  } catch (err) {
    console.error("[ipc] Import error:", err);
    showAlert("Import failed: " + err.message, "error");
  } finally {
    setTimeout(() => showImportProgress(false), 1000);
  }
}

// ===== PROGRESS HELPERS =====
function showImportProgress(show) {
  const el = safeGetElement("importProgress");
  if (el) {
    el.style.display = show ? "block" : "none";
    if (show) updateProgress(0);
  }
}

function updateProgress(percent) {
  const fill = safeGetElement("progressFill");
  if (fill) {
    fill.style.width = percent + "%";
    fill.textContent = percent + "%";
  }
}

function updateImportStatus(msg) {
  const el = safeGetElement("importStatus");
  if (el) el.textContent = msg;
}

// ===== MODAL CLICK-OUTSIDE =====
(function () {
  const prev = window.onclick;
  window.onclick = function (event) {
    if (typeof prev === "function") prev(event);
    const importModal = safeGetElement("importModal");
    if (importModal && event.target === importModal) {
      if (typeof closeModal === "function") closeModal();
    }
  };
})();
