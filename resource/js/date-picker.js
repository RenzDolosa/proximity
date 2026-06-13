// resource/js/date-picker.js --> single-date picker

(function () {

  // ── State ────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let selectedDate = new Date(today);
  let calYear      = selectedDate.getFullYear();
  let calMonth     = selectedDate.getMonth();
  let isOpen       = false;

  const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];

  // ── Pill ─────────────────────────────────────────────────────────
  function buildPill() {
    const host = document.getElementById("lb_date_pill");
    if (!host) return;
    host.innerHTML = `
      <i class="fas fa-calendar-day date-range-icon"></i>
      <span class="drp-display" id="lb_drp_display"></span>
    `;
    host.style.cursor = "pointer";
    host.addEventListener("click", toggleDropdown);
    updatePillDisplay();
  }

  function updatePillDisplay() {
    const el = document.getElementById("lb_drp_display");
    if (!el) return;
    const isToday = toISO(selectedDate) === toISO(today);
    el.innerHTML = isToday
      ? `<span class="drp-val">Today</span><span class="drp-sep"> · </span><span class="drp-placeholder">${formatDisplay(selectedDate)}</span>`
      : `<span class="drp-val">${formatDisplay(selectedDate)}</span>`;
  }

  // ── Dropdown ──────────────────────────────────────────────────────
  function buildDropdown() {
    const existing = document.getElementById("lb_drp_dropdown");
    if (existing) existing.remove();

    const dd = document.createElement("div");
    dd.id        = "lb_drp_dropdown";
    dd.className = "lb-drp-dropdown";
    Object.assign(dd.style, {
      display:  "none",
      position: "fixed",
      zIndex:   "999999",
      minWidth: "0",
      width:    "auto",
    });

    dd.innerHTML = `
      <div class="drp-main">
        <div class="drp-top-inputs">
          <div class="drp-top-cell" style="flex:1;">
            <input type="text" id="lb_drp_input" class="drp-top-date"
              placeholder="YYYY-MM-DD" maxlength="10" autocomplete="off"
              style="width:100%;">
          </div>
        </div>
        <div class="drp-calendars">
          <div class="drp-cal" id="lb_drp_cal"></div>
        </div>
        <div class="drp-footer">
          <button class="drp-btn-clear" id="lb_drp_today">Today</button>
          <button class="drp-btn-ok"    id="lb_drp_ok">Apply</button>
        </div>
      </div>`;

    document.body.appendChild(dd);
    renderCalendar();
    wireDropdown();
  }

  // ── Calendar ──────────────────────────────────────────────────────
  function renderCalendar() {
    const container = document.getElementById("lb_drp_cal");
    if (!container) return;

    const firstDay    = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrev  = new Date(calYear, calMonth, 0).getDate();
    const selTs       = selectedDate.getTime();
    const todayTs     = today.getTime();

    let html = `
      <div class="drp-cal-header">
        <button class="drp-nav" id="lb_prev_y">«</button>
        <button class="drp-nav" id="lb_prev_m">‹</button>
        <span class="drp-cal-title">${calYear} ${MONTHS[calMonth]}</span>
        <button class="drp-nav" id="lb_next_m">›</button>
        <button class="drp-nav" id="lb_next_y">»</button>
      </div>
      <table class="drp-cal-table">
        <thead><tr>${DAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
        <tbody>`;

    const cells = [];
    for (let i = firstDay - 1; i >= 0; i--)
      cells.push({
        day:   daysInPrev - i,
        month: calMonth === 0 ? 11 : calMonth - 1,
        year:  calMonth === 0 ? calYear - 1 : calYear,
        faded: true,
      });
    for (let d = 1; d <= daysInMonth; d++)
      cells.push({ day: d, month: calMonth, year: calYear, faded: false });
    const rem = 42 - cells.length;
    for (let d = 1; d <= rem; d++)
      cells.push({
        day:   d,
        month: calMonth === 11 ? 0 : calMonth + 1,
        year:  calMonth === 11 ? calYear + 1 : calYear,
        faded: true,
      });

    cells.forEach((cell, i) => {
      if (i % 7 === 0) html += "<tr>";
      const cd = new Date(cell.year, cell.month, cell.day);
      cd.setHours(0, 0, 0, 0);
      const ts  = cd.getTime();
      const cls = ["drp-day"];
      if (cell.faded)                  cls.push("drp-day-faded");
      if (ts === todayTs)              cls.push("drp-day-today");
      if (!cell.faded && ts === selTs) cls.push("drp-day-start");
      html += `<td class="${cls.join(" ")}" data-date="${toISO(cd)}">${cell.day}</td>`;
      if (i % 7 === 6) html += "</tr>";
    });

    html += "</tbody></table>";
    container.innerHTML = html;

    document.getElementById("lb_prev_y").onclick = () => { calYear--;  renderCalendar(); };
    document.getElementById("lb_next_y").onclick = () => { calYear++;  renderCalendar(); };
    document.getElementById("lb_prev_m").onclick = () => {
      if (--calMonth < 0)  { calMonth = 11; calYear--; }
      renderCalendar();
    };
    document.getElementById("lb_next_m").onclick = () => {
      if (++calMonth > 11) { calMonth = 0;  calYear++; }
      renderCalendar();
    };

    container.querySelectorAll("td.drp-day:not(.drp-day-faded)").forEach((td) => {
      td.addEventListener("click", () => {
        selectedDate = parseISO(td.dataset.date);
        syncInput();
        renderCalendar();
      });
    });

    syncInput();
  }

  // ── Dropdown events ───────────────────────────────────────────────
  function wireDropdown() {
    const input = document.getElementById("lb_drp_input");

    function applyTextInput() {
      const val = input.value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
      const d = parseISO(val);
      if (isNaN(d.getTime())) return;
      selectedDate = d;
      calYear  = d.getFullYear();
      calMonth = d.getMonth();
      renderCalendar();
    }

    if (input) {
      input.addEventListener("blur",    applyTextInput);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); applyTextInput(); }
      });
    }

    document.getElementById("lb_drp_today").addEventListener("click", () => {
      selectedDate = new Date(today);
      calYear  = today.getFullYear();
      calMonth = today.getMonth();
      syncInput();
      renderCalendar();
    });

    document.getElementById("lb_drp_ok").addEventListener("click", commitSelection);
  }

  // ── Open / close ──────────────────────────────────────────────────
  function toggleDropdown() { isOpen ? closeDropdown() : openDropdown(); }

  function openDropdown() {
    const dd   = document.getElementById("lb_drp_dropdown");
    const pill = document.getElementById("lb_date_pill");
    if (!dd || !pill) return;

    isOpen = true;
    dd.style.visibility = "hidden";
    dd.style.display    = "block";

    const rect   = pill.getBoundingClientRect();
    const ddRect = dd.getBoundingClientRect();
    const gap    = 4;

    let left = rect.left;
    if (left + ddRect.width > window.innerWidth - 8)
      left = Math.max(8, rect.right - ddRect.width);

    let top = rect.bottom + gap;
    if (top + ddRect.height > window.innerHeight - 8)
      top = rect.top - ddRect.height - gap;

    dd.style.top        = Math.round(top)  + "px";
    dd.style.left       = Math.round(left) + "px";
    dd.style.visibility = "visible";

    calYear  = selectedDate.getFullYear();
    calMonth = selectedDate.getMonth();
    renderCalendar();
  }

  function closeDropdown() {
    const dd = document.getElementById("lb_drp_dropdown");
    if (dd) dd.style.display = "none";
    isOpen = false;
  }

  // ── Global events ─────────────────────────────────────────────────
  document.addEventListener("click", function (e) {
    if (!isOpen || !e.target.isConnected) return;
    const dd   = document.getElementById("lb_drp_dropdown");
    const pill = document.getElementById("lb_date_pill");
    if (dd && !dd.contains(e.target) && pill && !pill.contains(e.target))
      closeDropdown();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) closeDropdown();
  });

  // ── Commit ────────────────────────────────────────────────────────
  function commitSelection() {
    updatePillDisplay();
    closeDropdown();
    if (typeof window.onLbDateChange === "function")
      window.onLbDateChange(toISO(selectedDate));
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function syncInput() {
    const input = document.getElementById("lb_drp_input");
    if (input) input.value = toISO(selectedDate);
  }

  function toISO(d) {
    return d.getFullYear() + "-"
      + String(d.getMonth() + 1).padStart(2, "0") + "-"
      + String(d.getDate()).padStart(2, "0");
  }

  function parseISO(str) {
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function formatDisplay(d) {
    return d.toLocaleDateString("en-PH", {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  window.initLbDatePicker = function () {
    buildPill();
    buildDropdown();
  };

})();