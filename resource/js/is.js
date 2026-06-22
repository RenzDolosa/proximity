// resource/js/is.js --> system table import

// Open import modal
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
    const data =
      fileExtension === "csv"
        ? await parseCSVFile(file)
        : await parseExcelFile(file);

    if (!data || data.length === 0) {
      showAlert("No data found in file", "error");
      return;
    }

    displayPreview(data);
  } catch (error) {
    showAlert("Error reading file: " + error.message, "error");
  }
}

async function parseCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = document.getElementById("skipHeader")?.checked ?? true;
  const startIndex = skipHeader ? 1 : 0;
  const previewLines = lines.slice(startIndex, startIndex + 10);

  return previewLines.map((line) => parseCSVLine(line));
}

async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("XLSX library not loaded"));
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
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
        const skipHeader =
          document.getElementById("skipHeader")?.checked ?? true;
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

function displayPreview(data) {
  const container = document.getElementById("importPreview");
  if (!container) return;

  if (!data || !data.length) {
    container.innerHTML = '<p style="color:#dc3545;">No data to preview</p>';
    container.style.display = "block";
    return;
  }

  let previewHTML =
    '<h4>Preview (First 10 rows):</h4><table class="preview-table"><thead><tr>';
  previewHTML += `<th>SN</th>
    <th>EMPID</th>
    <th>Fullname</th>
    <th>Position</th>
    <th>Brand / Department</th>
    <!-- <th>Gender</th>
    <th>Birth Date</th>
    <th>Hired Date</th> -->
    <th>Status</th>
    <th>Shift</th>
    <th>Violation</th>
    <th>Proximity Code</th>`;
  previewHTML += "</tr></thead><tbody>";

  data.forEach((col, index) => {
    previewHTML += "<tr>";
    previewHTML += `<td><span class="badge badge-info">${index + 1}</span></td>`;
    for (let i = 0; i < 7; i++) {
      previewHTML += `<td>${col[i] || ""}</td>`;
    }

    const idValue = col[0] || "";
    const idDisplay =
      idValue !== "" && idValue !== "No EMPID"
        ? idValue
        : '<em style="color: #6c757d;">Required</em>';
    previewHTML = previewHTML.replace(
      `<td>${idValue}</td>`,
      `<td>${idDisplay}</td>`,
    );

    const fullnameValue = col[1] || "";
    const fullnameDisplay =
      fullnameValue !== "" && fullnameValue !== "None"
        ? fullnameValue
        : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${fullnameValue}</td>`,
      `<td>${fullnameDisplay}</td>`,
    );

    const positionValue = col[2] || "";
    const positionDisplay =
      positionValue !== "" && positionValue !== "None"
        ? positionValue
        : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${positionValue}</td>`,
      `<td>${positionDisplay}</td>`,
    );

    const brandValue = col[3] || "";
    const brandDisplay = brandValue
      ? brandValue
      : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${brandValue}</td>`,
      `<td>${brandDisplay}</td>`,
    );

    // const genderValue = col[4] || "";
    // const genderDisplay = genderValue
    //   ? genderValue
    //   : '<em style="color: #6c757d;">None</em>';
    // previewHTML = previewHTML.replace(
    //   `<td>${genderValue}</td>`,
    //   `<td>${genderDisplay}</td>`,
    // );

    // const birthRaw = col[5];
    // const birthIso = formatDateValue(birthRaw); // YYYY-MM-DD (for data)
    // const birthDisplay = birthIso
    //   ? formatDateForDisplay(birthIso) // DD/MM/YYYY (for preview)
    //   : '<em style="color: #6c757d;">None</em>';
    // previewHTML = previewHTML.replace(
    //   `<td>${birthRaw || ""}</td>`,
    //   `<td>${birthDisplay}</td>`,
    // );

    // const hiredRaw = col[6];
    // const hiredIso = formatDateValue(hiredRaw); // YYYY-MM-DD (for data)
    // const hiredDisplay = hiredIso
    //   ? formatDateForDisplay(hiredIso) // DD/MM/YYYY (for preview)
    //   : '<em style="color: #6c757d;">None</em>';
    // previewHTML = previewHTML.replace(
    //   `<td>${hiredRaw || ""}</td>`,
    //   `<td>${hiredDisplay}</td>`,
    // );

    const statusValue = col[4] || "";
    const statusDisplay = statusValue
      ? statusValue
      : '<em style="color: #6c757d;">Default (Active)</em>';
    previewHTML = previewHTML.replace(
      `<td>${statusValue}</td>`,
      `<td>${statusDisplay}</td>`,
    );

    const shiftValue = col[5] || "";
    const shiftDisplay = shiftValue
      ? shiftValue
      : '<em style="color: #6c757d;">Default (Day Shift)</em>';
    previewHTML = previewHTML.replace(
      `<td>${shiftValue}</td>`,
      `<td>${shiftDisplay}</td>`,
    );

    const violationValue = col[6] || "";
    const violationDisplay =
      violationValue !== "" && violationValue !== "None"
        ? violationValue
        : '<em style="color: #6c757d;">None</em>';
    previewHTML = previewHTML.replace(
      `<td>${violationValue}</td>`,
      `<td>${violationDisplay}</td>`,
    );

    const qrValue = col[7] || "";
    const qrDisplay = qrValue
      ? qrValue
      : '<em style="color: #6c757d;">Auto-generate</em>';
    previewHTML += `<td>${qrDisplay}</td>`;
    previewHTML += "</tr>";
  });

  previewHTML += "</tbody></table>";
  container.innerHTML = previewHTML;
  container.style.display = "block";
}

function formatDateValue(value) {
  if (!value && value !== 0) return "";

  if (typeof value === "number") {
    const ms = Math.round(value) * 86400 * 1000;
    const date = new Date(25569 * -86400 * 1000 + ms);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const mdyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (mdyMatch) {
    const [, dd, mm, yyyy] = mdyMatch;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  return str;
}

function formatDateForDisplay(isoValue) {
  if (!isoValue) return "";
  const match = isoValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return isoValue;
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
  if (e) e.preventDefault();

  const fileInput = document.getElementById("dataFile");

  if (!fileInput) {
    showAlert("File input element not found", "error");
    return;
  }

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

    updateProgress(10);

    if (dataRows.length === 0) {
      showAlert("No data found in file", "error");
      showImportProgress(false);
      return;
    }

    updateProgress(20);
    updateImportStatus(`Processing ${dataRows.length} employee's...`);

    const employees = [];
    const errors = [];
    const skipHeader = document.getElementById("skipHeader")?.checked ?? true;

    dataRows.forEach((row, index) => {
      const rowNumber = skipHeader ? index + 2 : index + 1;

      if (!row[0]) {
        errors.push(`Row ${rowNumber}: Missing required fields (empid)`);
        return;
      }

      if (!row[1]) {
        errors.push(`Row ${rowNumber}: Missing required fields (fullname)`);
        return;
      }

      if (!row[2]) {
        errors.push(`Row ${rowNumber}: Missing required fields (position)`);
        return;
      }

      if (!row[3]) {
        errors.push(`Row ${rowNumber}: Missing required fields (brand)`);
        return;
      }

      employees.push({
        id: row[0] || "",
        fullname: row[1] || "",
        position: row[2] || "",
        brand: row[3] || "",
        // gender: row[4] || "",
        // birth: formatDateValue(row[5]),
        // hired: formatDateValue(row[6]),
        status: row[4] || "Active",
        shift: row[5] || "",
        violation: row[6] || "",
        qr: row[7] || "",
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

    updateProgress(40);
    updateImportStatus("Preparing upload...");

    const formData = new FormData();
    formData.append("action", "import");
    formData.append("employees", JSON.stringify(employees));

    updateProgress(60);
    updateImportStatus("Importing employees to database...");

    const response = await fetch(`${EmployeesBackend}`, {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`);

    updateProgress(80);

    const data = await response.json();

    if (data.success) {
      updateProgress(100);

      const imported = data.imported_count || employees.length;
      const duplicates = data.duplicates_count || 0;

      let statusMessage = `Successfully imported ${imported} employees!`;
      let alertMessage = `Import completed! ${imported} employees imported successfully.`;

      if (duplicates > 0) {
        statusMessage += `\n(${duplicates} duplicates allowed)`;
        alertMessage += `\n${duplicates} duplicate employees were imported as separate records.`;
      }

      if (data.errors && data.errors.length > 0) {
        alertMessage += `\n\nNote: ${data.errors.length} records had issues but import continued.`;
      }

      updateImportStatus(statusMessage);
      showAlert(alertMessage, "success");

      setTimeout(async () => {
        closeModal();
        await loadEmployees(
          typeof activeFilters !== "undefined" &&
            Object.keys(activeFilters).length > 0
            ? activeFilters
            : {},
          true,
          true,
        );
        await updateTotalEmployees();
        await updateActiveEmployees();

        if (typeof syncOrphanStatuses === "function") {
          await syncOrphanStatuses();
        }
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

async function processCSVFile(file) {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const skipHeader = document.getElementById("skipHeader")?.checked ?? true;
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

        const skipHeader =
          document.getElementById("skipHeader")?.checked ?? true;
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
  const el = document.getElementById("importProgress");
  if (el) {
    el.style.display = show ? "block" : "none";
    if (show) updateProgress(0);
  }
}

function updateProgress(percent) {
  const fill = document.getElementById("progressFill");
  if (fill) {
    fill.style.width = percent + "%";
    fill.textContent = percent + "%";
  }
}

function updateImportStatus(message) {
  const el = document.getElementById("importStatus");
  if (el) el.textContent = message;
}

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
