// Enhanced Loading Screen Functions for System.php
function showLoadingScreen() {
  const loadingScreen = document.getElementById("loading-screen");
  const mainContainer = document.querySelector(".container");

  if (loadingScreen) {
    loadingScreen.classList.add("active");
  }
  if (mainContainer) {
    mainContainer.classList.add("loading");
  }
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById("loading-screen");
  const mainContainer = document.querySelector(".container");

  if (loadingScreen) {
    loadingScreen.classList.remove("active");
  }
  if (mainContainer) {
    mainContainer.classList.remove("loading");
  }
}

// Navigation function with loading screen
function navigateWithLoading(url) {
  showLoadingScreen();

  // Add a small delay to show the loading screen
  setTimeout(() => {
    window.location.href = url;
  }, 300);
}

// Show loading screen during AJAX operations
function showLoadingForOperation(operationName = "Processing") {
  const loadingScreen = document.getElementById("loading-screen");
  const loadingText = loadingScreen?.querySelector(".loading-text");
  const loadingSubtext = loadingScreen?.querySelector(".loading-subtext");
  
  if (loadingText) {
    loadingText.textContent = operationName + "...";
  }
  if (loadingSubtext) {
    loadingSubtext.textContent = "Please wait while we process your request";
  }
  
  showLoadingScreen();
}

// Hide loading screen and reset text
function hideLoadingForOperation() {
  const loadingScreen = document.getElementById("loading-screen");
  const loadingText = loadingScreen?.querySelector(".loading-text");
  const loadingSubtext = loadingScreen?.querySelector(".loading-subtext");
  
  if (loadingText) {
    loadingText.textContent = "Loading...";
  }
  if (loadingSubtext) {
    loadingSubtext.textContent = "Please wait while we prepare your content";
  }
  
  hideLoadingScreen();
}

// Show loading screen on page refresh/reload
window.addEventListener("beforeunload", function () {
  showLoadingScreen();
});

// Hide loading screen when page loads
window.addEventListener("load", function () {
  setTimeout(() => {
    hideLoadingScreen();
  }, 500); // Slightly longer delay for system.php
});

// Handle browser back/forward buttons
window.addEventListener("pageshow", function (event) {
  if (event.persisted) {
    hideLoadingScreen();
  }
});

// Hide loading screen on DOM ready (fallback)
document.addEventListener("DOMContentLoaded", function () {
  setTimeout(() => {
    hideLoadingScreen();
  }, 300);
});

// Enhanced functions for system.php specific operations
function showLoadingForSearch() {
  showLoadingForOperation("Searching");
}

function showLoadingForClear() {
  showLoadingForOperation("Clearing Search");
}

function showLoadingForExport() {
  showLoadingForOperation("Exporting Data");
}

function showLoadingForImport() {
  showLoadingForOperation("Importing Data");
}

function showLoadingForDelete() {
  showLoadingForOperation("Deleting");
}

function showLoadingForSave() {
  showLoadingForOperation("Saving");
}

// Override existing functions to include loading screens
const originalSearchEmployees = window.searchEmployees;
if (typeof originalSearchEmployees === 'function') {
  window.searchEmployees = function() {
    showLoadingForSearch();
    
    // Call original function
    const result = originalSearchEmployees.apply(this, arguments);
    
    // Hide loading after a short delay
    setTimeout(() => {
      hideLoadingForOperation();
    }, 800);
    
    return result;
  };
}

// Add loading to form submissions
document.addEventListener('DOMContentLoaded', function() {
  const employeeForm = document.getElementById('employeeForm');
  // const importForm = document.getElementById('importForm');
  
  if (employeeForm) {
    employeeForm.addEventListener('submit', function(e) {
      showLoadingForSave();
      
      // Let the form submit naturally, loading will be hidden on page reload/response
      setTimeout(() => {
        hideLoadingForOperation();
      }, 2000);
    });
  }
  
  // if (importForm) {
  //   importForm.addEventListener('submit', function(e) {
  //     showLoadingForImport();
      
  //     // Let the form submit naturally
  //     setTimeout(() => {
  //       hideLoadingForOperation();
  //     }, 3000);
  //   });
  // }

  // Add loading to export buttons
  const clearButtons = document.querySelectorAll('[onclick*="clear"]');
  clearButtons.forEach(button => {
    button.addEventListener('click', function() {
      showLoadingForClear();
      
      setTimeout(() => {
        hideLoadingForOperation();
      }, 2000);
    });
  });
  
  // Add loading to export buttons
  const exportButtons = document.querySelectorAll('[onclick*="export"]');
  exportButtons.forEach(button => {
    button.addEventListener('click', function() {
      showLoadingForExport();
      
      setTimeout(() => {
        hideLoadingForOperation();
      }, 2000);
    });
  });
  
  // Add loading to delete operations
  const deleteButtons = document.querySelectorAll('[onclick*="delete"]');
  deleteButtons.forEach(button => {
    button.addEventListener('click', function() {
      showLoadingForDelete();
      
      setTimeout(() => {
        hideLoadingForOperation();
      }, 1500);
    });
  });
});

// Utility function to show loading for any custom operation
function showLoadingForCustomOperation(operationName, duration = 2000) {
  showLoadingForOperation(operationName);
  
  setTimeout(() => {
    hideLoadingForOperation();
  }, duration);
}