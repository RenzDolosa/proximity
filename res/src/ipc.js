// ipc.js - Handles Import Proximity Codes functionality
// Enhanced JavaScript functions with Excel file support (.xlsx, .xls, .csv)
// FIXED VERSION - Proper backend connection

// Configuration
const CONFIG = {
  BACKEND_URL: '../cnfg/proxcode_backend.php',
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  TIMEOUT: 30000
};

// ===== HELPER FUNCTIONS =====

/**
 * Show alert message to user
 */

// Handle import form submission
async function handleImportSubmit(e) {
  e.preventDefault();

  const fileInput = document.getElementById("dataFile");
  const file = fileInput.files[0];

  if (!file) {
    showAlert("Please select a file", "error");
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
      dataRows = await processCSVFile(file);
    } else {
      dataRows = await processExcelFile(file);
    }

    if (dataRows.length === 0) {
      showAlert("No data found in file", "error");
      showImportProgress(false);
      return;
    }

    updateImportStatus(`Processing ${dataRows.length} proximity codes...`);

    const employees = [];
    const errors = [];

    dataRows.forEach((row, index) => {
      const rowNumber = document.getElementById("skipHeader").checked
        ? index + 2
        : index + 1;

      // Validate required fields
      if (!row[0]) {
        errors.push(`Row ${rowNumber}: Missing required fields (fullname)`);
        return;
      }

      // // Validate shift value
      // const validShifts = ['Day Shift', 'Night Shift', 'Graveyard Shift'];
      // if (row[4] && !validShifts.includes(row[4])) {
      //     errors.push(`Row ${rowNumber}: Invalid shift value "${row[4]}". Must be one of: ${validShifts.join(', ')}`);
      //     return;
      // }

      employees.push({
        qr: row[6] || "",
      });
    });

    if (errors.length > 0) {
      showAlert(
        `Found ${errors.length} errors:\n${errors.slice(0, 5).join("\n")}${
          errors.length > 5 ? "\n... and more" : ""
        }`,
        "error"
      );
      showImportProgress(false);
      return;
    }

    // Send to backend
    const formData = new FormData();
    formData.append("action", "import");
    formData.append("code", JSON.stringify(employees));

    updateImportStatus("Importing proximity codes to database...");

    const response = await fetch("../cnfg/proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      updateProgress(100);

      let statusMessage = `Successfully imported ${data.imported_count} proximity codes!`;
      let alertMessage = `Import completed! ${data.imported_count} proximity codes imported successfully.`;

      // Add duplicate information if any
      if (data.duplicates_count && data.duplicates_count > 0) {
        statusMessage += ` (${data.duplicates_count} duplicates allowed)`;
        alertMessage += `\n${data.duplicates_count} duplicate proximity codes were imported as separate records.`;
      }

      // Add error information if any
      if (data.errors && data.errors.length > 0) {
        alertMessage += `\n\nNote: ${data.errors.length} records had issues but import continued.`;
      }

      updateImportStatus(statusMessage);
      showAlert(alertMessage, "success");

      setTimeout(() => {
        closeModal();
        loadEmployees(); // Refresh the table
      }, 2000);
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Import error:", error);
    showAlert("Import failed: " + error.message, "error");
  } finally {
    setTimeout(() => {
      showImportProgress(false);
    }, 3000);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Safe element selector with error checking
 */
function safeGetElement(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`Element with id "${id}" not found`);
  }
  return el;
}

// ===== MODAL FUNCTIONS =====

// Open import modal
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
  if (label) {
    label.innerHTML = `<i class="fas fa-file"></i> Click to select file (.csv, .xlsx, .xls)`;
  }
}

// ===== FILE HANDLING =====

