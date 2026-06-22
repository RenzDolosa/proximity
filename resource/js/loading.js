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
    const SKELETON_PAGES = [
      "system",
      "datalog",
      "proximity-code",
      "violation-log",
      "attendance-log",
    ];
    const currentPage = document.body?.dataset?.page || "";
    const isSkeletonPage = SKELETON_PAGES.includes(currentPage);

    window.addEventListener("beforeunload", () => this.show());

    window.addEventListener("load", () => {
      if (!isSkeletonPage) {
        setTimeout(() => this.hide(), 500);
      }
    });

    window.addEventListener("pageshow", (event) => {
      if (event.persisted) this.hide();
    });

    document.addEventListener("DOMContentLoaded", () => {
      if (!isSkeletonPage) {
        setTimeout(() => this.hide(), 300);
      }
    });
  },

  getElements() {
    return {
      screen: document.getElementById("loading-screen"),
      content: document.querySelector(".loading-content"),
      spinner: document.querySelector(".spinner"),
      text: document.querySelector(".loading-text"),
      subtext: document.querySelector(".loading-subtext"),
      container: document.querySelector(".container"),
    };
  },

  show(options = {}) {
    const {
      text = "Loading",
      subtext = "Please wait while we prepare your content",
      type = "default",
      showProgress = false,
    } = options;

    const elements = this.getElements();
    if (!elements.screen) return;

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    if (elements.text) elements.text.textContent = text + "...";
    if (elements.subtext) elements.subtext.textContent = subtext;
    if (elements.spinner && elements.spinner.isConnected) {
      elements.spinner.className = "spinner";
      if (type === "dots") {
        elements.spinner.classList.add("dots");
        elements.spinner.innerHTML =
          '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      }
    }

    this.updateProgress(showProgress);

    elements.screen?.classList.add("active");
    elements.content?.classList.remove("error", "success");
    elements.container?.classList.add("loading");

    this.isActive = true;
  },

  hide() {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);

    const elements = this.getElements();
    if (!elements.screen) return;

    elements.screen?.classList.remove("active");
    elements.container?.classList.remove("loading");

    this.isActive = false;
  },

  showSuccess(text = "Success", duration = 1500) {
    const elements = this.getElements();
    if (!elements.content) return;

    elements.content.classList.add("success");
    if (elements.text) elements.text.textContent = text;
    if (elements.subtext) elements.subtext.textContent = "Operation completed";

    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => this.hide(), duration);
  },

  showError(text = "Error", duration = 2000) {
    const elements = this.getElements();
    if (!elements.content) return;

    elements.content.classList.add("error");
    if (elements.text) elements.text.textContent = text;
    if (elements.subtext)
      elements.subtext.textContent = "Please try again or contact support";

    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => this.hide(), duration);
  },

  updateProgress(show = false) {
    let progressBar = document.querySelector(".loading-progress");

    if (show) {
      if (!progressBar) {
        const content = document.querySelector(".loading-content");
        if (!content) return;
        if (content) {
          const progress = document.createElement("div");
          progress.className = "loading-progress";
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
  },
};

// ── Initialize on script load ────
LoadingManager.init();

// ── Legacy API ──────────────────
function showLoadingScreen() {
  LoadingManager.show();
}

function hideLoadingScreen() {
  LoadingManager.hide();
}

const SKELETON_PAGES = [
  "system",
  "datalog",
  "proximity-code",
  "violation-log",
  "attendance-log",
];

function navigateWithLoading(url) {
  const isSkeletonDest = SKELETON_PAGES.some((page) => url.includes(page));

  if (isSkeletonDest) {
    LoadingManager.show({
      text: "Loading",
      subtext: "Redirecting...",
    });
    window.location.href = url;
  } else {
    LoadingManager.show({
      text: "Loading",
      subtext: "Redirecting...",
    });
    window.location.href = url;
    setTimeout(() => LoadingManager.hide(), 3000);
  }
}

function showLoadingForOperation(operationName = "Processing") {
  LoadingManager.show({
    text: operationName,
    subtext: "Please wait while we process your request",
  });
}

function hideLoadingForOperation() {
  LoadingManager.hide();
}

function showLoadingForSearch() {
  LoadingManager.show({
    text: "Searching",
    subtext: "Looking for employees...",
  });
}

function showLoadingForClear() {
  LoadingManager.show({
    text: "Clearing Search",
    subtext: "Refreshing results...",
  });
}

function showLoadingForExport() {
  LoadingManager.show({
    text: "Exporting Data",
    subtext: "Preparing your download...",
    showProgress: true,
  });
}

function showLoadingForImport() {
  LoadingManager.show({
    text: "Importing Data",
    subtext: "Processing file...",
    showProgress: true,
  });
}

function showLoadingForDelete() {
  LoadingManager.show({
    text: "Deleting",
    subtext: "Please wait...",
  });
}

function showLoadingForSave() {
  LoadingManager.show({
    text: "Saving",
    subtext: "Storing information...",
  });
}

function showLoadingForCustomOperation(operationName, duration = 2000) {
  LoadingManager.show({
    text: operationName,
    subtext: "Please wait...",
  });

  setTimeout(() => {
    LoadingManager.hide();
  }, duration);
}

// ── Enhanced form submission handling ──
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll('[data-action="export"]').forEach((button) => {
    button.addEventListener("click", function () {
      showLoadingForExport();
      setTimeout(() => LoadingManager.hide(), 2000);
    });
  });

  document.querySelectorAll('[data-action="import"]').forEach((button) => {
    button.addEventListener("click", function () {
      showLoadingForImport();
      setTimeout(() => LoadingManager.hide(), 3000);
    });
  });

  document.querySelectorAll('[data-action="delete"]').forEach((button) => {
    button.addEventListener("click", function () {
      showLoadingForDelete();
      setTimeout(() => LoadingManager.hide(), 1500);
    });
  });

  const searchInput = document.getElementById("search_employee");
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener("input", function () {
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
  document.addEventListener("DOMContentLoaded", function () {
    const nav = document.querySelector("nav, header.navbar, .navbar");
    if (nav) nav.style.display = "none";
  });
}

// ── AJAX request interceptor ──
const originalFetch = window.fetch;
window.fetch = function (...args) {
  const options = args[1] || {};
  const headers = options.headers || {};

  const isSilent =
    headers["X-Silent-Request"] === "true" ||
    (typeof isAutoUpdating !== "undefined" && isAutoUpdating);

  const method = (options.method || "GET").toUpperCase();
  const isWrite = method !== "GET";

  if (!isSilent && isWrite) {
    LoadingManager.show({ text: "Loading", type: "dots" });
  }

  return originalFetch.apply(this, args).finally(() => {
    if (!isSilent && isWrite) {
      setTimeout(() => LoadingManager.hide(), 300);
    }
  });
};

// ── Export for external use ──
if (typeof module !== "undefined" && module.exports) {
  module.exports = LoadingManager;
}
