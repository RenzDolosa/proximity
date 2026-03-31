// Function to fetch all employees data bypassing pagination
async function fetchAllEmployeesForExport() {
  try {
    const response = await fetch("../cnfg/eas.php?export=all", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return data.employees || [];
    } else {
      throw new Error(data.message || "Failed to fetch employee data");
    }
  } catch (error) {
    console.error("Fetch employees error:", error);
    throw error;
  }
}

// Function to apply current search filters to employee data
function applyCurrentFilters(employees) {
  const filters = {
    id: document.getElementById("search_id")?.value?.toLowerCase() || "",
    fullname:
      document.getElementById("search_fullname")?.value?.toLowerCase() || "",
    position:
      document.getElementById("search_position")?.value?.toLowerCase() || "",
    brand: document.getElementById("search_brand")?.value?.toLowerCase() || "",
    status: document.getElementById("search_status")?.value || "",
    shift: document.getElementById("search_shift")?.value || "",
    date: document.getElementById("search_date")?.value?.toLowerCase() || "",
    qr_code: document.getElementById("search_qr")?.value?.toLowerCase() || "",
  };

  return employees.filter((employee) => {
    // Apply id filter
    if (filters.id && !employee.id?.toLowerCase().includes(filters.id)) {
      return false;
    }

    // Apply fullname filter
    if (
      filters.fullname &&
      !employee.fullname?.toLowerCase().includes(filters.fullname)
    ) {
      return false;
    }

    // Apply position filter
    if (
      filters.position &&
      !employee.position?.toLowerCase().includes(filters.position)
    ) {
      return false;
    }

    // Apply brand filter
    if (
      filters.brand &&
      !employee.brand?.toLowerCase().includes(filters.brand)
    ) {
      return false;
    }

    // Apply status filter (exact match)
    if (filters.status && employee.status !== filters.status) {
      return false;
    }

    // Apply shift filter (exact match)
    if (filters.shift && employee.shift !== filters.shift) {
      return false;
    }

    // Apply date filter
    if (
      filters.date &&
      !employee.created_at?.toLowerCase().includes(filters.date)
    ) {
      return false;
    }

    // Apply QR code filter
    if (
      filters.qr_code &&
      !employee.qr_code?.toLowerCase().includes(filters.qr_code)
    ) {
      return false;
    }

    return true;
  });
}

// Function to export all data without filters
function exportAllData() {
  showAlert("Exporting all data...", "info");

  try {
    fetchAllEmployeesForExport()
      .then((employees) => {
        if (!employees || employees.length === 0) {
          showAlert("No employee data found!", "warning");
          return;
        }

        exportEmployeeData(employees, "All");
      })
      .catch((error) => {
        console.error("Export all data error:", error);
        showAlert("Error fetching all data: " + error.message, "error");
      });
  } catch (error) {
    console.error("Export all data error:", error);
    showAlert("Error exporting all data: " + error.message, "error");
  }
}

function toProperCase(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/(^|[\s-,])(\w)/g, (char) => char.toUpperCase());
}

