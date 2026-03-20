// Function to fetch all employees data bypassing pagination
async function fetchAllEmployeesForExport() {
  try {
    const response = await fetch("../cnfg/ea-dtl.php?export=all", {
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
    fullname: document.getElementById("search_fullname")?.value?.toLowerCase() || "",
    position: document.getElementById("search_position")?.value?.toLowerCase() || "",
    brand: document.getElementById("search_brand")?.value?.toLowerCase() || "",
    status: document.getElementById("search_status")?.value || "",
    shift: document.getElementById("search_shift")?.value || "",
    date: document.getElementById("search_date")?.value?.toLowerCase() || "",
    qr_code: document.getElementById("search_qr")?.value?.toLowerCase() || "",
  };

  return employees.filter((employee) => {
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

// Updated helper function to export employee data array
function exportEmployeeData(employees, type = "Data") {
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
      "Full Name",
      "Position",
      "Brand",
      "Status",
      "Shift",
      "Violation",
      "Proximity Code",
      "Timestamp",
      "Check Status",
    ];
    data.push(headers);

    // Add employee data
    employees.forEach((employee, index) => {
      const rowData = [
        index + 1, // SN
        employee.fullname || "",
        employee.position || "",
        employee.brand || "",
        employee.status || "",
        employee.shift || "",
        employee.violation || "None",
        employee.qr_code || "",
        formatDate(employee.access_timestamp) || "",
        employee.check_status || "",
      ];
      data.push(rowData);
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 5 }, // SN
      { wch: 25 }, // Full Name
      { wch: 20 }, // Position
      { wch: 15 }, // Brand
      { wch: 10 }, // Status
      { wch: 15 }, // Shift
      { wch: 15 }, // Violation
      { wch: 15 }, // Proximity Code
      { wch: 20 }, // Timestamp
      { wch: 5 }, // Check Status
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
    const filename = `Scan_History_${type}_${dateStr}_${timeStr}.xlsx`;

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
      String(date.getMinutes()).padStart(2, "0")
    );
  } catch (error) {
    console.error("Date formatting error:", error);
    return dateString;
  }
}

function exportToExcelDTL(type = "Filtered") {
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
      "Full Name",
      "Position",
      "Brand",
      "Status",
      "Shift",
      "Violation",
      "Proximity Code", // Image column is skipped
      "Timestamp",
      "Check Status",
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
            cells[1]?.textContent?.trim() || "", // Full Name
            cells[2]?.textContent?.trim() || "", // Position
            cells[3]?.textContent?.trim() || "", // Brand
            cells[4]?.textContent?.trim() || "", // Status
            cells[5]?.textContent?.trim() || "", // Shift
            cells[6]?.textContent?.trim() || "", // Violation
            cells[8]?.textContent?.trim() || "", // Proximity Code (skip Image column)
            cells[9]?.textContent?.trim() || "", // Timestamp
            cells[10]?.textContent?.trim() || "", // Check Status
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
      { wch: 25 }, // Full Name
      { wch: 20 }, // Position
      { wch: 15 }, // Brand
      { wch: 10 }, // Status
      { wch: 15 }, // Shift
      { wch: 15 }, // Violation
      { wch: 15 }, // Proximity Code
      { wch: 20 }, // Timestamp
      { wch: 5 }, // Check Status
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
    const filename = `Scan_History_${type}_${dateStr}_${timeStr}.xlsx`;

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
function exportFilteredData() {
  showAlert("Exporting filtered data...", "info");
  try {
    // Get current filter values
    const filters = {
      fullname: document.getElementById("search_fullname").value.toLowerCase(),
      position: document.getElementById("search_position").value.toLowerCase(),
      brand: document.getElementById("search_brand").value.toLowerCase(),
      status: document.getElementById("search_status").value,
      shift: document.getElementById("search_shift").value,
      qr_code: document.getElementById("search_qr").value.toLowerCase(),
    };

    // Check if any filters are active
    const hasActiveFilters = Object.values(filters).some(
      (filter) => filter !== "",
    );

    if (hasActiveFilters) {
      const result = confirm(
        "Export filtered data only or export all data?\n\nClick OK to export filtered data\nClick Cancel to export all data",
      );
      if (result) {
        exportToExcelDTL(); // Export only visible/filtered data
      } else {
        exportAllData(); // Export all data regardless of filters
      }
    } else {
      exportToExcelDTL(); // Export all data
    }
  } catch (error) {
    console.error("Export filter error:", error);
    exportToExcelDTL(); // Fallback to regular export
  }

  console.log("Exporting filtered data");

  setTimeout(() => {
    showAlert("Data exported successfully!", "success");
  }, 1500);
}

function exportWithImages() {
  showAlert("Exporting data with images...", "info");
  // Your export logic here
  console.log("Exporting with images");

  setTimeout(() => {
    showAlert("Data with images exported successfully!", "success");
  }, 2000);
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
