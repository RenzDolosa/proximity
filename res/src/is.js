// Enhanced JavaScript functions with Excel file support (.xlsx, .xls, .csv)

// Open import modal
function openImportModal() {
  document.getElementById("importModal").style.display = "block";
  document.getElementById("importForm").reset();
  document.getElementById("importPreview").style.display = "none";
  document.getElementById("importProgress").style.display = "none";
  document.querySelector("#dataFile + .file-upload-label").innerHTML =
    `<i class="fas fa-file"></i> Click to select file (.csv, .xlsx, .xls)`;
}

// Update file label when file is selected
document.addEventListener("DOMContentLoaded", function () {
  // Add this to your existing setupEventListeners function
  document.getElementById("dataFile").addEventListener("change", function (e) {
    const label = document.querySelector("#dataFile + .file-upload-label");
    if (e.target.files.length > 0) {
      const fileName = e.target.files[0].name;
      const fileExtension = fileName.split(".").pop().toLowerCase();
      const fileIcon =
        fileExtension === "csv"
          ? `<i class="fas fa-file-alt"></i>`
          : `<i class="fas fa-file-excel"></i>`;
      label.innerHTML = `${fileIcon} ${fileName}`;
    } else {
      label.innerHTML = `<i class="fas fa-file-alt"></i> Click to select file (.csv, .xlsx, .xls)`;
    }
  });

  // Import form submission
  document
    .getElementById("importForm")
    .addEventListener("submit", handleImportSubmit);
});

// Preview file content (CSV or Excel)
async function previewFile() {
  const fileInput = document.getElementById("dataFile");
  const file = fileInput.files[0];

  if (!file) {
    showAlert("Please select a file first", "error");
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
      data = await parseExcelFile(file);
    }

    displayPreview(data);
  } catch (error) {
    showAlert("Error reading file: " + error.message, "error");
  }
}

// Parse CSV file
async function parseCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = document.getElementById("skipHeader").checked;
  const startIndex = skipHeader ? 1 : 0;
  const previewLines = lines.slice(startIndex, startIndex + 5);

  return previewLines.map((line) => parseCSVLine(line));
}

// Parse Excel file
async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const skipHeader = document.getElementById("skipHeader").checked;
        const startIndex = skipHeader ? 1 : 0;
        const previewData = jsonData.slice(startIndex, startIndex + 5);

        resolve(previewData);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read Excel file"));
    reader.readAsArrayBuffer(file);
  });
}

// Display preview data
function displayPreview(data) {
  let previewHTML = '<table class="preview-table"><thead><tr>';
  previewHTML +=
    "<th>SN</th><th>Full Name</th><th>Position</th><th>Brand</th><th>Status</th><th>Shift</th><th>Violation</th><th>Proximity Code</th>";
  previewHTML += "</tr></thead><tbody>";

  data.forEach((col, index) => {
    previewHTML += "<tr>";
    previewHTML += `<td>${index + 1}</td>`;
    for (let i = 0; i < 6; i++) {
      previewHTML += `<td>${col[i] || ""}</td>`;
    }
    const fullnameValue = col[1] || "";
    const fullnameDisplay =
      fullnameValue !== "" && fullnameValue !== "None"
        ? fullnameValue
        : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${fullnameValue}</td>`,
      `<td>${fullnameDisplay}</td>`,
    );

    const positionValue = col[1] || "";
    const positionDisplay =
      positionValue !== "" && positionValue !== "None"
        ? positionValue
        : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${positionValue}</td>`,
      `<td>${positionDisplay}</td>`,
    );

    const brandValue = col[2] || "";
    const brandDisplay = brandValue
      ? brandValue
      : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${brandValue}</td>`,
      `<td>${brandDisplay}</td>`,
    );

    const statusValue = col[3] || "";
    const statusDisplay = statusValue
      ? statusValue
      : '<em style="color: #6c757d;">Default (Active)</em>';
    previewHTML = previewHTML.replace(
      `<td>${statusValue}</td>`,
      `<td>${statusDisplay}</td>`,
    );

    const shiftValue = col[4] || "";
    const shiftDisplay = shiftValue
      ? shiftValue
      : '<em style="color: #6c757d;">Default (Day Shift)</em>';
    previewHTML = previewHTML.replace(
      `<td>${shiftValue}</td>`,
      `<td>${shiftDisplay}</td>`,
    );

    const violationValue = col[5] || "";
    const violationDisplay =
      violationValue !== "" && violationValue !== "None"
        ? violationValue
        : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${violationValue}</td>`,
      `<td>${violationDisplay}</td>`,
    );

    // Show QR code column with indication if it will be auto-generated
    const qrValue = col[6] || "";
    const qrDisplay = qrValue
      ? qrValue
      : '<em style="color: #6c757d;">Auto-generate</em>';
    previewHTML += `<td>${qrDisplay}</td>`;
    previewHTML += "</tr>";
  });

  previewHTML += "</tbody></table>";

  document.getElementById("importPreview").innerHTML = previewHTML;
  document.getElementById("importPreview").style.display = "block";
}

