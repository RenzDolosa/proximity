// resource/js/ipc.js --> proximity table import

const CONFIG = {
  BACKEND_URL: "proxcode_backend.php",
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  TIMEOUT: 30000,
};

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
        const fileExtension = name.split(".").pop().toLowerCase();
        const icon =
          fileExtension === "csv"
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

  const fileExtension = file.name.split(".").pop().toLowerCase();

  if (!["csv", "xlsx", "xls"].includes(fileExtension)) {
    showAlert("Please select a valid file format (.csv, .xlsx, .xls)", "error");
    return;
  }

  try {
    const data =
      fileExtension === "csv"
        ? await _parseCSVPreview(file)
        : await _parseExcelPreview(file);

    if (!data || data.length === 0) {
      showAlert("No data found in file", "error");
      return;
    }

    _displayPreview(data);
  } catch (error) {
    showAlert("Error reading file: " + error.message, "error");
  }
}

async function _parseCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = safeGetElement("skipHeader")?.checked ?? true;
  const startIndex = skipHeader ? 1 : 0;
  const previewLines = lines.slice(startIndex, startIndex + 10);

  return previewLines.map((line) => _parseCSVLine(line));
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
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (!jsonData.length) {
          reject(new Error("Sheet is empty"));
          return;
        }
        const skipHeader = safeGetElement("skipHeader")?.checked ?? true;
        const startIndex = skipHeader ? 1 : 0;
        const previewData = jsonData.slice(startIndex, startIndex + 10);

        resolve(previewData);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read Excel file"));
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

  let previewHTML =
    '<h4>Preview (First 10 rows):</h4><table class="preview-table"><thead><tr>';
  previewHTML += `<th>SN</th>
    <th>Proximity Code</th>`;
  previewHTML += "</tr></thead><tbody>";

  data.forEach((col, i) => {
    let qr = "";
    if (Array.isArray(col)) qr = (col[0] || "").toString().trim();
    else if (col && typeof col === "object")
      qr = (col.qr_code || col["Proximity Code"] || "").toString().trim();
    previewHTML += `<tr><td><span class="badge badge-info">${i + 1}</span></td><td>${
      qr ? escapeHtml(qr) : '<em style="color:#6c757d;">Empty / Skipped</em>'
    }</td></tr>`;
  });

  previewHTML += "</tbody></table>";
  container.innerHTML = previewHTML;
  container.style.display = "block";
}

// ===== CSV LINE PARSER =====
function _parseCSVLine(line) {
  const result = [];
  let current = "",
    inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
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

  const fileExtension = file.name.split(".").pop().toLowerCase();

  if (!["csv", "xlsx", "xls"].includes(fileExtension)) {
    showAlert("Please select a valid file format (.csv, .xlsx, .xls)", "error");
    return;
  }

  try {
    showImportProgress(true);
    updateImportStatus("Reading file...");

    let dataRows;
    if (fileExtension === "csv") {
      dataRows = await _processCSVFull(file);
    } else {
      if (typeof XLSX === "undefined") {
        showAlert("Excel library not loaded", "error");
        showImportProgress(false);
        return;
      }
      dataRows = await _processExcelFull(file);
    }

    updateProgress(10);

    if (dataRows.length === 0) {
      showAlert("No data found in file", "error");
      showImportProgress(false);
      return;
    }

    updateProgress(20);
    updateImportStatus(`Processing ${dataRows.length} rows...`);

    const proximityCodes = [];
    const errors = [];
    const skipHeader = safeGetElement("skipHeader")?.checked ?? true;

    dataRows.forEach((row, index) => {
      const rowNumber = skipHeader ? index + 2 : index + 1;

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
        `No valid proximity codes found.\n${errors.slice(0, 5).join("\n")}${
          errors.length > 5 ? "\n...and more" : ""
        }`,
        "error",
      );
      showImportProgress(false);
      return;
    }

    if (errors.length > 0) {
      const proceed = confirm(
        `Found ${errors.length} empty rows that will be skipped.\n` +
          `Continue importing ${proximityCodes.length} valid codes?\n\n` +
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

    const response = await fetch(CONFIG.BACKEND_URL, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`);

    updateProgress(80);

    const data = await response.json();

    if (data.success) {
      updateProgress(100);

      const imported = data.imported_count || proximityCodes.length;
      const duplicates = data.duplicates_count || 0;

      let statusMessage = `Successfully imported ${imported} codes!`;
      let alertMessage = `Import completed! ${imported} codes imported successfully.`;

      if (duplicates > 0) {
        statusMessage += `\n(${duplicates} duplicates skipped)`;
        alertMessage += `\n${duplicates} duplicates skipped.`;
      }

      if (data.errors && data.errors.length > 0) {
        alertMessage += `\n\nNote: ${data.errors.slice(0, 3).join("\n")}`;
      }

      updateImportStatus(statusMessage);
      showAlert(alertMessage, "success");

      setTimeout(async () => {
        closeModal();
        await _refreshAfterImport();
      }, 2000);
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    showAlert("Import failed: " + error.message, "error");
  } finally {
    setTimeout(() => {
      showImportProgress(false);
    }, 3000);
  }
}

// ===== FULL FILE PROCESSORS =====
async function _processCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = safeGetElement("skipHeader")?.checked ?? true;
  const dataLines = skipHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => _parseCSVLine(line));
}

async function _processExcelFull(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const skipHeader = safeGetElement("skipHeader")?.checked ?? true;
        const dataRows = skipHeader ? jsonData.slice(1) : jsonData;

        const filteredRows = dataRows.filter(
          (row) =>
            row &&
            row.some(
              (cell) => cell !== null && cell !== undefined && cell !== "",
            ),
        );

        resolve(filteredRows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read Excel file"));
    reader.readAsArrayBuffer(file);
  });
}

// ── PROGRESS HELPERS ──────────────────────────────────────────────────────
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

function updateImportStatus(message) {
  const el = safeGetElement("importStatus");
  if (el) el.textContent = message;
}

// ── Utils ─────────────────────────────────────────────────────────────
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

// ===== MODAL CLICK-OUTSIDE =====
window.onclick = function (event) {
  const employeeModal = document.getElementById("employeeModal");
  const importModal = document.getElementById("importModal");

  if (event.target === employeeModal) {
    closeModal();
  }
  if (event.target === importModal) {
    closeModal();
  }
};