// Update file label when file is selected
document.addEventListener("DOMContentLoaded", function () {
  const fileInput = safeGetElement("dataFile");
  const form = safeGetElement("importForm");

  if (fileInput) {
    fileInput.addEventListener("change", function (e) {
      const label = document.querySelector("#dataFile + .file-upload-label");
      if (label) {
        if (e.target.files.length > 0) {
          const fileName = e.target.files[0].name;
          const fileExtension = fileName.split(".").pop().toLowerCase();
          const fileIcon = fileExtension === "csv" 
            ? `<i class="fas fa-file-alt"></i>` 
            : `<i class="fas fa-file-excel"></i>`;
          label.innerHTML = `${fileIcon} ${escapeHtml(fileName)}`;
        } else {
          label.innerHTML = `<i class="fas fa-file-alt"></i> Click to select file (.csv, .xlsx, .xls)`;
        }
      }
    });
  }

  if (form) {
    form.addEventListener("submit", handleImportSubmit);
  }
});

// Preview file content (CSV or Excel)
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

  // Validate file size
  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showAlert(`File size exceeds maximum limit of ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`, "error");
    return;
  }

  const fileExtension = file.name.split(".").pop().toLowerCase();

  if (!["csv", "xlsx", "xls"].includes(fileExtension)) {
    showAlert("Please select a valid file format (.csv, .xlsx, .xls)", "error");
    return;
  }

  try {
    let data;

    if (fileExtension === "csv") {
      data = await parseCSVFile(file);
    } else {
      // Check if XLSX library is available
      if (typeof XLSX === 'undefined') {
        showAlert("Excel library not loaded. Please ensure SheetJS is included in your HTML.", "error");
        console.error("XLSX library not found. Include: <script src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js'></script>");
        return;
      }
      data = await parseExcelFile(file);
    }

    if (!data || data.length === 0) {
      showAlert("No data found in file", "error");
      return;
    }

    displayPreview(data);
  } catch (error) {
    console.error("Preview error:", error);
    showAlert("Error reading file: " + error.message, "error");
  }
}

// Parse CSV file
async function parseCSVFile(file) {
  try {
    const text = await file.text();
    const lines = text.split("\n").filter((line) => line.trim());

    if (lines.length === 0) {
      throw new Error("CSV file is empty");
    }

    const skipHeaderCheckbox = safeGetElement("skipHeader");
    const skipHeader = skipHeaderCheckbox ? skipHeaderCheckbox.checked : false;
    const startIndex = skipHeader ? 1 : 0;
    const previewLines = lines.slice(startIndex, Math.min(startIndex + 5, lines.length));

    return previewLines.map((line) => parseCSVLine(line));
  } catch (error) {
    throw new Error("Failed to parse CSV: " + error.message);
  }
}

// Parse Excel file
async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') {
      reject(new Error("XLSX library not loaded"));
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          reject(new Error("Excel file has no sheets"));
          return;
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData.length === 0) {
          reject(new Error("Excel sheet is empty"));
          return;
        }

        const skipHeaderCheckbox = safeGetElement("skipHeader");
        const skipHeader = skipHeaderCheckbox ? skipHeaderCheckbox.checked : false;
        const startIndex = skipHeader ? 1 : 0;
        const previewData = jsonData.slice(startIndex, Math.min(startIndex + 5, jsonData.length));

        resolve(previewData);
      } catch (error) {
        reject(new Error("Failed to parse Excel file: " + error.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read Excel file"));
    reader.readAsArrayBuffer(file);
  });
}

// Display preview data
function displayPreview(data) {
  const previewContainer = safeGetElement("importPreview");
  
  if (!previewContainer) {
    console.error("Preview container not found");
    return;
  }

  if (!data || data.length === 0) {
    previewContainer.innerHTML = '<p style="color: #dc3545;">No data to preview</p>';
    previewContainer.style.display = "block";
    return;
  }

  let previewHTML = '<table class="preview-table"><thead><tr>';
  previewHTML += '<th>SN</th>';
  previewHTML += '<th>Proximity Code</th>';
  previewHTML += '</tr></thead><tbody>';

  data.forEach((row, index) => {
    previewHTML += "<tr>";

    // Handle both array and object format
    let qrValue = "";
    if (Array.isArray(row)) {
      qrValue = (row[0] || "").toString().trim();
    } else if (typeof row === 'object' && row !== null) {
      qrValue = (row.qr_code || row['Proximity Code'] || "").toString().trim();
    }

    const qrDisplay = qrValue 
      ? escapeHtml(qrValue)
      : '<em style="color: #6c757d;">Skipped Row</em>';
    previewHTML += `<td><span class="badge badge-info">${index + 1}</span></td>`;
    previewHTML += `<td>${qrDisplay}</td>`;
    previewHTML += "</tr>";
  });

  previewHTML += "</tbody></table>";

  previewContainer.innerHTML = previewHTML;
  previewContainer.style.display = "block";
}