// Updated helper function to export employee data array
async function exportEmployeeData(employees, type = "Data") {
  try {
    if (!employees || employees.length === 0) {
      showAlert("No employee data to export!", "warning");
      return;
    }

    // Prepare data array
    const data = [];

    // Add headers
    const headers = [
      "SN",
      "EMPID",
      "Fullname",
      "Position",
      "Brand",
      "Status",
      "Shift",
      "Violation",
      "Proximity Code",
      "Register Date",
      "Last Update",
    ];
    data.push(headers);

    // Add employee data
    employees.forEach((employee, index) => {
      const rowData = [
        String(index + 1), // SN
        String(employee.id) || "",
        toProperCase(employee.fullname) || "",
        toProperCase(employee.position) || "",
        toProperCase(employee.brand) || "",
        employee.status || "",
        employee.shift || "",
        employee.violation || "None",
        employee.qr_code || "",
        formatDate(employee.created_at) || "",
        formatDate(employee.updated_at) || "",
      ];
      data.push(rowData);
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 5 }, // SN
      { wch: 10 }, // EMPID
      { wch: 25 }, // Fullname
      { wch: 20 }, // Position
      { wch: 15 }, // Brand
      { wch: 12 }, // Status
      { wch: 15 }, // Shift
      { wch: 20 }, // Violation
      { wch: 15 }, // Proximity Code
      { wch: 18 }, // Register Date
      { wch: 18 }, // Last Update
    ];
    ws["!cols"] = colWidths;

    // Style the header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    // Add borders and formatting to all data cells
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { v: "", t: "s" };
        }

        if (!ws[cellAddress].s) ws[cellAddress].s = {};

        // Add borders
        ws[cellAddress].s.border = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        };

        // Center align SN column and Status column
        if (col === 0 || col === 4) {
          ws[cellAddress].s.alignment = {
            horizontal: "center",
            vertical: "center",
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Employee Data");

    // Generate filename with current date and time
    const now = new Date();
    const dateStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const timeStr =
      String(now.getHours()).padStart(2, "0") +
      "-" +
      String(now.getMinutes()).padStart(2, "0");
    const filename = `Employee_Data_${type}_${dateStr}_${timeStr}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);

    // Show success message
    showAlert(
      `Successfully exported ${employees.length} employee records to ${filename}`,
      "success",
    );
  } catch (error) {
    console.error("Export employee data error:", error);
    showAlert("Error creating Excel file: " + error.message, "error");
  }
}

// Helper function to format dates
function formatDate(dateString) {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // Return original if invalid

    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0") +
      " " +
      String(date.getHours()).padStart(2, "0") +
      ":" +
      String(date.getMinutes()).padStart(2, "0") +
      ":" +
      String(date.getSeconds()).padStart(2, "0")
    );
  } catch (error) {
    console.error("Date formatting error:", error);
    return dateString;
  }
}

function exportToExcel(type = "Filtered") {
  showAlert("Exporting visible data to Excel...", "info");
  // Your export logic here
  try {
    // Get table data
    const tableBody = document.getElementById("employeeTableBody");
    const rows = tableBody.querySelectorAll("tr");

    if (rows.length === 0) {
      showAlert("No data to export!", "warning");
      return;
    }

    // Prepare data array
    const data = [];

    // Add headers
    const headers = [
      "SN",
      "EMPID",
      "Fullname",
      "Position",
      "Brand",
      "Status",
      "Shift",
      "Violation",
      "Proximity Code", // Image column is skipped
      "Register Date",
      "Last Update",
    ];
    data.push(headers);

    // Extract data from table rows
    rows.forEach((row, index) => {
      if (row.style.display !== "none") {
        // Only export visible rows
        const cells = row.querySelectorAll("td");
        if (cells.length > 0) {
          const rowData = [
            cells[0]?.textContent?.trim() || "", // SN
            cells[1]?.textContent?.trim() || "", // EMPID
            cells[2]?.textContent?.trim() || "", // Fullname
            cells[3]?.textContent?.trim() || "", // Position
            cells[4]?.textContent?.trim() || "", // Brand
            cells[5]?.textContent?.trim() || "", // Status
            cells[6]?.textContent?.trim() || "", // Shift
            cells[7]?.textContent?.trim() || "", // Violation
            (() => {
              const onclick = cells[9]?.getAttribute("onclick") || "";
              const match = onclick.match(/copyQRCode\('(.+?)'\)/);
              return match ? match[1] : "";
            })(), // Proximity Code (skip Image column)
            cells[10]?.textContent?.trim() || "",
            cells[11]?.textContent?.trim() || "",
          ];
          data.push(rowData);
        }
      }
    });

    if (data.length <= 1) {
      showAlert("No visible data to export!", "warning");
      return;
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 5 }, // SN
      { wch: 10 }, // EMPID
      { wch: 25 }, // Fullname
      { wch: 20 }, // Position
      { wch: 15 }, // Brand
      { wch: 12 }, // Status
      { wch: 15 }, // Shift
      { wch: 20 }, // Violation
      { wch: 15 }, // Proximity Code
      { wch: 18 }, // Register Date
      { wch: 18 }, // Last Update
    ];
    ws["!cols"] = colWidths;

    // Style the header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    // Add borders to all cells
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.border = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        };

        // Center align SN column
        if (col === 0) {
          ws[cellAddress].s.alignment = {
            horizontal: "center",
            vertical: "center",
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Employee Data");

    // Generate filename with current date
    const now = new Date();
    const dateStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const timeStr =
      String(now.getHours()).padStart(2, "0") +
      "-" +
      String(now.getMinutes()).padStart(2, "0");
    const filename = `Employee_Data_${type}_${dateStr}_${timeStr}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);

    // Show success message
    showAlert(
      `Successfully exported ${
        data.length - 1
      } employee records to ${filename}`,
      "success",
    );
  } catch (error) {
    console.error("Export error:", error);
    showAlert("Error exporting to Excel: " + error.message, "error");
  } finally {
  }

  console.log("Exporting visible data to Excel");

  setTimeout(() => {
    showAlert("Visible data exported successfully!", "success");
  }, 1000);
}

