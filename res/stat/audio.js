import { useState, useRef } from "react";

const INITIAL_FILES = [
  {
    id: 1,
    name: "podcast_episode_01.mp3",
    size: "45.2 MB",
    duration: "47:32",
    format: "MP3",
    date: "2026-03-20",
    status: "ready",
    bitrate: "192kbps",
  },
  {
    id: 2,
    name: "voiceover_intro.wav",
    size: "12.8 MB",
    duration: "02:15",
    format: "WAV",
    date: "2026-03-22",
    status: "ready",
    bitrate: "1411kbps",
  },
  {
    id: 3,
    name: "ambient_loop_v2.flac",
    size: "78.1 MB",
    duration: "03:44",
    format: "FLAC",
    date: "2026-03-24",
    status: "processing",
    bitrate: "900kbps",
  },
  {
    id: 4,
    name: "interview_raw.m4a",
    size: "31.6 MB",
    duration: "28:10",
    format: "M4A",
    date: "2026-03-25",
    status: "ready",
    bitrate: "256kbps",
  },
  {
    id: 5,
    name: "sfx_package.ogg",
    size: "8.3 MB",
    duration: "05:20",
    format: "OGG",
    date: "2026-03-26",
    status: "error",
    bitrate: "320kbps",
  },
];

const FORMAT_COLORS = {
  MP3: { bg: "#1e3a5f", text: "#7ec8f5" },
  WAV: { bg: "#1a3d2e", text: "#5fcfa0" },
  FLAC: { bg: "#3d2a1a", text: "#f5a75c" },
  M4A: { bg: "#2e1a3d", text: "#c47ef5" },
  OGG: { bg: "#3d1a2a", text: "#f57eae" },
};

const StatusBadge = ({ status }) => {
  const map = {
    ready: { bg: "#0d2e1a", color: "#4ade80", label: "Ready" },
    processing: { bg: "#2a2200", color: "#facc15", label: "Processing" },
    error: { bg: "#2d0d0d", color: "#f87171", label: "Error" },
  };
  const s = map[status] || map.ready;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: 20,
        letterSpacing: "0.03em",
      }}
    >
      {s.label}
    </span>
  );
};

const WaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect
      x="1"
      y="6"
      width="2"
      height="4"
      rx="1"
      fill="currentColor"
      opacity="0.6"
    />
    <rect x="4.5" y="3" width="2" height="10" rx="1" fill="currentColor" />
    <rect
      x="8"
      y="1"
      width="2"
      height="14"
      rx="1"
      fill="currentColor"
      opacity="0.8"
    />
    <rect x="11.5" y="4" width="2" height="8" rx="1" fill="currentColor" />
  </svg>
);