// Parse CSV line (handles quotes and commas)
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        // Handle escaped quotes ""
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

// ===== IMPORT HANDLING =====

// Handle import form submission
async function handleImportSubmit(e) {
  e.preventDefault();

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

  // Validate file size
  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showAlert(`File size exceeds maximum limit of ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`, "error");
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
    updateProgress(10);

    let dataRows;

    if (fileExtension === "csv") {
      dataRows = await processCSVFile(file);
    } else {
      if (typeof XLSX === 'undefined') {
        showAlert("Excel library not loaded", "error");
        showImportProgress(false);
        return;
      }
      dataRows = await processExcelFile(file);
    }

    if (!dataRows || dataRows.length === 0) {
      showAlert("No data found in file", "error");
      showImportProgress(false);
      return;
    }

    updateProgress(20);
    updateImportStatus(`Processing ${dataRows.length} proximity codes...`);

    const employees = [];
    const errors = [];

    // Process each row
    dataRows.forEach((row, index) => {
      const skipHeaderCheckbox = safeGetElement("skipHeader");
      const skipHeader = skipHeaderCheckbox ? skipHeaderCheckbox.checked : false;
      const rowNumber = skipHeader ? index + 2 : index + 1;

      // Extract QR code from row (handle both array and object format)
      let qrCode = "";
      if (Array.isArray(row)) {
        qrCode = (row[0] || "").toString().trim();
      } else if (typeof row === 'object' && row !== null) {
        qrCode = (row.qr_code || row['Proximity Code'] || "").toString().trim();
      }

      // Validate and add to proximity codes array
      if (qrCode) {
        employees.push({
          qr_code: qrCode
        });
      } else {
        errors.push(`Row ${rowNumber}: Missing proximity code`);
      }
    });

    // Check if we have valid records
    if (employees.length === 0) {
      showAlert(
        `No valid proximity codes found.\n${errors.slice(0, 5).join("\n")}${
          errors.length > 5 ? "\n... and more" : ""
        }`,
        "error"
      );
      showImportProgress(false);
      return;
    }

    // If there are errors but we have records, ask for confirmation
    if (errors.length > 0) {
      const proceed = confirm(
        `Found ${errors.length} rows with issues.\nContinue with ${employees.length} valid records?\n\n${errors.slice(0, 3).join("\n")}${
          errors.length > 3 ? "\n... and more" : ""
        }`
      );
      if (!proceed) {
        showImportProgress(false);
        return;
      }
    }

    updateProgress(40);
    updateImportStatus("Preparing data for upload...");

    // FIXED: Changed 'employees' to 'code' to match PHP backend expectation
    // PHP Backend expects: $_POST['code']
    const formData = new FormData();
    formData.append("action", "import");
    formData.append("code", JSON.stringify(employees));  // ✅ FIXED: Was 'employees', now 'code'

    updateProgress(60);
    updateImportStatus("Uploading to database...");

    console.log("Sending import request with", employees.length, "records to", CONFIG.BACKEND_URL);
    console.log("Data structure:", JSON.stringify(employees, null, 2));

    // Send to backend
    const response = await fetch(CONFIG.BACKEND_URL, {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest"
      },
      timeout: CONFIG.TIMEOUT
    });

    // Check HTTP response status
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    updateProgress(80);

    // Parse JSON response
    const data = await response.json();
    console.log("Backend response:", data);

    if (data.success) {
      updateProgress(100);

      const importedCount = data.imported_count || employees.length;
      const duplicatesCount = data.duplicates_count || 0;

      let statusMessage = `Successfully imported ${importedCount} proximity codes!`;
      let alertMessage = `Import completed!\n${importedCount} codes imported successfully.`;

      // Add duplicate information if any
      if (duplicatesCount > 0) {
        statusMessage += ` (${duplicatesCount} duplicates skipped)`;
        alertMessage += `\n${duplicatesCount} duplicate codes were skipped.`;
      }

      // Add warning information if any
      if (data.warnings && Array.isArray(data.warnings) && data.warnings.length > 0) {
        alertMessage += `\n\nWarnings:\n${data.warnings.slice(0, 3).join("\n")}`;
      }

      updateImportStatus(statusMessage);
      showAlert(alertMessage, "success");

      setTimeout(() => {
        closeModal();

        // Refresh the proximity code list if function exists
        if (typeof loadEmployees === 'function') {
          console.log("Calling loadEmployees()");
          loadEmployees();
        } else if (typeof refreshTable === 'function') {
          console.log("Calling refreshTable()");
          refreshTable();
        } else {
          console.warn("No refresh function found (loadEmployees or refreshTable)");
        }
      }, 2000);
    } else {
      showAlert(data.message || "Import failed. Please try again.", "error");
      console.error("Backend error response:", data);
    }
  } catch (error) {
    console.error("Import error:", error);
    showAlert("Import failed: " + error.message, "error");
  } finally {
    setTimeout(() => {
      showImportProgress(false);
    }, 1000);
  }
}

