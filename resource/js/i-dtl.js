// resource/js/i-dtl.js --> datalog table import

function openImportModal() {
  document.getElementById("importModal").style.display = "block";
  document.getElementById("importForm").reset();
  document.getElementById("importPreview").style.display = "none";
  document.getElementById("importProgress").style.display = "none";
  document.querySelector("#dataFile + .file-upload-label").innerHTML =
    `<i class="fas fa-file"></i> Click to select file (.csv, .xlsx, .xls)`;
}

document.addEventListener("DOMContentLoaded", function () {
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

  document
    .getElementById("importForm")
    .addEventListener("submit", handleImportSubmit);
});

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

async function parseCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = document.getElementById("skipHeader").checked;
  const startIndex = skipHeader ? 1 : 0;
  const previewLines = lines.slice(startIndex, startIndex + 5);

  return previewLines.map((line) => parseCSVLine(line));
}

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

function displayPreview(data) {
  let previewHTML = '<table class="preview-table"><thead><tr>';
  previewHTML +=
    "<th>Full Name</th><th>Position</th><th>Brand</th><th>Status</th><th>Shift</th><th>Violation</th><th>QR Code</th>";
  previewHTML += "</tr></thead><tbody>";

  data.forEach((row) => {
    previewHTML += "<tr>";
    for (let i = 0; i < 6; i++) {
      previewHTML += `<td>${row[i] || ""}</td>`;
    }
    const qrValue = row[6] || "";
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

      if (!row[0]) {
        errors.push(`Row ${rowNumber}: Missing required fields (fullname)`);
        return;
      }

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
        "error"
      );
      showImportProgress(false);
      return;
    }

    const formData = new FormData();
    formData.append("action", "import");
    formData.append("employees", JSON.stringify(employees));

    updateImportStatus("Importing employees to database...");

    const response = await fetch("../../app/services/datalog_backend.php", {
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

      if (data.duplicates_count && data.duplicates_count > 0) {
        statusMessage += ` (${data.duplicates_count} duplicates allowed)`;
        alertMessage += `\n${data.duplicates_count} duplicate employees were imported as separate records.`;
      }

      if (data.errors && data.errors.length > 0) {
        alertMessage += `\n\nNote: ${data.errors.length} records had issues but import continued.`;
      }

      updateImportStatus(statusMessage);
      showAlert(alertMessage, "success");

      setTimeout(() => {
        closeImportModal();
        loadEmployees();
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

async function processCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = document.getElementById("skipHeader").checked;
  const dataLines = skipHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => parseCSVLine(line));
}

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

        const filteredRows = dataRows.filter(
          (row) =>
            row &&
            row.some(
              (cell) => cell !== null && cell !== undefined && cell !== ""
            )
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

function showImportProgress(show) {
  document.getElementById("importProgress").style.display = show
    ? "block"
    : "none";
  if (show) {
    updateProgress(0);
  }
}

function updateProgress(percent) {
  document.getElementById("progressFill").style.width = percent + "%";
}

function updateImportStatus(message) {
  document.getElementById("importStatus").textContent = message;
}

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

window.onclick = function (event) {
  const employeeModal = document.getElementById("employeeModal");
  const importModal = document.getElementById("importModal");

  if (event.target === employeeModal) {
    closeModal();
  }
  if (event.target === importModal) {
    closeImportModal();
  }
};