// Parse CSV line (handles quotes and commas)
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
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

    updateImportStatus(`Processing ${dataRows.length} employees...`);

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

      if (!row[1]) {
        errors.push(`Row ${rowNumber}: Missing required fields (position)`);
        return;
      }

      if (!row[2]) {
        errors.push(`Row ${rowNumber}: Missing required fields (brand)`);
        return;
      }

      // // Validate shift value
      // const validShifts = ['Day Shift', 'Night Shift', 'Graveyard Shift'];
      // if (row[4] && !validShifts.includes(row[4])) {
      //     errors.push(`Row ${rowNumber}: Invalid shift value "${row[4]}". Must be one of: ${validShifts.join(', ')}`);
      //     return;
      // }

      employees.push({
        fullname: row[0] || "",
        position: row[1] || "",
        brand: row[2] || "",
        status: row[3] || "Active",
        shift: row[4] || "",
        violation: row[5] || "",
        qr: row[6] || "",
      });
    });

    if (errors.length > 0) {
      showAlert(
        `Found ${errors.length} errors:\n${errors.slice(0, 5).join("\n")}${
          errors.length > 5 ? "\n... and more" : ""
        }`,
        "error",
      );
      showImportProgress(false);
      return;
    }

    // Send to backend
    const formData = new FormData();
    formData.append("action", "import");
    formData.append("employees", JSON.stringify(employees));

    updateImportStatus("Importing employees to database...");

    const response = await fetch("../cnfg/manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      updateProgress(100);

      let statusMessage = `Successfully imported ${data.imported_count} employees!`;
      let alertMessage = `Import completed! ${data.imported_count} employees imported successfully.`;

      // Add duplicate information if any
      if (data.duplicates_count && data.duplicates_count > 0) {
        statusMessage += ` (${data.duplicates_count} duplicates allowed)`;
        alertMessage += `\n${data.duplicates_count} duplicate employees were imported as separate records.`;
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

// Process CSV file for import
async function processCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = document.getElementById("skipHeader").checked;
  const dataLines = skipHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => parseCSVLine(line));
}

// Process Excel file for import
async function processExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const skipHeader = document.getElementById("skipHeader").checked;
        const dataRows = skipHeader ? jsonData.slice(1) : jsonData;

        // Filter out empty rows
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

// Show/hide import progress
function showImportProgress(show) {
  document.getElementById("importProgress").style.display = show
    ? "block"
    : "none";
  if (show) {
    updateProgress(0);
  }
}

// Update import progress
function updateProgress(percent) {
  document.getElementById("progressFill").style.width = percent + "%";
  document.getElementById("progressFill").textContent = percent + "%";
}

// Update import status
function updateImportStatus(message) {
  document.getElementById("importStatus").textContent = message;
}

// Update the window click handler to include import modal
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
