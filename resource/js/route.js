// resource/js/route.js — dispatchers ONLY,

const RESOLVE = "/config/resolve.php";

async function resolveEndpoints() {
  const tokenMap = {
    employees: window.__API_ROUTES?.["api-employees"],
    datalog: window.__API_ROUTES?.["api-datalog"],
    proximity: window.__API_ROUTES?.["api-proximity"],
    remarks: window.__API_ROUTES?.["api-remarks"],
    attendance: window.__API_ROUTES?.["api-attendance"],
    qrproximity: window.__API_ROUTES?.["api-qrproximity"],
    scantest: window.__API_ROUTES?.["api-scanTest"],
    audio: window.__API_ROUTES?.["api-audio"],
    notification: window.__API_ROUTES?.["api-notification"],
    userid: window.__API_ROUTES?.["api-userId"],
  };

  // Only resolve tokens that are actually defined on this page
  const entries = Object.entries(tokenMap).filter(([, token]) => token != null);
  if (!entries.length) return true;

  const responses = await Promise.all(
    entries.map(([, token]) =>
      fetch(RESOLVE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    ),
  );

  // if (responses.some((r) => r.status === 403)) {
  //   window.top.location.href = ROUTE_LOGIN;
  //   return false;
  // }

  const results = await Promise.all(responses.map((r) => r.json()));

  const varMap = {
    employees: (url) => {
      EmployeesBackend = url;
    },
    datalog: (url) => {
      AccessLogBackend = url;
    },
    proximity: (url) => {
      ProxcodeBackend = url;
    },
    remarks: (url) => {
      ViolationBackend = url;
    },
    attendance: (url) => {
      AttendanceBackend = url;
    },
    qrproximity: (url) => {
      QrProximityBackend = url;
    },
    scantest: (url) => {
      ScanTestBackend = url;
    },
    audio: (url) => {
      GlobalAudioBackend = url;
    },
    notification: (url) => {
      NotificationBackend = url;
      window.__NotificationBackend = url;
    },
    userid: (url) => {
      UserIdHelper = url;
    },
  };

  entries.forEach(([key], i) => {
    if (results[i]?.url) varMap[key](results[i].url);
  });

  return true;
}

document.querySelectorAll("[data-action]").forEach((el) => {
  el.addEventListener("click", () => {
    const action = el.dataset.action;
    const token  = window.__ROUTES?.[action];
    if (!token) return;
    fetch(RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (r.status === 403) {
          window.location.href = ROUTE_LOGIN;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data?.url) return;
        if (typeof window.__ptlOpenTab === "function") {
          window.__ptlOpenTab(action, data.url);
        }
        document.querySelector(".frames").src = data.url;
      });
  });
});

document.querySelectorAll("[data-action-dir]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const token = window.__DIR_ROUTES?.[el.dataset.actionDir];
    if (!token) return;
    fetch(RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (r.status === 403) {
          window.top.location.href = ROUTE_LOGIN;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.url) window.top.location.href = data.url;
      });
  });
});

document.querySelectorAll("[data-action-root]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const token = window.__DIR_ROUTES?.[el.dataset.actionRoot];
    if (!token) return;
    fetch(RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (r.status === 403) {
          window.location.href = ROUTE_LOGIN;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.url) window.location.href = data.url;
      });
  });
});

document.querySelectorAll("[data-action-app]").forEach((el) => {
  el.addEventListener("click", () => {
    const token = window.__APP_ROUTES?.[el.dataset.actionApp];
    if (!token) return;
    fetch(RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (r.status === 403) {
          window.location.href = ROUTE_LOGIN;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.url) navigateWithLoading(data.url);
      });
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const token = window.__ROUTES?.["portal-home"];
  if (!token) return;
  fetch(RESOLVE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data?.url) document.querySelector(".frames").src = data.url;
    });
});

const tabBar = document.querySelector(".tab-bar");

function setTabBarVisible(visible) {
  if (!tabBar) return;

  tabBar.style.display = visible ? "flex" : "none";

  const mainWrap = document.querySelector(".main-wrap");
  if (!mainWrap) return;

  mainWrap.style.marginTop = visible
    ? "calc(var(--topbar-h) * 2)"
    : "var(--topbar-h)";
  mainWrap.style.height = visible
    ? "calc(100vh - var(--topbar-h) * 2)"
    : "calc(100vh - var(--topbar-h))";
}

document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;

  const action = el.dataset.action;
  setTabBarVisible(action !== "portal-employees");
});

window.__endpointsReady = resolveEndpoints();
