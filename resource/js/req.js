// resource/js/req.js --> portal access + global session expiry handler + fetch/XHR interceptor

(function () {
  "use strict";

  var _redirecting = false;
  var isLoginPage = !!document.getElementById("loginForm");

  function getRootUrl() {
    return (
      window.location.protocol + "//" + window.location.host + ROUTE_LOGIN
    );
  }

  function handleSessionExpired(redirectUrl) {
    if (_redirecting) return;
    _redirecting = true;

    var dest = redirectUrl || getRootUrl();

    showSessionBanner();

    fetch("/app/http/auth/session_logout.php", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .catch(function () {})
      .finally(function () {
        setTimeout(function () {
          if (window.top) {
            window.top.location.href = dest;
          } else {
            window.location.href = dest;
          }
        }, 1200);
      });
  }

  function isUnauthenticatedResponse(data) {
    return (
      data &&
      (data.unauthenticated === true ||
        (data.success === false &&
          data.message &&
          data.message.toLowerCase().includes("session")))
    );
  }

  // ── Session expired banner ────────────────────────────────────────────────
  function showSessionBanner() {
    var existing = document.getElementById("__session_expired_banner__");
    if (existing) existing.remove();

    var banner = document.createElement("div");
    banner.id = "__session_expired_banner__";
    banner.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:100%",
      "z-index:999999",
      "background:#dc2626",
      "color:#fff",
      "font-family:Segoe UI,sans-serif",
      "font-size:14px",
      "font-weight:600",
      "padding:14px 20px",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "box-shadow:0 2px 12px rgba(0,0,0,.3)",
      "animation:__slideDown__ .25s ease",
    ].join(";");

    if (!document.getElementById("__session_expired_style__")) {
      var style = document.createElement("style");
      style.id = "__session_expired_style__";
      style.textContent =
        "@keyframes __slideDown__{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}";
      document.head.appendChild(style);
    }

    var spinner = document.createElement("span");
    spinner.style.cssText =
      "width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;flex-shrink:0";

    if (!document.querySelector("style[data-spin]")) {
      var spinStyle = document.createElement("style");
      spinStyle.setAttribute("data-spin", "1");
      spinStyle.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(spinStyle);
    }

    var icon = document.createElement("span");
    icon.innerHTML = "&#x1F512;"; // 🔒
    icon.style.fontSize = "16px";

    var text = document.createElement("span");
    text.textContent = "Session expired — redirecting to login…";

    banner.appendChild(icon);
    banner.appendChild(spinner);
    banner.appendChild(text);

    try {
      if (window.top && window.top !== window) {
        window.top.document.body.appendChild(banner);
      } else {
        document.body.appendChild(banner);
      }
    } catch (e) {
      document.body.appendChild(banner);
    }
  }

  // ── Intercept fetch() ─────────────────────────────────────────────────────
  var _origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    init = init || {};
    init.headers = init.headers || {};

    if (init.headers instanceof Headers) {
      if (!init.headers.has("X-Requested-With")) {
        init.headers.set("X-Requested-With", "XMLHttpRequest");
      }
    } else {
      if (!init.headers["X-Requested-With"]) {
        init.headers["X-Requested-With"] = "XMLHttpRequest";
      }
    }

    return _origFetch(input, init).then(function (response) {
      if (!isLoginPage && response.status === 401) {
        var cloned = response.clone();
        cloned
          .json()
          .then(function (data) {
            if (isUnauthenticatedResponse(data)) {
              handleSessionExpired(data.redirect);
            }
          })
          .catch(function () {
            handleSessionExpired();
          });
      }
      return response;
    });
  };

  // ── Intercept XMLHttpRequest ──────────────────────────────────────────────
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    if (!isLoginPage) {
      this.addEventListener("load", function () {
        if (this.status === 401) {
          try {
            var data = JSON.parse(this.responseText);
            if (isUnauthenticatedResponse(data)) {
              handleSessionExpired(data.redirect);
            }
          } catch (e) {
            handleSessionExpired();
          }
        }
      });
    }
    return _origOpen.apply(this, arguments);
  };

  // ── Periodic session heartbeat ─────────────────────────────────────────────
  var HEARTBEAT_INTERVAL = 30000; // 30 seconds

  function heartbeat() {
    _origFetch("/app/http/auth/session_check.php", {
      method: "GET",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then(function (res) {
        if (res.status === 401) {
          res
            .json()
            .then(function (data) {
              handleSessionExpired(data.redirect);
            })
            .catch(function () {
              handleSessionExpired();
            });
        }
      })
      .catch(function () {});
  }

  if (!document.getElementById("loginForm")) {
    setInterval(heartbeat, HEARTBEAT_INTERVAL);
  }
})();

// ── Password visibility toggle ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  var toggleBtn = document.getElementById("togglePassword");
  var passwordField = document.getElementById("portal_password");

  if (!toggleBtn || !passwordField) return;

  toggleBtn.addEventListener("click", function () {
    var isPassword = passwordField.type === "password";

    passwordField.type = isPassword ? "text" : "password";

    var icon = toggleBtn.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-eye", !isPassword);
      icon.classList.toggle("fa-eye-slash", isPassword);
    }

    passwordField.focus();
  });
});