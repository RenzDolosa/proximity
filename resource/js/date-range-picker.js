// resource/js/date-range-picker.js --> date picker

(function () {
  // ── State ────────────────────────────────────────────────────────
  let startDate = null;
  let endDate = null;
  let hoverDate = null;
  let leftYear, leftMonth;
  let picking = "start";
  let isOpen = false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Init ─────────────────────────────────────────────────────────
  function initDateRangePicker() {
    leftYear = today.getFullYear();
    leftMonth = today.getMonth();
    buildPill();
    buildDropdown();
    wireEvents();
  }

  // ── Pill markup ──────────────────────────────────────────────────
  function buildPill() {
    const host = document.getElementById("date_range_pill");
    if (!host) return;

    host.innerHTML = `
      <i class="fas fa-clock date-range-icon"></i>
      <span class="drp-display" id="drp_display">
        <span class="drp-placeholder">Start Date</span>
        <span class="drp-sep"> - </span>
        <span class="drp-placeholder">End Date</span>
      </span>
      <button type="button" id="date_range_clear" class="date-range-clear" title="Clear dates" style="display:none;">✕</button>
      <input type="hidden" id="f_from" name="date_from">
      <input type="hidden" id="f_to"   name="date_to">
    `;

    host.style.cursor = "pointer";
    host.addEventListener("click", function (e) {
      if (e.target.id === "date_range_clear") return;
      toggleDropdown();
    });

    document
      .getElementById("date_range_clear")
      .addEventListener("click", function (e) {
        e.stopPropagation();
        clearDateRange();
      });
  }

  // ── Dropdown markup ──────────────────────────────────────────────
  function buildDropdown() {
    const existing = document.getElementById("drp_dropdown");
    if (existing) existing.remove();

    const dd = document.createElement("div");
    dd.id = "drp_dropdown";
    dd.className = "drp-dropdown";
    dd.style.display = "none";

    dd.innerHTML = `
      <div class="drp-inner">
        <div class="drp-presets">
          <button class="drp-preset" data-preset="last_week">Last week</button>
          <button class="drp-preset" data-preset="last_month">Last month</button>
          <button class="drp-preset" data-preset="last_3months">Last three months</button>
        </div>
        <div class="drp-main">
          <div class="drp-top-inputs">
            <div class="drp-top-cell">
              <input type="text" id="drp_start_input" class="drp-top-date"
                     placeholder="Start Date" maxlength="10" autocomplete="off">
            </div>
            <span class="drp-arrow">›</span>
            <div class="drp-top-cell">
              <input type="text" id="drp_end_input" class="drp-top-date"
                     placeholder="End Date" maxlength="10" autocomplete="off">
            </div>
          </div>
          <div class="drp-calendars">
            <div class="drp-cal" id="drp_cal_left"></div>
            <div class="drp-cal" id="drp_cal_right"></div>
          </div>
          <div class="drp-footer">
            <button class="drp-btn-clear" id="drp_btn_clear">Clear</button>
            <button class="drp-btn-ok" id="drp_btn_ok" disabled style="opacity:0.4;cursor:not-allowed;">OK</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dd);
    renderCalendars();
    wireDropdownEvents();

    const calWrap = dd.querySelector(".drp-calendars");

    calWrap.addEventListener("click", function (e) {
      const td = e.target.closest("td.drp-day");
      if (!td) return;

      const d = parseCellDate(td.dataset.date);

      if (picking === "start") {
        startDate = d;
        endDate = null;
        hoverDate = null;
        picking = "end";
      } else {
        if (startDate && d < startDate) {
          endDate = new Date(startDate);
          startDate = d;
          hoverDate = null;
          picking = "start";
        } else {
          endDate = d;
          hoverDate = null;
          picking = "start";
        }
      }

      syncTopInputs();
      renderCalendars();
    });

    calWrap.addEventListener("mousemove", function (e) {
      if (picking !== "end" || !startDate) return;
      const td = e.target.closest("td.drp-day");

      if (!td) {
        if (hoverDate) {
          hoverDate = null;
          renderCalendars();
        }
        return;
      }

      const d = parseCellDate(td.dataset.date);
      if (!hoverDate || hoverDate.getTime() !== d.getTime()) {
        hoverDate = d;
        renderCalendars();
      }
    });

    calWrap.addEventListener("mouseleave", function () {
      if (picking === "end" && hoverDate) {
        hoverDate = null;
        renderCalendars();
      }
    });
  }

  // ── Global events ─────────────────────────────────────────────────
  function wireEvents() {
    document.addEventListener("click", function (e) {
      if (!isOpen) return;
      if (!e.target.isConnected) return;
      const dd = document.getElementById("drp_dropdown");
      const pill = document.getElementById("date_range_pill");
      if (dd && !dd.contains(e.target) && pill && !pill.contains(e.target)) {
        closeDropdown();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) closeDropdown();
    });
  }

  // ── Open / close ──────────────────────────────────────────────────
  function toggleDropdown() {
    isOpen ? closeDropdown() : openDropdown();
  }

  function openDropdown() {
    const dd = document.getElementById("drp_dropdown");
    const pill = document.getElementById("date_range_pill");
    if (!dd || !pill) return;

    hoverDate = null;
    isOpen = true;

    dd.style.visibility = "hidden";
    dd.style.display = "block";
    dd.style.position = "fixed";

    const rect = pill.getBoundingClientRect();
    const ddRect = dd.getBoundingClientRect();
    const gap = 4;

    let left = rect.left;
    if (left + ddRect.width > window.innerWidth - 8) {
      left = Math.max(8, rect.right - ddRect.width);
    }

    let top = rect.bottom + gap;
    if (top + ddRect.height > window.innerHeight - 8) {
      top = rect.top - ddRect.height - gap;
    }

    dd.style.top = Math.round(top) + "px";
    dd.style.left = Math.round(left) + "px";
    dd.style.zIndex = "999999";
    dd.style.visibility = "visible";

    syncTopInputs();
    renderCalendars();
  }

  function closeDropdown() {
    const dd = document.getElementById("drp_dropdown");
    if (dd) dd.style.display = "none";
    isOpen = false;
    hoverDate = null;
  }

  // ── Dropdown internal events ──────────────────────────────────────
  function wireDropdownEvents() {
    document.querySelectorAll(".drp-preset").forEach((btn) => {
      btn.addEventListener("click", function () {
        applyPreset(this.dataset.preset);
      });
    });

    const startInput = document.getElementById("drp_start_input");
    const endInput = document.getElementById("drp_end_input");

    function applyTextInput(input, isStart) {
      const val = input.value.trim();
      if (!val) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
      const d = parseInputDate(val);
      if (isNaN(d.getTime())) return;

      if (isStart) {
        startDate = d;
        picking = "end";
        if (endDate && endDate < startDate) endDate = null;
      } else {
        if (startDate && d >= startDate) {
          endDate = d;
          picking = "start";
        } else if (!startDate) {
          endDate = d;
        }
      }
      syncTopInputs();
      renderCalendars();
    }

    if (startInput) {
      startInput.addEventListener("blur", () =>
        applyTextInput(startInput, true),
      );
      startInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyTextInput(startInput, true);
        }
      });
    }
    if (endInput) {
      endInput.addEventListener("blur", () => applyTextInput(endInput, false));
      endInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyTextInput(endInput, false);
        }
      });
    }

    document
      .getElementById("drp_btn_clear")
      .addEventListener("click", clearDateRange);
    document
      .getElementById("drp_btn_ok")
      .addEventListener("click", commitSelection);
  }

  // ── OK button state ───────────────────────────────────────────────
  function syncOkButton() {
    const btn = document.getElementById("drp_btn_ok");
    if (!btn) return;
    const ready = !!(startDate && endDate);
    btn.disabled = !ready;
    btn.style.opacity = ready ? "1" : "0.4";
    btn.style.cursor = ready ? "pointer" : "not-allowed";
  }

  // ── Calendar rendering ────────────────────────────────────────────
  function renderCalendars() {
    const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
    const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

    renderMonth("drp_cal_left", leftYear, leftMonth, true);
    renderMonth("drp_cal_right", rightYear, rightMonth, false);
    syncOkButton();
  }

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  function renderMonth(containerId, year, month, isLeft) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    const prevHTML = isLeft
      ? `<button class="drp-nav" id="drp_prev">«</button>
         <button class="drp-nav" id="drp_prev_m">‹</button>`
      : `<span style="width:44px;display:inline-block;"></span>`;

    const nextHTML = !isLeft
      ? `<button class="drp-nav" id="drp_next_m">›</button>
         <button class="drp-nav" id="drp_next">»</button>`
      : `<span style="width:44px;display:inline-block;"></span>`;

    let html = `
      <div class="drp-cal-header">
        ${prevHTML}
        <span class="drp-cal-title">${year} ${MONTHS[month]}</span>
        ${nextHTML}
      </div>
      <table class="drp-cal-table">
        <thead><tr>${DAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
        <tbody>
    `;

    const cells = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({
        day: daysInPrev - i,
        month: month - 1,
        year: month === 0 ? year - 1 : year,
        faded: true,
      });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, month, year, faded: false });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({
        day: d,
        month: month + 1,
        year: month === 11 ? year + 1 : year,
        faded: true,
      });
    }

    const startTs = startDate ? startDate.getTime() : null;
    const endTs = endDate ? endDate.getTime() : null;
    const hoverTs = hoverDate ? hoverDate.getTime() : null;
    const todayTs = today.getTime();

    const isHoverBefore =
      picking === "end" &&
      startTs !== null &&
      hoverTs !== null &&
      hoverTs < startTs;
    const isHoverAfter =
      picking === "end" &&
      startTs !== null &&
      hoverTs !== null &&
      hoverTs > startTs;

    const rangeStartTs =
      endTs !== null ? startTs : isHoverBefore ? hoverTs : startTs;

    const rangeEndTs =
      endTs !== null
        ? endTs
        : isHoverBefore
          ? startTs
          : isHoverAfter
            ? hoverTs
            : null;

    for (let i = 0; i < cells.length; i++) {
      if (i % 7 === 0) html += "<tr>";

      const cell = cells[i];
      const cellDate = new Date(cell.year, cell.month, cell.day);
      cellDate.setHours(0, 0, 0, 0);
      const ts = cellDate.getTime();

      const classes = ["drp-day"];
      if (cell.faded) classes.push("drp-day-faded");
      if (ts === todayTs) classes.push("drp-day-today");

      if (!cell.faded) {
        if (startTs !== null && ts === startTs) classes.push("drp-day-start");
        if (endTs !== null && ts === endTs) classes.push("drp-day-end");

        if (rangeStartTs !== null && rangeEndTs !== null) {
          if (ts > rangeStartTs && ts < rangeEndTs)
            classes.push("drp-day-range");

          if (endTs === null) {
            if (isHoverBefore && ts === hoverTs) classes.push("drp-day-start");

            const hoverEndTs = isHoverBefore
              ? startTs
              : isHoverAfter
                ? hoverTs
                : null;
            if (hoverEndTs !== null && ts === hoverEndTs)
              classes.push("drp-day-hover-end");
          }
        }
      }

      const iso = toISO(cellDate);
      html += `<td class="${classes.join(" ")}" data-date="${iso}">${cell.day}</td>`;
      if (i % 7 === 6) html += "</tr>";
    }

    html += "</tbody></table>";
    container.innerHTML = html;

    const prevBtn = document.getElementById("drp_prev");
    const prevMBtn = document.getElementById("drp_prev_m");
    const nextMBtn = document.getElementById("drp_next_m");
    const nextBtn = document.getElementById("drp_next");

    if (prevBtn)
      prevBtn.onclick = () => {
        leftYear--;
        renderCalendars();
      };
    if (prevMBtn)
      prevMBtn.onclick = () => {
        leftMonth--;
        if (leftMonth < 0) {
          leftMonth = 11;
          leftYear--;
        }
        renderCalendars();
      };
    if (nextMBtn)
      nextMBtn.onclick = () => {
        leftMonth++;
        if (leftMonth > 11) {
          leftMonth = 0;
          leftYear++;
        }
        renderCalendars();
      };
    if (nextBtn)
      nextBtn.onclick = () => {
        leftYear++;
        renderCalendars();
      };
  }

  // ── Presets ───────────────────────────────────────────────────────
  function applyPreset(preset) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    endDate = new Date(now);

    if (preset === "last_week") {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
    } else if (preset === "last_month") {
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
    } else if (preset === "last_3months") {
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 3);
    }

    picking = "start";
    hoverDate = null;
    leftMonth = startDate.getMonth();
    leftYear = startDate.getFullYear();

    syncTopInputs();
    renderCalendars();
    commitSelection();
  }

  // ── Commit (OK) ───────────────────────────────────────────────────
  function commitSelection() {
    if (!startDate || !endDate) return;

    document.getElementById("f_from").value = toISO(startDate);
    document.getElementById("f_to").value = toISO(endDate);

    updatePillDisplay();
    syncDateRangeUI();
    closeDropdown();

    if (typeof onDateRangeChange === "function") onDateRangeChange();
  }

  // ── Clear ─────────────────────────────────────────────────────────
  window.clearDateRange = function () {
    startDate = null;
    endDate = null;
    hoverDate = null;
    picking = "start";

    const fFrom = document.getElementById("f_from");
    const fTo = document.getElementById("f_to");
    if (fFrom) fFrom.value = "";
    if (fTo) fTo.value = "";

    updatePillDisplay();
    syncDateRangeUI();
    syncTopInputs();
    renderCalendars();

    if (typeof onDateRangeChange === "function") onDateRangeChange();
  };

  // ── Pill display ──────────────────────────────────────────────────
  function updatePillDisplay() {
    const display = document.getElementById("drp_display");
    if (!display) return;

    if (startDate || endDate) {
      const s = startDate ? formatDisplay(startDate) : "—";
      const e = endDate ? formatDisplay(endDate) : "—";
      display.innerHTML = `
        <span class="drp-val">${s}</span>
        <span class="drp-sep"> - </span>
        <span class="drp-val">${e}</span>`;
    } else {
      display.innerHTML = `
        <span class="drp-placeholder">Start Date</span>
        <span class="drp-sep"> - </span>
        <span class="drp-placeholder">End Date</span>`;
    }
  }

  function syncDateRangeUI() {
    const hasValue = !!(startDate || endDate);
    const clearBtn = document.getElementById("date_range_clear");
    const pill = document.getElementById("date_range_pill");
    if (clearBtn) clearBtn.style.display = hasValue ? "inline-block" : "none";
    if (pill) pill.classList.toggle("has-value", hasValue);
  }

  // ── Top input sync ────────────────────────────────────────────────
  function syncTopInputs() {
    const si = document.getElementById("drp_start_input");
    const ei = document.getElementById("drp_end_input");
    if (si) si.value = startDate ? toISO(startDate) : "";
    if (ei) ei.value = endDate ? toISO(endDate) : "";
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function parseInputDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function parseCellDate(iso) {
    return parseInputDate(iso);
  }

  function formatDisplay(d) {
    return d.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  window.initDateRangePicker = initDateRangePicker;

  window.getDateRange = function () {
    return {
      from: document.getElementById("f_from")?.value || "",
      to: document.getElementById("f_to")?.value || "",
    };
  };
})();