// Process CSV file for import
async function processCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error("CSV file is empty");
  }

  const skipHeaderCheckbox = safeGetElement("skipHeader");
  const skipHeader = skipHeaderCheckbox ? skipHeaderCheckbox.checked : false;
  const dataLines = skipHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => parseCSVLine(line));
}

// Process Excel file for import
async function processExcelFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') {
      reject(new Error("XLSX library not loaded"));
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          reject(new Error("No sheets found in Excel file"));
          return;
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const skipHeaderCheckbox = safeGetElement("skipHeader");
        const skipHeader = skipHeaderCheckbox ? skipHeaderCheckbox.checked : false;
        const dataRows = skipHeader ? jsonData.slice(1) : jsonData;

        // Filter out completely empty rows
        const filteredRows = dataRows.filter(
          (row) =>
            row &&
            Array.isArray(row) &&
            row.some(
              (cell) => cell !== null && cell !== undefined && cell !== ""
            )
        );

        if (filteredRows.length === 0) {
          reject(new Error("No data rows found in Excel file"));
          return;
        }

        resolve(filteredRows);
      } catch (error) {
        reject(new Error("Failed to process Excel file: " + error.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read Excel file"));
    reader.readAsArrayBuffer(file);
  });
}

// ===== PROGRESS FUNCTIONS =====

// Show/hide import progress
function showImportProgress(show) {
  const progressElement = safeGetElement("importProgress");
  if (progressElement) {
    progressElement.style.display = show ? "block" : "none";
    if (show) {
      updateProgress(0);
    }
  }
}

// Update import progress
function updateProgress(percent) {
  const progressFill = safeGetElement("progressFill");
  if (progressFill) {
    progressFill.style.width = percent + "%";
    progressFill.textContent = percent + "%";
  }
}

// Update import status message
function updateImportStatus(message) {
  const statusElement = safeGetElement("importStatus");
  if (statusElement) {
    statusElement.textContent = message;
  }
}

// Show alert message
function showAlert(message, type = "info") {
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach((alert) => alert.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  alert.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
  `;

  document.body.insertBefore(alert, document.body.firstChild);

  setTimeout(() => {
    if (alert.parentElement) alert.remove();
  }, 5000);
}

// ===== MODAL CLICK HANDLER =====

// Update the window click handler to include import modal
window.onclick = function (event) {
  const employeeModal = safeGetElement("employeeModal");
  const importModal = safeGetElement("importModal");

  if (employeeModal && event.target === employeeModal) {
    if (typeof closeModal === 'function') {
      closeModal();
    }
  }
  if (importModal && event.target === importModal) {
    closeModal();
  }
};