// Enhanced export function with filtering options
async function exportFilteredData() {
  const hasFilters = hasActiveFilters();

  const isFiltered = hasFilters || Object.keys(activeFilters).length > 0;

  if (!isFiltered) {
    exportAllData();
    return;
  }

  showAlert("Exporting filtered data...", "info");

  try {
    if (!employees || employees.length === 0) {
      showAlert("No filtered employee data found!", "warning");
      return;
    }

    exportEmployeeData(employees, "Filtered");
  } catch (error) {
    console.error("Export filtered data error:", error);
    showAlert("Error exporting filtered data: " + error.message, "error");
  }
}

// ─── Dynamic loader for ExcelJS (image-aware Excel library) ───────────────
function loadExcelJS() {
  return new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve();
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load ExcelJS"));
    document.head.appendChild(script);
  });
}

// ─── Resolve image URL from table cell OR fallback to employee ID path ─────
function resolveEmployeeImageUrl(employee, tableRow) {
  // 1. Try to grab <img src> from table cell[8] (the photo column)
  if (tableRow) {
    const imgEl = tableRow.querySelectorAll("td")[8]?.querySelector("img");
    if (imgEl?.src) return imgEl.src;
  }
  // 2. Fallback: construct URL from employee ID (adjust path to match your setup)
  const basePaths = [
    `../uploads/employees/${employee.id}.jpg`,
    `../uploads/employees/${employee.id}.png`,
    `../uploads/${employee.id}.jpg`,
  ];
  return basePaths[0]; // primary guess; others tried inside fetchImageBase64
}

// ─── Fetch an image URL and return { base64, extension } ──────────────────
async function fetchImageBase64(url) {
  const extensions = ["jpg", "jpeg", "png", "webp"];
  const urlsToTry = [url];

  // Also try swapping extension if the primary URL fails
  const base = url.replace(/\.(jpg|jpeg|png|webp)$/i, "");
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

      const ext = blob.type.split("/")[1].replace("jpeg", "jpeg") || "jpeg";
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { base64, extension: ext === "jpeg" ? "jpeg" : ext };
    } catch {
      // try next
    }
  }
  return null; // image not available
}

