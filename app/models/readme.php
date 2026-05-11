<?php
// resource/views/iframe/readme.php --> renders Readme.md (built-in parser, no dependencies)

require_once __DIR__ . '/../../config/config.php';

// Auth guard
if (!isset($_SESSION['user_id'])) {
  header('Location: ../../index.php');
  exit;
}

// ── Lightweight Markdown → HTML converter (no external dependency) ────────────
function parseMarkdown(string $md): string
{
  $md = htmlspecialchars($md, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

  $lines   = explode("\n", $md);
  $html    = '';
  $inPre   = false;
  $inUl    = false;
  $inOl    = false;
  $inTable = false;
  $tableHeader = false;
  $buffer  = [];

  $flushList = function () use (&$inUl, &$inOl, &$html) {
    if ($inUl) { $html .= "</ul>\n"; $inUl = false; }
    if ($inOl) { $html .= "</ol>\n"; $inOl = false; }
  };
  $flushTable = function () use (&$inTable, &$html) {
    if ($inTable) { $html .= "</tbody></table>\n"; $inTable = false; }
  };

  foreach ($lines as $line) {
    $trimmed = rtrim($line);

    // ── Fenced code block ──
    if (preg_match('/^```/', $trimmed)) {
      if ($inPre) {
        $html .= "</code></pre>\n";
        $inPre = false;
      } else {
        $flushList();
        $flushTable();
        $html .= '<pre><code>';
        $inPre = true;
      }
      continue;
    }
    if ($inPre) { $html .= $trimmed . "\n"; continue; }

    // ── Blank line ──
    if ($trimmed === '') {
      $flushList();
      $flushTable();
      $html .= "\n";
      continue;
    }

    // ── Headings ──
    if (preg_match('/^(#{1,6})\s+(.+)$/', $trimmed, $m)) {
      $flushList(); $flushTable();
      $lvl = strlen($m[1]);
      $txt = inline($m[2]);
      // anchor slug for table-of-contents links
      $slug = preg_replace('/[^a-z0-9\-]/', '', strtolower(str_replace(' ', '-', strip_tags($txt))));
      $html .= "<h{$lvl} id=\"{$slug}\">{$txt}</h{$lvl}>\n";
      continue;
    }

    // ── Horizontal rule ──
    if (preg_match('/^[-*_]{3,}$/', $trimmed)) {
      $flushList(); $flushTable();
      $html .= "<hr>\n";
      continue;
    }

    // ── Unordered list ──
    if (preg_match('/^[-*+]\s+(.+)$/', $trimmed, $m)) {
      $flushTable();
      if (!$inUl) { if ($inOl) { $html .= "</ol>\n"; $inOl = false; } $html .= "<ul>\n"; $inUl = true; }
      $html .= '<li>' . inline($m[1]) . "</li>\n";
      continue;
    }

    // ── Ordered list ──
    if (preg_match('/^\d+\.\s+(.+)$/', $trimmed, $m)) {
      $flushTable();
      if (!$inOl) { if ($inUl) { $html .= "</ul>\n"; $inUl = false; } $html .= "<ol>\n"; $inOl = true; }
      $html .= '<li>' . inline($m[1]) . "</li>\n";
      continue;
    }

    // ── Table ──
    if (preg_match('/^\|.+\|$/', $trimmed)) {
      $flushList();
      $cells = array_map('trim', explode('|', trim($trimmed, '|')));
      if (preg_match('/^[\|\s\-:]+$/', $trimmed)) {
        $html .= "<tbody>\n";
        $tableHeader = false;
        continue;
      }
      if (!$inTable) {
        $html .= '<table><thead><tr>';
        foreach ($cells as $c) $html .= '<th>' . inline($c) . '</th>';
        $html .= "</tr></thead>\n";
        $inTable = true;
        $tableHeader = true;
        continue;
      }
      $html .= '<tr>';
      foreach ($cells as $c) $html .= '<td>' . inline($c) . '</td>';
      $html .= "</tr>\n";
      continue;
    }

    // ── Blockquote ──
    if (preg_match('/^>\s*(.*)$/', $trimmed, $m)) {
      $flushList(); $flushTable();
      $html .= '<blockquote>' . inline($m[1]) . "</blockquote>\n";
      continue;
    }

    // ── Paragraph ──
    $flushList(); $flushTable();
    $html .= '<p>' . inline($trimmed) . "</p>\n";
  }

  if ($inPre)   $html .= "</code></pre>\n";
  if ($inUl)    $html .= "</ul>\n";
  if ($inOl)    $html .= "</ol>\n";
  if ($inTable) $html .= "</tbody></table>\n";

  return $html;
}

// Inline formatting: bold, italic, code, links
function inline(string $s): string
{
  $s = preg_replace('/`([^`]+)`/', '<code>$1</code>', $s);
  $s = preg_replace('/\*\*(.+?)\*\*/', '<strong>$1</strong>', $s);
  $s = preg_replace('/(?<!\w)__(.+?)__(?!\w)/', '<strong>$1</strong>', $s);
  $s = preg_replace('/\*(.+?)\*/', '<em>$1</em>', $s);
  $s = preg_replace('/(?<!\w)_([^_]+)_(?!\w)/', '<em>$1</em>', $s);
  $s = preg_replace(
    '/\[([^\]]+)\]\((#[a-z0-9\-]+)\)/',
    '<a href="$2">$1</a>',
    $s
  );
  $s = preg_replace(
    '/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/',
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    $s
  );
  return $s;
}

$readmePath = __DIR__ . '/../../Readme.md';
$html = '';

if (file_exists($readmePath)) {
  $html = parseMarkdown(file_get_contents($readmePath));
} else {
  $html = '<p style="color:#e53e3e;">Readme.md not found.</p>';
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>README</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html {
      scroll-behavior: smooth;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      color: #1e293b;
      background: #f8fafc;
      padding: 32px 24px 60px;
    }

    .readme-wrap {
      max-width: 860px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 36px 40px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }

    /* ── Typography ── */
    .readme-wrap h1,
    .readme-wrap h2,
    .readme-wrap h3 {
      scroll-margin-top: 20px;
    }
    .readme-wrap h1 {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .readme-wrap h2 {
      font-size: 17px;
      font-weight: 700;
      color: #1e293b;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 6px;
      margin: 32px 0 14px;
    }
    .readme-wrap h3 {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      margin: 22px 0 10px;
    }
    .readme-wrap p {
      line-height: 1.75;
      color: #334155;
      margin-bottom: 12px;
    }
    .readme-wrap a {
      color: #2563eb;
      text-decoration: none;
    }
    .readme-wrap a:hover { text-decoration: underline; }

    /* ── Lists ── */
    .readme-wrap ul, .readme-wrap ol {
      padding-left: 22px;
      margin-bottom: 14px;
    }
    .readme-wrap li {
      line-height: 1.75;
      color: #334155;
      margin-bottom: 4px;
    }

    /* ── Code ── */
    .readme-wrap code {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 1px 5px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 12.5px;
      color: #c7254e;
    }
    .readme-wrap pre {
      background: #1e2433;
      border-radius: 8px;
      padding: 16px 18px;
      overflow-x: auto;
      margin-bottom: 16px;
    }
    .readme-wrap pre code {
      background: none;
      border: none;
      color: #e2e8f0;
      font-size: 12.5px;
      padding: 0;
    }

    /* ── Tables ── */
    .readme-wrap table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      font-size: 13px;
    }
    .readme-wrap th {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
      color: #475569;
    }
    .readme-wrap td {
      border: 1px solid #e2e8f0;
      padding: 8px 12px;
      color: #334155;
      vertical-align: top;
    }
    .readme-wrap tr:nth-child(even) td { background: #f8fafc; }

    /* ── Blockquote / HR ── */
    .readme-wrap blockquote {
      border-left: 4px solid #2563eb;
      background: #eff6ff;
      padding: 10px 16px;
      border-radius: 0 6px 6px 0;
      margin-bottom: 14px;
      color: #1e40af;
    }
    .readme-wrap hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 28px 0;
    }

    /* ── Header bar ── */
    .readme-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
      padding-bottom: 14px;
      border-bottom: 1px solid #e2e8f0;
    }
    .readme-header i {
      font-size: 18px;
      color: #2563eb;
    }
    .readme-header span {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }
    .readme-badge {
      margin-left: auto;
      font-size: 11px;
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      padding: 3px 10px;
      font-weight: 500;
    }
  </style>
</head>

<body>
  <div class="readme-wrap">
    <div class="readme-header">
      <i class="fas fa-book-open"></i>
      <span>README</span>
      <span class="readme-badge"><i class="fas fa-code-branch"></i> v2.2.12</span>
    </div>
    <?= $html ?>
  </div>

  <script src="../../resource/js/btn.js"></script>
</body>

</html>