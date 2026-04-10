// resource/js/loading.js --> improved loading UI

// ── Loading State Manager ──
const LoadingManager = {
  isActive: false,
  hideTimeout: null,
  operations: new Map(),

  init() {
    this.setupEventListeners();
  },

  setupEventListeners() {
    // Show loading on navigation
    window.addEventListener('beforeunload', () => this.show());

    // Hide loading on page ready
    window.addEventListener('load', () => {
      setTimeout(() => this.hide(), 500);
    });

    // Handle back/forward navigation
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.hide();
      }
    });

    // DOM ready fallback
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => this.hide(), 300);
    });
  },

  getElements() {
    return {
      screen: document.getElementById('loading-screen'),
      content: document.querySelector('.loading-content'),
      spinner: document.querySelector('.spinner'),
      text: document.querySelector('.loading-text'),
      subtext: document.querySelector('.loading-subtext'),
      container: document.querySelector('.container')
    };
  },

  show(options = {}) {
    const {
      text = 'Loading',
      subtext = 'Please wait while we prepare your content',
      type = 'default',
      showProgress = false
    } = options;

    const elements = this.getElements();
    if (!elements.screen) return;

    // Clear any pending hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    // Update text content
    if (elements.text) elements.text.textContent = text + '...';
    if (elements.subtext) elements.subtext.textContent = subtext;

    // Update spinner type
    if (elements.spinner) {
      elements.spinner.className = 'spinner';
      if (type === 'dots') {
        elements.spinner.classList.add('dots');
        elements.spinner.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      }
    }

    // Show progress bar if requested
    this.updateProgress(showProgress);

    // Add active class
    elements.screen?.classList.add('active');
    elements.content?.classList.remove('error', 'success');
    elements.container?.classList.add('loading');

    this.isActive = true;
  },

  hide() {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);

    const elements = this.getElements();
    if (!elements.screen) return;

    // Remove active class
    elements.screen?.classList.remove('active');
    elements.container?.classList.remove('loading');

    this.isActive = false;
  },

  showSuccess(text = 'Success', duration = 1500) {
    const elements = this.getElements();
    if (!elements.content) return;

    elements.content.classList.add('success');
    if (elements.text) elements.text.textContent = text;
    if (elements.subtext) elements.subtext.textContent = 'Operation completed';

    // Auto hide after duration
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => this.hide(), duration);
  },

  showError(text = 'Error', duration = 2000) {
    const elements = this.getElements();
    if (!elements.content) return;

    elements.content.classList.add('error');
    if (elements.text) elements.text.textContent = text;
    if (elements.subtext) elements.subtext.textContent = 'Please try again or contact support';

    // Auto hide after duration
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => this.hide(), duration);
  },

  updateProgress(show = false) {
    let progressBar = document.querySelector('.loading-progress');

    if (show) {
      if (!progressBar) {
        const content = document.querySelector('.loading-content');
        if (content) {
          const progress = document.createElement('div');
          progress.className = 'loading-progress';
          progress.innerHTML = '<div class="loading-progress-bar"></div>';
          content.appendChild(progress);
        }
      }
    } else if (progressBar) {
      progressBar.remove();
    }
  },

  setOperation(key, duration = 2000) {
    this.show();
    
    if (this.operations.has(key)) {
      clearTimeout(this.operations.get(key));
    }

    const timeout = setTimeout(() => {
      this.hide();
      this.operations.delete(key);
    }, duration);

    this.operations.set(key, timeout);
  }
};

// ── Initialize on script load ──
LoadingManager.init();

// ── Legacy API (backward compatibility) ──
function showLoadingScreen() {
  LoadingManager.show();
}

function hideLoadingScreen() {
  LoadingManager.hide();
}

function navigateWithLoading(url) {
  LoadingManager.show({
    text: 'Loading',
    subtext: 'Redirecting...'
  });

  setTimeout(() => {
    window.location.href = url;
  }, 300);
}

function showLoadingForOperation(operationName = 'Processing') {
  LoadingManager.show({
    text: operationName,
    subtext: 'Please wait while we process your request'
  });
}

function hideLoadingForOperation() {
  LoadingManager.hide();
}

function showLoadingForSearch() {
  LoadingManager.show({
    text: 'Searching',
    subtext: 'Looking for employees...'
  });
}

function showLoadingForClear() {
  LoadingManager.show({
    text: 'Clearing Search',
    subtext: 'Refreshing results...'
  });
}

function showLoadingForExport() {
  LoadingManager.show({
    text: 'Exporting Data',
    subtext: 'Preparing your download...',
    showProgress: true
  });
}

function showLoadingForImport() {
  LoadingManager.show({
    text: 'Importing Data',
    subtext: 'Processing file...',
    showProgress: true
  });
}

function showLoadingForDelete() {
  LoadingManager.show({
    text: 'Deleting',
    subtext: 'Please wait...'
  });
}

function showLoadingForSave() {
  LoadingManager.show({
    text: 'Saving',
    subtext: 'Storing information...'
  });
}

function showLoadingForCustomOperation(operationName, duration = 2000) {
  LoadingManager.show({
    text: operationName,
    subtext: 'Please wait...'
  });

  setTimeout(() => {
    LoadingManager.hide();
  }, duration);
}

// ── Enhanced form submission handling ──
document.addEventListener('DOMContentLoaded', function() {
  // Handle employee form submission
  const employeeForm = document.getElementById('employeeForm');
  if (employeeForm) {
    employeeForm.addEventListener('submit', function() {
      LoadingManager.show({
        text: 'Saving',
        subtext: 'Storing employee information...'
      });
    });
  }

  // Handle export buttons
  document.querySelectorAll('[data-action="export"]').forEach(button => {
    button.addEventListener('click', function() {
      showLoadingForExport();
      setTimeout(() => LoadingManager.hide(), 2000);
    });
  });

  // Handle import buttons
  document.querySelectorAll('[data-action="import"]').forEach(button => {
    button.addEventListener('click', function() {
      showLoadingForImport();
      setTimeout(() => LoadingManager.hide(), 3000);
    });
  });

  // Handle delete buttons
  document.querySelectorAll('[data-action="delete"]').forEach(button => {
    button.addEventListener('click', function() {
      showLoadingForDelete();
      setTimeout(() => LoadingManager.hide(), 1500);
    });
  });

  // Handle search input
  const searchInput = document.getElementById('search_employee');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      if (this.value.length > 0) {
        showLoadingForSearch();
        searchTimeout = setTimeout(() => LoadingManager.hide(), 1000);
      }
    });
  }
});

// ── Hide nav in iframe mode ──
if (window.self !== window.top) {
  document.addEventListener('DOMContentLoaded', function() {
    const nav = document.querySelector('nav, header.navbar, .navbar');
    if (nav) nav.style.display = 'none';
  });
}

// ── AJAX request interceptor (if using fetch/xhr) ──
const originalFetch = window.fetch;
window.fetch = function(...args) {
  // ✅ Check for opt-out header set by background requests
  const options = args[1] || {};
  const headers = options.headers || {};
  const isSilent = 
    headers['X-Silent-Request'] === 'true' ||
    typeof isAutoUpdating !== 'undefined' && isAutoUpdating;

  if (!isSilent) {
    LoadingManager.show({
      text: 'Loading',
      type: 'dots'
    });
  }

  return originalFetch.apply(this, args).finally(() => {
    if (!isSilent) {
      setTimeout(() => LoadingManager.hide(), 300);
    }
  });
};

// ── Export for external use ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoadingManager;
}