// ─── Resize & center-crop image to a square using canvas ──────────────────
function resizeImageToSquare(base64, extension, size = 60) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      // Center-crop: scale so the shorter side fills the square
      const scale = Math.max(size / img.width, size / img.height);
      const scaledW = img.width * scale;
      const scaledH = img.height * scale;
      const offsetX = (size - scaledW) / 2;
      const offsetY = (size - scaledH) / 2;

      ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);
      const resizedBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      resolve({ base64: resizedBase64, extension: "jpeg" });
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/${extension === "jpeg" ? "jpeg" : extension};base64,${base64}`;
  });
}

// ─── Main export function ──────────────────────────────────────────────────
async function exportWithImages() {
  showAlert("Preparing export — loading image engine...", "info");

  try {
    await loadExcelJS();
  } catch (err) {
    showAlert("Could not load image export library: " + err.message, "error");
    return;
  }

  // ── Determine which employees to export ──────────────────────────────────
  const hasFilters = hasActiveFilters();
  let exportEmployees = [];
  let exportType = "All";

  if (hasFilters && employees && employees.length > 0) {
    // Use the already-loaded filtered employees array from loadEmployees()
    exportEmployees = employees;
    exportType = "Filtered";
    showAlert(
      `Exporting ${exportEmployees.length} filtered employee(s) with images...`,
      "info",
    );
  } else {
    // No filters active — fetch everything from the server
    showAlert("Fetching all employee data...", "info");
    try {
      exportEmployees = await fetchAllEmployeesForExport();
    } catch (err) {
      showAlert("Error fetching employees: " + err.message, "error");
      return;
    }
  }

  if (!exportEmployees || exportEmployees.length === 0) {
    showAlert("No employee data found!", "warning");
    return;
  }

  // Build a quick lookup: empId → table row (for grabbing existing <img> tags)
  const tableRowMap = {};
  const tableRows =
    document.getElementById("employeeTableBody")?.querySelectorAll("tr") || [];
  tableRows.forEach((row) => {
    const empId = row.querySelectorAll("td")[1]?.textContent?.trim();
    if (empId) tableRowMap[empId] = row;
  });

  showAlert(
    `Building Excel with images for ${exportEmployees.length} employee(s)...`,
    "info",
  );

  // ── Workbook setup ────────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Employee Management System";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Employee Data");

  const ROW_HEIGHT = 55;
  const IMG_COL_WIDTH = 14;
  const IMG_PX_W = 60;
  const IMG_PX_H = 48;

  // ── Column definitions ────────────────────────────────────────────────────
  worksheet.columns = [
    { header: "SN",             key: "sn",         width: 5 },
    { header: "EMPID",          key: "id",         width: 12 },
    { header: "Photo",          key: "photo",      width: IMG_COL_WIDTH },
    { header: "Fullname",       key: "fullname",   width: 26 },
    { header: "Position",       key: "position",   width: 22 },
    { header: "Brand",          key: "brand",      width: 16 },
    { header: "Status",         key: "status",     width: 12 },
    { header: "Shift",          key: "shift",      width: 15 },
    { header: "Violation",      key: "violation",  width: 20 },
    { header: "Proximity Code", key: "qr_code",    width: 16 },
    { header: "Register Date",  key: "created_at", width: 20 },
    { header: "Last Update",    key: "updated_at", width: 20 },
  ];

  // ── Style header row ──────────────────────────────────────────────────────
  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border    = {
      top:    { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      left:   { style: "thin", color: { argb: "FF000000" } },
      right:  { style: "thin", color: { argb: "FF000000" } },
    };
  });

  const borderStyle = {
    top:    { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left:   { style: "thin", color: { argb: "FF000000" } },
    right:  { style: "thin", color: { argb: "FF000000" } },
  };

  // ── Add data rows with images ─────────────────────────────────────────────
  let successCount  = 0;
  let missingImages = 0;

  for (let i = 0; i < exportEmployees.length; i++) {
    const emp      = exportEmployees[i];
    const rowIndex = i + 2; // row 1 = header

    const dataRow = worksheet.addRow({
      sn:         i + 1,
      id:         emp.id || "",
      photo:      "",
      fullname:   toProperCase(emp.fullname),
      position:   toProperCase(emp.position),
      brand:      toProperCase(emp.brand),
      status:     emp.status    || "",
      shift:      emp.shift     || "",
      violation:  emp.violation || "None",
      qr_code:    emp.qr_code   || "",
      created_at: formatDate(emp.created_at),
      updated_at: formatDate(emp.updated_at),
    });

    dataRow.height = ROW_HEIGHT;

    dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border    = borderStyle;
      cell.alignment = {
        vertical:   "middle",
        horizontal: colNum === 1 ? "center" : "left",
        wrapText:   false,
      };
    });

    // ── Embed employee photo ──────────────────────────────────────────────
    const tableRow = tableRowMap[String(emp.id)] || null;
    const imgUrl   = resolveEmployeeImageUrl(emp, tableRow);
    const imgResult = await fetchImageBase64(imgUrl);

    if (imgResult) {
      try {
        const squared = await resizeImageToSquare(
          imgResult.base64,
          imgResult.extension,
          IMG_PX_W,
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
        console.warn(`Could not embed image for ${emp.id}:`, imgErr);
        missingImages++;
      }
    } else {
      missingImages++;
    }
  }

  // ── Generate and download ─────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const now     = new Date();
  const dateStr =
    now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
  const timeStr =
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0");
  const filename = `Employee_Data_${exportType}_With_Images_${dateStr}_${timeStr}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const msg =
    missingImages > 0
      ? `Exported ${exportEmployees.length} records (${successCount} with photos, ${missingImages} without) → ${filename}`
      : `Successfully exported ${exportEmployees.length} employee records with photos → ${filename}`;

  showAlert(msg, missingImages > 0 ? "warning" : "success");
}