export default function AudioDatabase() {
  const [tab, setTab] = useState("database");
  const [files, setFiles] = useState(INITIAL_FILES);
  const [selected, setSelected] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState({
    maxFileSize: 500,
    allowedFormats: ["MP3", "WAV", "FLAC", "M4A", "OGG", "AAC"],
    autoConvert: false,
    convertTo: "MP3",
    storageLimit: 10,
    autoTag: true,
    waveformGen: true,
    defaultBitrate: "192",
    namingScheme: "{date}_{original}",
    retention: "forever",
    duplicateCheck: true,
    notifications: true,
  });
  const fileInputRef = useRef();

  const filtered = files.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.format.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleSelect = (id) => {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  };

  const deleteSelected = () => {
    setFiles((f) => f.filter((x) => !selected.includes(x.id)));
    setSelected([]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("audio/"),
    );
    const newFiles = dropped.map((f, i) => ({
      id: Date.now() + i,
      name: f.name,
      size: (f.size / 1048576).toFixed(1) + " MB",
      duration: "--:--",
      format: f.name.split(".").pop().toUpperCase(),
      date: new Date().toISOString().slice(0, 10),
      status: "processing",
      bitrate: "—",
    }));
    setFiles((prev) => [...newFiles, ...prev]);
  };

  const updateSetting = (key, val) =>
    setSettings((s) => ({ ...s, [key]: val }));
  const toggleFormat = (fmt) => {
    setSettings((s) => ({
      ...s,
      allowedFormats: s.allowedFormats.includes(fmt)
        ? s.allowedFormats.filter((f) => f !== fmt)
        : [...s.allowedFormats, fmt],
    }));
  };

  const totalSize = files
    .reduce((acc, f) => acc + parseFloat(f.size), 0)
    .toFixed(1);

  return (
    <div
      style={{
        fontFamily: "'DM Mono', 'Courier New', monospace",
        background: "#0c0e12",
        color: "#c8cdd8",
        minHeight: "100vh",
        padding: 0,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div
        style={{
          background: "#111318",
          borderBottom: "1px solid #1e2330",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              background: "#f59e0b",
              width: 32,
              height: 32,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0c0e12",
            }}
          >
            <WaveIcon />
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: 16,
                fontWeight: 700,
                color: "#f1f3f7",
                letterSpacing: "-0.02em",
              }}
            >
              AudioVault
            </div>
            <div style={{ fontSize: 11, color: "#555e73" }}>
              {files.length} files · {totalSize} MB
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["database", "settings"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? "#1e2330" : "transparent",
                border:
                  tab === t ? "1px solid #2e3548" : "1px solid transparent",
                color: tab === t ? "#f1f3f7" : "#555e73",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "'DM Mono', monospace",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "database" && (
        <div style={{ padding: 24 }}>
          {/* Stats row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {[
              { label: "Total Files", val: files.length },
              {
                label: "Ready",
                val: files.filter((f) => f.status === "ready").length,
              },
              {
                label: "Processing",
                val: files.filter((f) => f.status === "processing").length,
              },
              { label: "Storage Used", val: totalSize + " MB" },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: "#111318",
                  border: "1px solid #1e2330",
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{ fontSize: 11, color: "#555e73", marginBottom: 4 }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 500,
                    color: "#f1f3f7",
                    fontFamily: "'Syne', sans-serif",
                  }}
                >
                  {s.val}
                </div>
              </div>
            ))}
          </div>

          {/* Upload zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragging ? "#f59e0b" : "#2e3548"}`,
              borderRadius: 12,
              padding: "28px 16px",
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 20,
              background: dragging ? "#1a1500" : "#0e1016",
              transition: "all 0.2s",
            }}
          >
            <div
              style={{
                fontSize: 28,
                marginBottom: 8,
                color: dragging ? "#f59e0b" : "#2e3548",
              }}
            >
              ↑
            </div>
            <div style={{ fontSize: 13, color: "#6b7591" }}>
              Drop audio files here or{" "}
              <span style={{ color: "#f59e0b" }}>browse</span>
            </div>
            <div style={{ fontSize: 11, color: "#3a4155", marginTop: 4 }}>
              MP3, WAV, FLAC, M4A, OGG — max {settings.maxFileSize}MB
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              style={{ display: "none" }}
            />
          </div>

          {/* Search + actions */}
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 16,
              alignItems: "center",
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files..."
              style={{
                flex: 1,
                background: "#111318",
                border: "1px solid #1e2330",
                color: "#c8cdd8",
                padding: "8px 14px",
                borderRadius: 7,
                fontSize: 13,
                fontFamily: "'DM Mono', monospace",
                outline: "none",
              }}
            />
            {selected.length > 0 && (
              <button
                onClick={deleteSelected}
                style={{
                  background: "#2d0d0d",
                  border: "1px solid #5c1a1a",
                  color: "#f87171",
                  padding: "8px 14px",
                  borderRadius: 7,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                Delete ({selected.length})
              </button>
            )}
          </div>

          {/* File table */}
          <div
            style={{
              background: "#111318",
              border: "1px solid #1e2330",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "36px 1fr 80px 80px 70px 90px 90px",
                gap: 0,
                borderBottom: "1px solid #1e2330",
                padding: "8px 16px",
                fontSize: 10,
                color: "#3a4155",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <div />
              <div>Name</div>
              <div>Format</div>
              <div>Duration</div>
              <div>Size</div>
              <div>Date</div>
              <div>Status</div>
            </div>
            {filtered.length === 0 && (
              <div
                style={{
                  padding: 32,
                  textAlign: "center",
                  color: "#3a4155",
                  fontSize: 13,
                }}
              >
                No files found
              </div>
            )}
            {filtered.map((f, i) => {
              const fmtColor = FORMAT_COLORS[f.format] || FORMAT_COLORS.MP3;
              const isSelected = selected.includes(f.id);
              return (
                <div
                  key={f.id}
                  onClick={() => toggleSelect(f.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr 80px 80px 70px 90px 90px",
                    padding: "10px 16px",
                    alignItems: "center",
                    background: isSelected
                      ? "#161a25"
                      : i % 2 === 0
                        ? "transparent"
                        : "#0e1016",
                    borderBottom: "1px solid #1a1f2c",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: `1.5px solid ${isSelected ? "#f59e0b" : "#2e3548"}`,
                      background: isSelected ? "#f59e0b" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isSelected && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#0c0e12",
                          fontWeight: 700,
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#c8cdd8",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {f.name}
                  </div>
                  <div>
                    <span
                      style={{
                        background: fmtColor.bg,
                        color: fmtColor.text,
                        fontSize: 10,
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontWeight: 500,
                      }}
                    >
                      {f.format}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7591" }}>
                    {f.duration}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7591" }}>{f.size}</div>
                  <div style={{ fontSize: 11, color: "#3a4155" }}>{f.date}</div>
                  <div>
                    <StatusBadge status={f.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div style={{ padding: 24, maxWidth: 720 }}>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 18,
              fontWeight: 700,
              color: "#f1f3f7",
              marginBottom: 6,
              letterSpacing: "-0.02em",
            }}
          >
            Upload Settings
          </div>
          <div style={{ fontSize: 12, color: "#555e73", marginBottom: 24 }}>
            Configure how audio files are stored and processed
          </div>

          {/* Section: Storage */}
          <SettingsCard title="Storage">
            <SettingsRow
              label="Max file size"
              hint={`${settings.maxFileSize} MB`}
            >
              <input
                type="range"
                min="10"
                max="2000"
                step="10"
                value={settings.maxFileSize}
                onChange={(e) => updateSetting("maxFileSize", +e.target.value)}
                style={{ width: 160 }}
              />
            </SettingsRow>
            <SettingsRow
              label="Storage limit"
              hint={`${settings.storageLimit} GB`}
            >
              <input
                type="range"
                min="1"
                max="100"
                value={settings.storageLimit}
                onChange={(e) => updateSetting("storageLimit", +e.target.value)}
                style={{ width: 160 }}
              />
            </SettingsRow>
            <SettingsRow label="Retention policy">
              <select
                value={settings.retention}
                onChange={(e) => updateSetting("retention", e.target.value)}
                style={{
                  background: "#1a1f2c",
                  border: "1px solid #2e3548",
                  color: "#c8cdd8",
                  padding: "5px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                <option value="forever">Keep forever</option>
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="1y">1 year</option>
              </select>
            </SettingsRow>
          </SettingsCard>

          {/* Section: Formats */}
          <SettingsCard title="Allowed formats">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["MP3", "WAV", "FLAC", "M4A", "OGG", "AAC", "AIFF", "OPUS"].map(
                (fmt) => {
                  const on = settings.allowedFormats.includes(fmt);
                  const c = FORMAT_COLORS[fmt] || {
                    bg: "#1a1f2c",
                    text: "#6b7591",
                  };
                  return (
                    <button
                      key={fmt}
                      onClick={() => toggleFormat(fmt)}
                      style={{
                        background: on ? c.bg : "#111318",
                        border: `1px solid ${on ? c.text + "44" : "#1e2330"}`,
                        color: on ? c.text : "#3a4155",
                        padding: "5px 12px",
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "'DM Mono', monospace",
                        transition: "all 0.15s",
                      }}
                    >
                      {fmt}
                    </button>
                  );
                },
              )}
            </div>
          </SettingsCard>

          {/* Section: Processing */}
          <SettingsCard title="Processing">
            <SettingsRow label="Auto-convert uploads">
              <Toggle
                val={settings.autoConvert}
                set={(v) => updateSetting("autoConvert", v)}
              />
            </SettingsRow>
            {settings.autoConvert && (
              <SettingsRow label="Convert to">
                <select
                  value={settings.convertTo}
                  onChange={(e) => updateSetting("convertTo", e.target.value)}
                  style={{
                    background: "#1a1f2c",
                    border: "1px solid #2e3548",
                    color: "#c8cdd8",
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: "'DM Mono', monospace",
                  }}
                >
                  {["MP3", "WAV", "FLAC", "OGG", "AAC"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </SettingsRow>
            )}
            <SettingsRow label="Default bitrate">
              <select
                value={settings.defaultBitrate}
                onChange={(e) =>
                  updateSetting("defaultBitrate", e.target.value)
                }
                style={{
                  background: "#1a1f2c",
                  border: "1px solid #2e3548",
                  color: "#c8cdd8",
                  padding: "5px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                {["96", "128", "192", "256", "320"].map((b) => (
                  <option key={b} value={b}>
                    {b}kbps
                  </option>
                ))}
              </select>
            </SettingsRow>
            <SettingsRow label="Generate waveform">
              <Toggle
                val={settings.waveformGen}
                set={(v) => updateSetting("waveformGen", v)}
              />
            </SettingsRow>
            <SettingsRow label="Auto-tag metadata">
              <Toggle
                val={settings.autoTag}
                set={(v) => updateSetting("autoTag", v)}
              />
            </SettingsRow>
          </SettingsCard>

          {/* Section: Naming */}
          <SettingsCard title="File naming">
            <SettingsRow label="Naming scheme">
              <input
                value={settings.namingScheme}
                onChange={(e) => updateSetting("namingScheme", e.target.value)}
                style={{
                  background: "#1a1f2c",
                  border: "1px solid #2e3548",
                  color: "#c8cdd8",
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                  width: 220,
                }}
              />
            </SettingsRow>
            <div style={{ fontSize: 11, color: "#3a4155", marginTop: 6 }}>
              Variables: <code style={{ color: "#f59e0b" }}>{"{date}"}</code>{" "}
              <code style={{ color: "#f59e0b" }}>{"{original}"}</code>{" "}
              <code style={{ color: "#f59e0b" }}>{"{format}"}</code>{" "}
              <code style={{ color: "#f59e0b" }}>{"{index}"}</code>
            </div>
          </SettingsCard>

          {/* Section: Misc */}
          <SettingsCard title="General">
            <SettingsRow label="Duplicate file check">
              <Toggle
                val={settings.duplicateCheck}
                set={(v) => updateSetting("duplicateCheck", v)}
              />
            </SettingsRow>
            <SettingsRow label="Upload notifications">
              <Toggle
                val={settings.notifications}
                set={(v) => updateSetting("notifications", v)}
              />
            </SettingsRow>
          </SettingsCard>

          {/* Save */}
          <button
            style={{
              background: "#f59e0b",
              color: "#0c0e12",
              border: "none",
              padding: "10px 28px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'Syne', sans-serif",
              letterSpacing: "-0.01em",
            }}
          >
            Save settings
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsCard({ title, children }) {
  return (
    <div
      style={{
        background: "#111318",
        border: "1px solid #1e2330",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 12,
          fontWeight: 600,
          color: "#555e73",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingsRow({ label, hint, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 13, color: "#c8cdd8" }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "#555e73" }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ val, set }) {
  return (
    <div
      onClick={() => set(!val)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        background: val ? "#f59e0b" : "#1e2330",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: val ? 20 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: val ? "#0c0e12" : "#3a4155",
          transition: "left 0.2s",
        }}
      />
    </div>
  );
}