function excelTemplate(type = "Template") {
  showAlert("Exporting Excel Template...", "info");
  // Your export logic here
  try {
    // Prepare data array
    const data = [];

    // Add headers
    const headers = [
      "EMPID",
      "Fullname",
      "Position",
      "Brand",
      "Status",
      "Shift",
      "Violation",
      "Proximity Code", // Image column is skipped
    ];
    data.push(headers);

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 10 }, // EMPID
      { wch: 25 }, // Fullname
      { wch: 20 }, // Position
      { wch: 15 }, // Brand
      { wch: 12 }, // Status
      { wch: 15 }, // Shift
      { wch: 20 }, // Violation
      { wch: 15 }, // Proximity Code
    ];
    ws["!cols"] = colWidths;

    // Style the header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    // Add borders to all cells
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.border = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        };

        // Center align SN column
        if (col === 0) {
          ws[cellAddress].s.alignment = {
            horizontal: "center",
            vertical: "center",
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Employee Data");

    const filename = `Excel_${type}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
  } catch (error) {
    console.error("Export error:", error);
    showAlert("Error downloading template: " + error.message, "error");
  } finally {
  }

  console.log("Exporting Excel Template");

  setTimeout(() => {
    showAlert("Excel Template download successfully!", "success");
  }, 1000);
}

// Proximity Export

// Function to fetch all proximity code data bypassing pagination
async function fetchAllCodesForExport() {
  try {
    const response = await fetch("../cnfg/export_proxcode.php?export=all", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return data.employees || [];
    } else {
      throw new Error(data.message || "Failed to fetch proximity code");
    }
  } catch (error) {
    console.error("Fetch proximity codes error:", error);
    throw error;
  }
}

// Function to apply current search filters to proximity code
function applyProximityFilters(proxcodes) {
  const filters = {
    date: document.getElementById("search_date")?.value?.toLowerCase() || "",
    qr_code: document.getElementById("search_qr")?.value?.toLowerCase() || "",
  };

  return proxcodes.filter((proxcode) => {
    // Apply date filter
    if (filters.date && !proxcode.date?.toLowerCase().includes(filters.date)) {
      return false;
    }

    // Apply qr_code filter
    if (
      filters.qr_code &&
      !proxcode.qr_code?.toLowerCase().includes(filters.qr_code)
    ) {
      return false;
    }

    return true;
  });
}

// Function to export all data without filters
function exportAllCodes() {
  showAlert("Exporting all data...", "info");

  try {
    fetchAllCodesForExport()
      .then((proxcode) => {
        if (!proxcode || proxcode.length === 0) {
          showAlert("No proximity code found!", "warning");
          return;
        }

        exportProximityCodes(proxcode, "All");
      })
      .catch((error) => {
        console.error("Export all data error:", error);
        showAlert("Error fetching all data: " + error.message, "error");
      });
  } catch (error) {
    console.error("Export all data error:", error);
    showAlert("Error exporting all data: " + error.message, "error");
  }
}

// Updated helper function to export proximity code array
async function exportProximityCodes(proxcodes, type = "Data") {
  try {
    if (!proxcodes || proxcodes.length === 0) {
      showAlert("No proximity code to export!", "warning");
      return;
    }

    // Prepare data array
    const data = [];

    // Add headers
    const headers = [
      "SN",
      "EMPID",
      "Proximity Code",
      "Remarks",
      "Register Date",
      "Last Update",
    ];
    data.push(headers);

    const systemQRCodes = await getSystemEmployeeQRCodes();

    const qrImageMap = await buildQRToImageMap();

    // Add proximity code
    proxcodes.forEach((proxcode, index) => {
      // 🆕 Check if this proxcode's matches any system.js employee QR code
      const isOccupied = systemQRCodes.includes(
        proxcode.qr_code.trim().toLowerCase(),
      );

      // 🆕 Update proximity remarks dynamically (without backend change)
      const displayRemarks = isOccupied ? "Occupied" : "Available";

      const matchedEmployeeData =
        qrImageMap[proxcode.qr_code.trim().toLowerCase()];

      const empid = matchedEmployeeData ? `${matchedEmployeeData.id}` : "";

      const rowData = [
        String(index + 1), // SN
        empid || "", // Image column is skipped
        proxcode.qr_code || "",
        displayRemarks || "",
        formatDate(proxcode.created_at) || "",
        formatDate(proxcode.updated_at) || "",
      ];
      data.push(rowData);
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 5 }, // SN
      { wch: 10 }, // EMPID
      { wch: 15 }, // Proximity Code
      { wch: 15 }, // Remarks
      { wch: 18 }, // Register Date
      { wch: 18 }, // Last Update
    ];
    ws["!cols"] = colWidths;

    // Style the header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    // Add borders and formatting to all data cells
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { v: "", t: "s" };
        }

        if (!ws[cellAddress].s) ws[cellAddress].s = {};

        // Add borders
        ws[cellAddress].s.border = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        };

        // Center align SN column and Status column
        if (col === 0 || col === 4) {
          ws[cellAddress].s.alignment = {
            horizontal: "center",
            vertical: "center",
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Proximity Code");

    // Generate filename with current date and time
    const now = new Date();
    const dateStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const timeStr =
      String(now.getHours()).padStart(2, "0") +
      "-" +
      String(now.getMinutes()).padStart(2, "0");
    const filename = `Proximity_${type}_${dateStr}_${timeStr}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);

    // Show success message
    showAlert(
      `Successfully exported ${proxcodes.length} proximity code records to ${filename}`,
      "success",
    );
  } catch (error) {
    console.error("Export proximity codes error:", error);
    showAlert("Error creating Excel file: " + error.message, "error");
  }
}

function exportCodesToExcel(type = "Filtered") {
  showAlert("Exporting visible data to Excel...", "info");
  // Your export logic here
  try {
    // Get table data
    const tableBody = document.getElementById("employeeTableBody");
    const rows = tableBody.querySelectorAll("tr");

    if (rows.length === 0) {
      showAlert("No data to export!", "warning");
      return;
    }

    // Prepare data array
    const data = [];

    // Add headers
    const headers = [
      "SN",
      "EMPID", // Image column is skipped
      "Proximity Code",
      "Remarks",
      "Register Date",
      "Last Update",
    ];
    data.push(headers);

    // Extract data from table rows
    rows.forEach((row, index) => {
      if (row.style.display !== "none") {
        // Only export visible rows
        const cells = row.querySelectorAll("td");
        if (cells.length > 0) {
          const rowData = [
            cells[0]?.textContent?.trim() || "", // SN
            cells[2]?.textContent?.trim() || "", // SN
            (() => {
              const onclick = cells[3]?.getAttribute("onclick") || "";
              const match = onclick.match(/copyQRCode\('(.+?)'\)/);
              return match ? match[1] : "";
            })(), // Proximity Code (skip Image column)
            cells[4]?.textContent?.trim() || "", // Remarks
            cells[5]?.textContent?.trim() || "", // Register
            cells[6]?.textContent?.trim() || "", // Update
          ];
          data.push(rowData);
        }
      }
    });

    if (data.length <= 1) {
      showAlert("No visible data to export!", "warning");
      return;
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 5 }, // SN
      { wch: 10 }, // EMPID
      { wch: 15 }, // Proximity Code
      { wch: 15 }, // Remarks
      { wch: 18 }, // Register Date
      { wch: 18 }, // Last Update
    ];
    ws["!cols"] = colWidths;

    // Style the header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    // Add borders to all cells
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.border = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        };

        // Center align SN column
        if (col === 0) {
          ws[cellAddress].s.alignment = {
            horizontal: "center",
            vertical: "center",
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Proximity Code");

    // Generate filename with current date
    const now = new Date();
    const dateStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const timeStr =
      String(now.getHours()).padStart(2, "0") +
      "-" +
      String(now.getMinutes()).padStart(2, "0");
    const filename = `Proximity_${type}_${dateStr}_${timeStr}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);

    // Show success message
    showAlert(
      `Successfully exported ${data.length - 1} proximity code records to ${filename}`,
      "success",
    );
  } catch (error) {
    console.error("Export error:", error);
    showAlert("Error exporting to Excel: " + error.message, "error");
  } finally {
  }

  console.log("Exporting visible data to Excel");

  setTimeout(() => {
    showAlert("Visible data exported successfully!", "success");
  }, 1000);
}

// Enhanced export function with filtering options
async function exportFilteredCodes() {
  const hasFilters = hasActiveFilters();

  const isFiltered = hasFilters || Object.keys(activeFilters).length > 0;

  if (!isFiltered) {
    exportAllCodes();
    return;
  }

  showAlert("Exporting filtered codes...", "info");

  try {
    if (!employees || employees.length === 0) {
      showAlert("No filtered proximity codes found!", "warning");
      return;
    }

    exportProximityCodes(employees, "Filtered");
  } catch (error) {
    console.error("Export filtered codes error:", error);
    showAlert("Error exporting filtered codes: " + error.message, "error");
  }
}

function excelProxCodeTemplate(proxcode = "Proximity Code", type = "Template") {
  showAlert(`Exporting Excel ${proxcode} ${type}...`, "info");
  // Your export logic here
  try {
    // Prepare data array
    const data = [];

    // Add headers
    const headers = [
      proxcode, // Image column is skipped
    ];
    data.push(headers);

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 15 }, // Proximity Code
    ];
    ws["!cols"] = colWidths;

    // Style the header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddress]) continue;

      ws[cellAddress].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    // Add borders to all cells
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.border = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        };

        // Center align SN column
        if (col === 0) {
          ws[cellAddress].s.alignment = {
            horizontal: "center",
            vertical: "center",
          };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Proximity Code");

    const filename = `Excel_Proximity_${type}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
  } catch (error) {
    console.error("Export error:", error);
    showAlert(
      `Error downloading ${toLowerCase(type)}: ` + error.message,
      "error",
    );
  } finally {
  }

  console.log(`Exporting Excel ${type}`);

  setTimeout(() => {
    showAlert(`Excel ${type} download successfully!`, "success");
  }, 1000);
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

// Keyboard navigation
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
