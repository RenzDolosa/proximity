<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Font Awesome 6.0.0 Icons Reference - Fixed</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #333;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 30px;
      margin-bottom: 30px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(45deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header p {
      font-size: 1.1rem;
      color: #666;
      margin-bottom: 20px;
    }

    .search-box {
      max-width: 400px;
      margin: 0 auto;
      position: relative;
    }

    .search-box input {
      width: 100%;
      padding: 15px 50px 15px 20px;
      border: none;
      border-radius: 25px;
      font-size: 1rem;
      background: #f8f9fa;
      box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.1);
      outline: none;
      transition: all 0.3s ease;
    }

    .search-box input:focus {
      box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.1), 0 0 0 3px rgba(102, 126, 234, 0.3);
    }

    .search-box i {
      position: absolute;
      right: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: #666;
    }

    .category-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      margin-bottom: 30px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .category-header {
      background: linear-gradient(45deg, #667eea, #764ba2);
      color: white;
      padding: 20px 30px;
      font-size: 1.5rem;
      font-weight: 600;
    }

    .icons-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      padding: 30px;
    }

    .icon-item {
      display: flex;
      align-items: center;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 10px;
      transition: all 0.3s ease;
      cursor: pointer;
      border: 2px solid transparent;
    }

    .icon-item:hover {
      background: #e9ecef;
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
      border-color: #667eea;
    }

    .icon-item i {
      font-size: 1.4rem;
      margin-right: 10px;
      color: #667eea;
      width: 20px;
      text-align: center;
    }

    .icon-item span {
      font-size: 0.85rem;
      color: #333;
      font-family: 'Courier New', monospace;
      word-break: break-all;
    }

    .style-tabs {
      display: flex;
      margin-bottom: 20px;
      background: #f8f9fa;
      border-radius: 10px;
      padding: 5px;
    }

    .style-tab {
      flex: 1;
      padding: 10px 15px;
      text-align: center;
      background: transparent;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s ease;
      font-weight: 500;
    }

    .style-tab.active {
      background: #667eea;
      color: white;
    }

    .hidden {
      display: none;
    }

    .stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .stat-item {
      background: rgba(255, 255, 255, 0.9);
      padding: 15px 25px;
      border-radius: 15px;
      text-align: center;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }

    .stat-number {
      font-size: 1.8rem;
      font-weight: bold;
      color: #667eea;
    }

    .stat-label {
      font-size: 0.9rem;
      color: #666;
    }

    .toast {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #28a745;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
      z-index: 1000;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .toast.show {
      opacity: 1;
      transform: translateX(0);
    }

    @media (max-width: 768px) {
      .icons-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
        padding: 20px;
      }

      .header h1 {
        font-size: 2rem;
      }

      .container {
        padding: 10px;
      }

      .icon-item span {
        font-size: 0.75rem;
      }

      .stats {
        gap: 15px;
      }

      .stat-item {
        padding: 10px 15px;
      }
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="header">
      <h1><i class="fas fa-icons"></i> Font Awesome 6.0.0 Icons</h1>
      <p>Comprehensive reference guide with 500+ popular icons across multiple styles</p>
      <div class="stats">
        <div class="stat-item">
          <div class="stat-number" id="solidCount">0</div>
          <div class="stat-label">Solid Icons</div>
        </div>
        <div class="stat-item">
          <div class="stat-number" id="regularCount">0</div>
          <div class="stat-label">Regular Icons</div>
        </div>
        <div class="stat-item">
          <div class="stat-number" id="brandsCount">0</div>
          <div class="stat-label">Brand Icons</div>
        </div>
      </div>
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search icons by name or category...">
        <i class="fas fa-search"></i>
      </div>
    </div>

    <div class="style-tabs">
      <button class="style-tab active" onclick="showStyle('solid')">Solid (fas)</button>
      <button class="style-tab" onclick="showStyle('regular')">Regular (far)</button>
      <button class="style-tab" onclick="showStyle('brands')">Brands (fab)</button>
    </div>

    <!-- Solid Icons -->
    <div id="solid-icons">
      <!-- Interface Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-desktop"></i> Interface & Navigation
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-home')">
            <i class="fas fa-home"></i>
            <span>fas fa-home</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user')">
            <i class="fas fa-user"></i>
            <span>fas fa-user</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-users')">
            <i class="fas fa-users"></i>
            <span>fas fa-users</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cog')">
            <i class="fas fa-cog"></i>
            <span>fas fa-cog</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cogs')">
            <i class="fas fa-cogs"></i>
            <span>fas fa-cogs</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-search')">
            <i class="fas fa-search"></i>
            <span>fas fa-search</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-search-plus')">
            <i class="fas fa-search-plus"></i>
            <span>fas fa-search-plus</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-search-minus')">
            <i class="fas fa-search-minus"></i>
            <span>fas fa-search-minus</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bell')">
            <i class="fas fa-bell"></i>
            <span>fas fa-bell</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bell-slash')">
            <i class="fas fa-bell-slash"></i>
            <span>fas fa-bell-slash</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bars')">
            <i class="fas fa-bars"></i>
            <span>fas fa-bars</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-times')">
            <i class="fas fa-times"></i>
            <span>fas fa-times</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-plus')">
            <i class="fas fa-plus"></i>
            <span>fas fa-plus</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-minus')">
            <i class="fas fa-minus"></i>
            <span>fas fa-minus</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-edit')">
            <i class="fas fa-edit"></i>
            <span>fas fa-edit</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-trash')">
            <i class="fas fa-trash"></i>
            <span>fas fa-trash</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-trash-alt')">
            <i class="fas fa-trash-alt"></i>
            <span>fas fa-trash-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-save')">
            <i class="fas fa-save"></i>
            <span>fas fa-save</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-download')">
            <i class="fas fa-download"></i>
            <span>fas fa-download</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-upload')">
            <i class="fas fa-upload"></i>
            <span>fas fa-upload</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-share')">
            <i class="fas fa-share"></i>
            <span>fas fa-share</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-share-alt')">
            <i class="fas fa-share-alt"></i>
            <span>fas fa-share-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-copy')">
            <i class="fas fa-copy"></i>
            <span>fas fa-copy</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-paste')">
            <i class="fas fa-paste"></i>
            <span>fas fa-paste</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cut')">
            <i class="fas fa-cut"></i>
            <span>fas fa-cut</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-filter')">
            <i class="fas fa-filter"></i>
            <span>fas fa-filter</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-sort')">
            <i class="fas fa-sort"></i>
            <span>fas fa-sort</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-sort-up')">
            <i class="fas fa-sort-up"></i>
            <span>fas fa-sort-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-sort-down')">
            <i class="fas fa-sort-down"></i>
            <span>fas fa-sort-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-list')">
            <i class="fas fa-list"></i>
            <span>fas fa-list</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-list-ul')">
            <i class="fas fa-list-ul"></i>
            <span>fas fa-list-ul</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-list-ol')">
            <i class="fas fa-list-ol"></i>
            <span>fas fa-list-ol</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-th')">
            <i class="fas fa-th"></i>
            <span>fas fa-th</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-th-list')">
            <i class="fas fa-th-list"></i>
            <span>fas fa-th-list</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-th-large')">
            <i class="fas fa-th-large"></i>
            <span>fas fa-th-large</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-info')">
            <i class="fas fa-info"></i>
            <span>fas fa-info</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-info-circle')">
            <i class="fas fa-info-circle"></i>
            <span>fas fa-info-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-question')">
            <i class="fas fa-question"></i>
            <span>fas fa-question</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-question-circle')">
            <i class="fas fa-question-circle"></i>
            <span>fas fa-question-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-exclamation')">
            <i class="fas fa-exclamation"></i>
            <span>fas fa-exclamation</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-exclamation-circle')">
            <i class="fas fa-exclamation-circle"></i>
            <span>fas fa-exclamation-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-check')">
            <i class="fas fa-check"></i>
            <span>fas fa-check</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-check-circle')">
            <i class="fas fa-check-circle"></i>
            <span>fas fa-check-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-check-square')">
            <i class="fas fa-check-square"></i>
            <span>fas fa-check-square</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-check-double')">
            <i class="fas fa-check-double"></i>
            <span>fas fa-check-double</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-times-circle')">
            <i class="fas fa-times-circle"></i>
            <span>fas fa-times-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-star')">
            <i class="fas fa-star"></i>
            <span>fas fa-star</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-star-half-alt')">
            <i class="fas fa-star-half-alt"></i>
            <span>fas fa-star-half-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bookmark')">
            <i class="fas fa-bookmark"></i>
            <span>fas fa-bookmark</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-flag')">
            <i class="fas fa-flag"></i>
            <span>fas fa-flag</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tag')">
            <i class="fas fa-tag"></i>
            <span>fas fa-tag</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tags')">
            <i class="fas fa-tags"></i>
            <span>fas fa-tags</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-thumbs-up')">
            <i class="fas fa-thumbs-up"></i>
            <span>fas fa-thumbs-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-thumbs-down')">
            <i class="fas fa-thumbs-down"></i>
            <span>fas fa-thumbs-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-folder')">
            <i class="fas fa-folder"></i>
            <span>fas fa-folder</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-folder-open')">
            <i class="fas fa-folder-open"></i>
            <span>fas fa-folder-open</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file')">
            <i class="fas fa-file"></i>
            <span>fas fa-file</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-alt')">
            <i class="fas fa-file-alt"></i>
            <span>fas fa-file-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-pdf')">
            <i class="fas fa-file-pdf"></i>
            <span>fas fa-file-pdf</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-word')">
            <i class="fas fa-file-word"></i>
            <span>fas fa-file-word</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-excel')">
            <i class="fas fa-file-excel"></i>
            <span>fas fa-file-excel</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-powerpoint')">
            <i class="fas fa-file-powerpoint"></i>
            <span>fas fa-file-powerpoint</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-image')">
            <i class="fas fa-file-image"></i>
            <span>fas fa-file-image</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-video')">
            <i class="fas fa-file-video"></i>
            <span>fas fa-file-video</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-audio')">
            <i class="fas fa-file-audio"></i>
            <span>fas fa-file-audio</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-archive')">
            <i class="fas fa-file-archive"></i>
            <span>fas fa-file-archive</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-file-code')">
            <i class="fas fa-file-code"></i>
            <span>fas fa-file-code</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-link')">
            <i class="fas fa-link"></i>
            <span>fas fa-link</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-unlink')">
            <i class="fas fa-unlink"></i>
            <span>fas fa-unlink</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-paperclip')">
            <i class="fas fa-paperclip"></i>
            <span>fas fa-paperclip</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-grip-horizontal')">
            <i class="fas fa-grip-horizontal"></i>
            <span>fas fa-grip-horizontal</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-grip-vertical')">
            <i class="fas fa-grip-vertical"></i>
            <span>fas fa-grip-vertical</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-ellipsis-h')">
            <i class="fas fa-ellipsis-h"></i>
            <span>fas fa-ellipsis-h</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-ellipsis-v')">
            <i class="fas fa-ellipsis-v"></i>
            <span>fas fa-ellipsis-v</span>
          </div>
        </div>
      </div>

      <!-- Communication Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-comments"></i> Communication
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-phone')">
            <i class="fas fa-phone"></i>
            <span>fas fa-phone</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-phone-alt')">
            <i class="fas fa-phone-alt"></i>
            <span>fas fa-phone-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-mobile')">
            <i class="fas fa-mobile"></i>
            <span>fas fa-mobile</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-mobile-alt')">
            <i class="fas fa-mobile-alt"></i>
            <span>fas fa-mobile-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-envelope')">
            <i class="fas fa-envelope"></i>
            <span>fas fa-envelope</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-envelope-open')">
            <i class="fas fa-envelope-open"></i>
            <span>fas fa-envelope-open</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-comments')">
            <i class="fas fa-comments"></i>
            <span>fas fa-comments</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-comment')">
            <i class="fas fa-comment"></i>
            <span>fas fa-comment</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-comment-alt')">
            <i class="fas fa-comment-alt"></i>
            <span>fas fa-comment-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-comment-dots')">
            <i class="fas fa-comment-dots"></i>
            <span>fas fa-comment-dots</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-video')">
            <i class="fas fa-video"></i>
            <span>fas fa-video</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-video-slash')">
            <i class="fas fa-video-slash"></i>
            <span>fas fa-video-slash</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-microphone')">
            <i class="fas fa-microphone"></i>
            <span>fas fa-microphone</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-microphone-slash')">
            <i class="fas fa-microphone-slash"></i>
            <span>fas fa-microphone-slash</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-inbox')">
            <i class="fas fa-inbox"></i>
            <span>fas fa-inbox</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-paper-plane')">
            <i class="fas fa-paper-plane"></i>
            <span>fas fa-paper-plane</span>
          </div>
        </div>
      </div>

      <!-- Media Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-play"></i> Media & Entertainment
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-play')">
            <i class="fas fa-play"></i>
            <span>fas fa-play</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-pause')">
            <i class="fas fa-pause"></i>
            <span>fas fa-pause</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-stop')">
            <i class="fas fa-stop"></i>
            <span>fas fa-stop</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-step-backward')">
            <i class="fas fa-step-backward"></i>
            <span>fas fa-step-backward</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-step-forward')">
            <i class="fas fa-step-forward"></i>
            <span>fas fa-step-forward</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-backward')">
            <i class="fas fa-backward"></i>
            <span>fas fa-backward</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-forward')">
            <i class="fas fa-forward"></i>
            <span>fas fa-forward</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-fast-backward')">
            <i class="fas fa-fast-backward"></i>
            <span>fas fa-fast-backward</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-fast-forward')">
            <i class="fas fa-fast-forward"></i>
            <span>fas fa-fast-forward</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-music')">
            <i class="fas fa-music"></i>
            <span>fas fa-music</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-headphones')">
            <i class="fas fa-headphones"></i>
            <span>fas fa-headphones</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-image')">
            <i class="fas fa-image"></i>
            <span>fas fa-image</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-camera')">
            <i class="fas fa-camera"></i>
            <span>fas fa-camera</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-camera-retro')">
            <i class="fas fa-camera-retro"></i>
            <span>fas fa-camera-retro</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-film')">
            <i class="fas fa-film"></i>
            <span>fas fa-film</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-volume-up')">
            <i class="fas fa-volume-up"></i>
            <span>fas fa-volume-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-volume-down')">
            <i class="fas fa-volume-down"></i>
            <span>fas fa-volume-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-volume-off')">
            <i class="fas fa-volume-off"></i>
            <span>fas fa-volume-off</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-volume-mute')">
            <i class="fas fa-volume-mute"></i>
            <span>fas fa-volume-mute</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tv')">
            <i class="fas fa-tv"></i>
            <span>fas fa-tv</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-radio')">
            <i class="fas fa-radio"></i>
            <span>fas fa-radio</span>
          </div>
        </div>
      </div>

      <!-- Navigation Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-arrows-alt"></i> Arrows & Directions
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-arrow-up')">
            <i class="fas fa-arrow-up"></i>
            <span>fas fa-arrow-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-arrow-down')">
            <i class="fas fa-arrow-down"></i>
            <span>fas fa-arrow-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-arrow-left')">
            <i class="fas fa-arrow-left"></i>
            <span>fas fa-arrow-left</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-arrow-right')">
            <i class="fas fa-arrow-right"></i>
            <span>fas fa-arrow-right</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chevron-up')">
            <i class="fas fa-chevron-up"></i>
            <span>fas fa-chevron-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chevron-down')">
            <i class="fas fa-chevron-down"></i>
            <span>fas fa-chevron-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chevron-left')">
            <i class="fas fa-chevron-left"></i>
            <span>fas fa-chevron-left</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chevron-right')">
            <i class="fas fa-chevron-right"></i>
            <span>fas fa-chevron-right</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-angle-up')">
            <i class="fas fa-angle-up"></i>
            <span>fas fa-angle-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-angle-down')">
            <i class="fas fa-angle-down"></i>
            <span>fas fa-angle-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-angle-left')">
            <i class="fas fa-angle-left"></i>
            <span>fas fa-angle-left</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-angle-right')">
            <i class="fas fa-angle-right"></i>
            <span>fas fa-angle-right</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-arrows-alt')">
            <i class="fas fa-arrows-alt"></i>
            <span>fas fa-arrows-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-expand')">
            <i class="fas fa-expand"></i>
            <span>fas fa-expand</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-compress')">
            <i class="fas fa-compress"></i>
            <span>fas fa-compress</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-sync')">
            <i class="fas fa-sync"></i>
            <span>fas fa-sync</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-sync-alt')">
            <i class="fas fa-sync-alt"></i>
            <span>fas fa-sync-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-redo')">
            <i class="fas fa-redo"></i>
            <span>fas fa-redo</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-undo')">
            <i class="fas fa-undo"></i>
            <span>fas fa-undo</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-external-link-alt')">
            <i class="fas fa-external-link-alt"></i>
            <span>fas fa-external-link-alt</span>
          </div>
        </div>
      </div>

      <!-- Business Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-briefcase"></i> Business & Finance
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-briefcase')">
            <i class="fas fa-briefcase"></i>
            <span>fas fa-briefcase</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chart-bar')">
            <i class="fas fa-chart-bar"></i>
            <span>fas fa-chart-bar</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chart-line')">
            <i class="fas fa-chart-line"></i>
            <span>fas fa-chart-line</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chart-pie')">
            <i class="fas fa-chart-pie"></i>
            <span>fas fa-chart-pie</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-chart-area')">
            <i class="fas fa-chart-area"></i>
            <span>fas fa-chart-area</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-dollar-sign')">
            <i class="fas fa-dollar-sign"></i>
            <span>fas fa-dollar-sign</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-euro-sign')">
            <i class="fas fa-euro-sign"></i>
            <span>fas fa-euro-sign</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-pound-sign')">
            <i class="fas fa-pound-sign"></i>
            <span>fas fa-pound-sign</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-yen-sign')">
            <i class="fas fa-yen-sign"></i>
            <span>fas fa-yen-sign</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-coins')">
            <i class="fas fa-coins"></i>
            <span>fas fa-coins</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-credit-card')">
            <i class="fas fa-credit-card"></i>
            <span>fas fa-credit-card</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-wallet')">
            <i class="fas fa-wallet"></i>
            <span>fas fa-wallet</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-receipt')">
            <i class="fas fa-receipt"></i>
            <span>fas fa-receipt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-calculator')">
            <i class="fas fa-calculator"></i>
            <span>fas fa-calculator</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-building')">
            <i class="fas fa-building"></i>
            <span>fas fa-building</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-handshake')">
            <i class="fas fa-handshake"></i>
            <span>fas fa-handshake</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-balance-scale')">
            <i class="fas fa-balance-scale"></i>
            <span>fas fa-balance-scale</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-balance-scale-left')">
            <i class="fas fa-balance-scale-left"></i>
            <span>fas fa-balance-scale-left</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-balance-scale-right')">
            <i class="fas fa-balance-scale-right"></i>
            <span>fas fa-balance-scale-right</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-gavel')">
            <i class="fas fa-gavel"></i>
            <span>fas fa-gavel</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-piggy-bank')">
            <i class="fas fa-piggy-bank"></i>
            <span>fas fa-piggy-bank</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-money-bill')">
            <i class="fas fa-money-bill"></i>
            <span>fas fa-money-bill</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-money-bill-alt')">
            <i class="fas fa-money-bill-alt"></i>
            <span>fas fa-money-bill-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-money-check')">
            <i class="fas fa-money-check"></i>
            <span>fas fa-money-check</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-money-check-alt')">
            <i class="fas fa-money-check-alt"></i>
            <span>fas fa-money-check-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cash-register')">
            <i class="fas fa-cash-register"></i>
            <span>fas fa-cash-register</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-donate')">
            <i class="fas fa-donate"></i>
            <span>fas fa-donate</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-hand-holding-usd')">
            <i class="fas fa-hand-holding-usd"></i>
            <span>fas fa-hand-holding-usd</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-funnel-dollar')">
            <i class="fas fa-funnel-dollar"></i>
            <span>fas fa-funnel-dollar</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-search-dollar')">
            <i class="fas fa-search-dollar"></i>
            <span>fas fa-search-dollar</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-percentage')">
            <i class="fas fa-percentage"></i>
            <span>fas fa-percentage</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-shopping-bag')">
            <i class="fas fa-shopping-bag"></i>
            <span>fas fa-shopping-bag</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-shopping-basket')">
            <i class="fas fa-shopping-basket"></i>
            <span>fas fa-shopping-basket</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-shopping-cart')">
            <i class="fas fa-shopping-cart"></i>
            <span>fas fa-shopping-cart</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-store')">
            <i class="fas fa-store"></i>
            <span>fas fa-store</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-store-alt')">
            <i class="fas fa-store-alt"></i>
            <span>fas fa-store-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tags')">
            <i class="fas fa-tags"></i>
            <span>fas fa-tags</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-barcode')">
            <i class="fas fa-barcode"></i>
            <span>fas fa-barcode</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-truck')">
            <i class="fas fa-truck"></i>
            <span>fas fa-truck</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-shipping-fast')">
            <i class="fas fa-shipping-fast"></i>
            <span>fas fa-shipping-fast</span>
          </div>
        </div>
      </div>

      <!-- Technology Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-laptop"></i> Technology & Computing
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-laptop')">
            <i class="fas fa-laptop"></i>
            <span>fas fa-laptop</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-desktop')">
            <i class="fas fa-desktop"></i>
            <span>fas fa-desktop</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tablet')">
            <i class="fas fa-tablet"></i>
            <span>fas fa-tablet</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tablet-alt')">
            <i class="fas fa-tablet-alt"></i>
            <span>fas fa-tablet-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-server')">
            <i class="fas fa-server"></i>
            <span>fas fa-server</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-database')">
            <i class="fas fa-database"></i>
            <span>fas fa-database</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-code')">
            <i class="fas fa-code"></i>
            <span>fas fa-code</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-terminal')">
            <i class="fas fa-terminal"></i>
            <span>fas fa-terminal</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bug')">
            <i class="fas fa-bug"></i>
            <span>fas fa-bug</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-wifi')">
            <i class="fas fa-wifi"></i>
            <span>fas fa-wifi</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bluetooth')">
            <i class="fas fa-bluetooth"></i>
            <span>fas fa-bluetooth</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-usb')">
            <i class="fas fa-usb"></i>
            <span>fas fa-usb</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-memory')">
            <i class="fas fa-memory"></i>
            <span>fas fa-memory</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-microchip')">
            <i class="fas fa-microchip"></i>
            <span>fas fa-microchip</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-hdd')">
            <i class="fas fa-hdd"></i>
            <span>fas fa-hdd</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-keyboard')">
            <i class="fas fa-keyboard"></i>
            <span>fas fa-keyboard</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-mouse')">
            <i class="fas fa-mouse"></i>
            <span>fas fa-mouse</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-print')">
            <i class="fas fa-print"></i>
            <span>fas fa-print</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-fax')">
            <i class="fas fa-fax"></i>
            <span>fas fa-fax</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tv')">
            <i class="fas fa-tv"></i>
            <span>fas fa-tv</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-gamepad')">
            <i class="fas fa-gamepad"></i>
            <span>fas fa-gamepad</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-robot')">
            <i class="fas fa-robot"></i>
            <span>fas fa-robot</span>
          </div>
        </div>
      </div>

      <!-- Location & Maps -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-map-marker-alt"></i> Location & Maps
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-map')">
            <i class="fas fa-map"></i>
            <span>fas fa-map</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-map-marked')">
            <i class="fas fa-map-marked"></i>
            <span>fas fa-map-marked</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-map-marked-alt')">
            <i class="fas fa-map-marked-alt"></i>
            <span>fas fa-map-marked-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-map-marker')">
            <i class="fas fa-map-marker"></i>
            <span>fas fa-map-marker</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-map-marker-alt')">
            <i class="fas fa-map-marker-alt"></i>
            <span>fas fa-map-marker-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-map-pin')">
            <i class="fas fa-map-pin"></i>
            <span>fas fa-map-pin</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-map-signs')">
            <i class="fas fa-map-signs"></i>
            <span>fas fa-map-signs</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-compass')">
            <i class="fas fa-compass"></i>
            <span>fas fa-compass</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-location-arrow')">
            <i class="fas fa-location-arrow"></i>
            <span>fas fa-location-arrow</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-crosshairs')">
            <i class="fas fa-crosshairs"></i>
            <span>fas fa-crosshairs</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-globe')">
            <i class="fas fa-globe"></i>
            <span>fas fa-globe</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-globe-africa')">
            <i class="fas fa-globe-africa"></i>
            <span>fas fa-globe-africa</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-globe-americas')">
            <i class="fas fa-globe-americas"></i>
            <span>fas fa-globe-americas</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-globe-asia')">
            <i class="fas fa-globe-asia"></i>
            <span>fas fa-globe-asia</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-globe-europe')">
            <i class="fas fa-globe-europe"></i>
            <span>fas fa-globe-europe</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-route')">
            <i class="fas fa-route"></i>
            <span>fas fa-route</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-road')">
            <i class="fas fa-road"></i>
            <span>fas fa-road</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-directions')">
            <i class="fas fa-directions"></i>
            <span>fas fa-directions</span>
          </div>
        </div>
      </div>

      <!-- Transportation Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-car"></i> Transportation
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-car')">
            <i class="fas fa-car"></i>
            <span>fas fa-car</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-car-alt')">
            <i class="fas fa-car-alt"></i>
            <span>fas fa-car-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-taxi')">
            <i class="fas fa-taxi"></i>
            <span>fas fa-taxi</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bus')">
            <i class="fas fa-bus"></i>
            <span>fas fa-bus</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bus-alt')">
            <i class="fas fa-bus-alt"></i>
            <span>fas fa-bus-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-train')">
            <i class="fas fa-train"></i>
            <span>fas fa-train</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-subway')">
            <i class="fas fa-subway"></i>
            <span>fas fa-subway</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-plane')">
            <i class="fas fa-plane"></i>
            <span>fas fa-plane</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-plane-departure')">
            <i class="fas fa-plane-departure"></i>
            <span>fas fa-plane-departure</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-plane-arrival')">
            <i class="fas fa-plane-arrival"></i>
            <span>fas fa-plane-arrival</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-helicopter')">
            <i class="fas fa-helicopter"></i>
            <span>fas fa-helicopter</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-ship')">
            <i class="fas fa-ship"></i>
            <span>fas fa-ship</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-anchor')">
            <i class="fas fa-anchor"></i>
            <span>fas fa-anchor</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bicycle')">
            <i class="fas fa-bicycle"></i>
            <span>fas fa-bicycle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-motorcycle')">
            <i class="fas fa-motorcycle"></i>
            <span>fas fa-motorcycle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-walking')">
            <i class="fas fa-walking"></i>
            <span>fas fa-walking</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-running')">
            <i class="fas fa-running"></i>
            <span>fas fa-running</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-gas-pump')">
            <i class="fas fa-gas-pump"></i>
            <span>fas fa-gas-pump</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-parking')">
            <i class="fas fa-parking"></i>
            <span>fas fa-parking</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-traffic-light')">
            <i class="fas fa-traffic-light"></i>
            <span>fas fa-traffic-light</span>
          </div>
        </div>
      </div>

      <!-- Security Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-shield-alt"></i> Security & Safety
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-lock')">
            <i class="fas fa-lock"></i>
            <span>fas fa-lock</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-unlock')">
            <i class="fas fa-unlock"></i>
            <span>fas fa-unlock</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-unlock-alt')">
            <i class="fas fa-unlock-alt"></i>
            <span>fas fa-unlock-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-key')">
            <i class="fas fa-key"></i>
            <span>fas fa-key</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-shield-alt')">
            <i class="fas fa-shield-alt"></i>
            <span>fas fa-shield-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-shield')">
            <i class="fas fa-user-shield"></i>
            <span>fas fa-user-shield</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-eye')">
            <i class="fas fa-eye"></i>
            <span>fas fa-eye</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-eye-slash')">
            <i class="fas fa-eye-slash"></i>
            <span>fas fa-eye-slash</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-fingerprint')">
            <i class="fas fa-fingerprint"></i>
            <span>fas fa-fingerprint</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-secret')">
            <i class="fas fa-user-secret"></i>
            <span>fas fa-user-secret</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-exclamation-triangle')">
            <i class="fas fa-exclamation-triangle"></i>
            <span>fas fa-exclamation-triangle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-ban')">
            <i class="fas fa-ban"></i>
            <span>fas fa-ban</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-lock')">
            <i class="fas fa-user-lock"></i>
            <span>fas fa-user-lock</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-lock-open')">
            <i class="fas fa-lock-open"></i>
            <span>fas fa-lock-open</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-check')">
            <i class="fas fa-user-check"></i>
            <span>fas fa-user-check</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-id-card')">
            <i class="fas fa-id-card"></i>
            <span>fas fa-id-card</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-id-badge')">
            <i class="fas fa-id-badge"></i>
            <span>fas fa-id-badge</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-signature')">
            <i class="fas fa-signature"></i>
            <span>fas fa-signature</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-times')">
            <i class="fas fa-user-times"></i>
            <span>fas fa-user-times</span>
          </div>
        </div>
      </div>

      <!-- Weather & Nature Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-sun"></i> Weather & Nature
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-sun')">
            <i class="fas fa-sun"></i>
            <span>fas fa-sun</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-moon')">
            <i class="fas fa-moon"></i>
            <span>fas fa-moon</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cloud')">
            <i class="fas fa-cloud"></i>
            <span>fas fa-cloud</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cloud-sun')">
            <i class="fas fa-cloud-sun"></i>
            <span>fas fa-cloud-sun</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cloud-moon')">
            <i class="fas fa-cloud-moon"></i>
            <span>fas fa-cloud-moon</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cloud-rain')">
            <i class="fas fa-cloud-rain"></i>
            <span>fas fa-cloud-rain</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cloud-showers-heavy')">
            <i class="fas fa-cloud-showers-heavy"></i>
            <span>fas fa-cloud-showers-heavy</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-snowflake')">
            <i class="fas fa-snowflake"></i>
            <span>fas fa-snowflake</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bolt')">
            <i class="fas fa-bolt"></i>
            <span>fas fa-bolt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-rainbow')">
            <i class="fas fa-rainbow"></i>
            <span>fas fa-rainbow</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-temperature-high')">
            <i class="fas fa-temperature-high"></i>
            <span>fas fa-temperature-high</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-temperature-low')">
            <i class="fas fa-temperature-low"></i>
            <span>fas fa-temperature-low</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-thermometer-half')">
            <i class="fas fa-thermometer-half"></i>
            <span>fas fa-thermometer-half</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-wind')">
            <i class="fas fa-wind"></i>
            <span>fas fa-wind</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tree')">
            <i class="fas fa-tree"></i>
            <span>fas fa-tree</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-leaf')">
            <i class="fas fa-leaf"></i>
            <span>fas fa-leaf</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-seedling')">
            <i class="fas fa-seedling"></i>
            <span>fas fa-seedling</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-mountain')">
            <i class="fas fa-mountain"></i>
            <span>fas fa-mountain</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-water')">
            <i class="fas fa-water"></i>
            <span>fas fa-water</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-fire')">
            <i class="fas fa-fire"></i>
            <span>fas fa-fire</span>
          </div>
        </div>
      </div>

      <!-- Health & Medical Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-heart"></i> Health & Medical
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-heart')">
            <i class="fas fa-heart"></i>
            <span>fas fa-heart</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-heartbeat')">
            <i class="fas fa-heartbeat"></i>
            <span>fas fa-heartbeat</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-stethoscope')">
            <i class="fas fa-stethoscope"></i>
            <span>fas fa-stethoscope</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-plus')">
            <i class="fas fa-plus"></i>
            <span>fas fa-plus</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-ambulance')">
            <i class="fas fa-ambulance"></i>
            <span>fas fa-ambulance</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-hospital')">
            <i class="fas fa-hospital"></i>
            <span>fas fa-hospital</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-md')">
            <i class="fas fa-user-md"></i>
            <span>fas fa-user-md</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-user-nurse')">
            <i class="fas fa-user-nurse"></i>
            <span>fas fa-user-nurse</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-pills')">
            <i class="fas fa-pills"></i>
            <span>fas fa-pills</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-syringe')">
            <i class="fas fa-syringe"></i>
            <span>fas fa-syringe</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-thermometer')">
            <i class="fas fa-thermometer"></i>
            <span>fas fa-thermometer</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-dna')">
            <i class="fas fa-dna"></i>
            <span>fas fa-dna</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-tooth')">
            <i class="fas fa-tooth"></i>
            <span>fas fa-tooth</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-eye-dropper')">
            <i class="fas fa-eye-dropper"></i>
            <span>fas fa-eye-dropper</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-band-aid')">
            <i class="fas fa-band-aid"></i>
            <span>fas fa-band-aid</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-first-aid')">
            <i class="fas fa-first-aid"></i>
            <span>fas fa-first-aid</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-wheelchair')">
            <i class="fas fa-wheelchair"></i>
            <span>fas fa-wheelchair</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-smoking-ban')">
            <i class="fas fa-smoking-ban"></i>
            <span>fas fa-smoking-ban</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-virus')">
            <i class="fas fa-virus"></i>
            <span>fas fa-virus</span>
          </div>
        </div>
      </div>

      <!-- Food & Dining Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="fas fa-utensils"></i> Food & Dining
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fas fa-utensils')">
            <i class="fas fa-utensils"></i>
            <span>fas fa-utensils</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-coffee')">
            <i class="fas fa-coffee"></i>
            <span>fas fa-coffee</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-wine-glass')">
            <i class="fas fa-wine-glass"></i>
            <span>fas fa-wine-glass</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-beer')">
            <i class="fas fa-beer"></i>
            <span>fas fa-beer</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cocktail')">
            <i class="fas fa-cocktail"></i>
            <span>fas fa-cocktail</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-pizza-slice')">
            <i class="fas fa-pizza-slice"></i>
            <span>fas fa-pizza-slice</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-hamburger')">
            <i class="fas fa-hamburger"></i>
            <span>fas fa-hamburger</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-hotdog')">
            <i class="fas fa-hotdog"></i>
            <span>fas fa-hotdog</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-ice-cream')">
            <i class="fas fa-ice-cream"></i>
            <span>fas fa-ice-cream</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cookie-bite')">
            <i class="fas fa-cookie-bite"></i>
            <span>fas fa-cookie-bite</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-birthday-cake')">
            <i class="fas fa-birthday-cake"></i>
            <span>fas fa-birthday-cake</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-apple-alt')">
            <i class="fas fa-apple-alt"></i>
            <span>fas fa-apple-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-carrot')">
            <i class="fas fa-carrot"></i>
            <span>fas fa-carrot</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-lemon')">
            <i class="fas fa-lemon"></i>
            <span>fas fa-lemon</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-pepper-hot')">
            <i class="fas fa-pepper-hot"></i>
            <span>fas fa-pepper-hot</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-cheese')">
            <i class="fas fa-cheese"></i>
            <span>fas fa-cheese</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-fish')">
            <i class="fas fa-fish"></i>
            <span>fas fa-fish</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-drumstick-bite')">
            <i class="fas fa-drumstick-bite"></i>
            <span>fas fa-drumstick-bite</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-egg')">
            <i class="fas fa-egg"></i>
            <span>fas fa-egg</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bread-slice')">
            <i class="fas fa-bread-slice"></i>
            <span>fas fa-bread-slice</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-candy-cane')">
            <i class="fas fa-candy-cane"></i>
            <span>fas fa-candy-cane</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-wine-bottle')">
            <i class="fas fa-wine-bottle"></i>
            <span>fas fa-wine-bottle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-glass-whiskey')">
            <i class="fas fa-glass-whiskey"></i>
            <span>fas fa-glass-whiskey</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-glass-martini')">
            <i class="fas fa-glass-martini"></i>
            <span>fas fa-glass-martini</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-mug-hot')">
            <i class="fas fa-mug-hot"></i>
            <span>fas fa-mug-hot</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-blender')">
            <i class="fas fa-blender"></i>
            <span>fas fa-blender</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-mortar-pestle')">
            <i class="fas fa-mortar-pestle"></i>
            <span>fas fa-mortar-pestle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-bone')">
            <i class="fas fa-bone"></i>
            <span>fas fa-bone</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fas fa-seedling')">
            <i class="fas fa-seedling"></i>
            <span>fas fa-seedling</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Regular Icons -->
    <div id="regular-icons" class="hidden">
      <!-- Interface Icons -->
      <div class="category-section">
        <div class="category-header">
          <i class="far fa-user"></i> Interface & Navigation
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('far fa-user')">
            <i class="far fa-user"></i>
            <span>far fa-user</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-bell')">
            <i class="far fa-bell"></i>
            <span>far fa-bell</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-envelope')">
            <i class="far fa-envelope"></i>
            <span>far fa-envelope</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-envelope-open')">
            <i class="far fa-envelope-open"></i>
            <span>far fa-envelope-open</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-comment')">
            <i class="far fa-comment"></i>
            <span>far fa-comment</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-comments')">
            <i class="far fa-comments"></i>
            <span>far fa-comments</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-edit')">
            <i class="far fa-edit"></i>
            <span>far fa-edit</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-trash-alt')">
            <i class="far fa-trash-alt"></i>
            <span>far fa-trash-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-save')">
            <i class="far fa-save"></i>
            <span>far fa-save</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-copy')">
            <i class="far fa-copy"></i>
            <span>far fa-copy</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-heart')">
            <i class="far fa-heart"></i>
            <span>far fa-heart</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-star')">
            <i class="far fa-star"></i>
            <span>far fa-star</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-bookmark')">
            <i class="far fa-bookmark"></i>
            <span>far fa-bookmark</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-thumbs-up')">
            <i class="far fa-thumbs-up"></i>
            <span>far fa-thumbs-up</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-thumbs-down')">
            <i class="far fa-thumbs-down"></i>
            <span>far fa-thumbs-down</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-flag')">
            <i class="far fa-flag"></i>
            <span>far fa-flag</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-calendar')">
            <i class="far fa-calendar"></i>
            <span>far fa-calendar</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-calendar-alt')">
            <i class="far fa-calendar-alt"></i>
            <span>far fa-calendar-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-clock')">
            <i class="far fa-clock"></i>
            <span>far fa-clock</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-folder')">
            <i class="far fa-folder"></i>
            <span>far fa-folder</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-folder-open')">
            <i class="far fa-folder-open"></i>
            <span>far fa-folder-open</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-file')">
            <i class="far fa-file"></i>
            <span>far fa-file</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-file-alt')">
            <i class="far fa-file-alt"></i>
            <span>far fa-file-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-image')">
            <i class="far fa-image"></i>
            <span>far fa-image</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-images')">
            <i class="far fa-images"></i>
            <span>far fa-images</span>
          </div>
        </div>
      </div>

      <!-- Forms & Controls -->
      <div class="category-section">
        <div class="category-header">
          <i class="far fa-check-square"></i> Forms & Controls
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('far fa-square')">
            <i class="far fa-square"></i>
            <span>far fa-square</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-check-square')">
            <i class="far fa-check-square"></i>
            <span>far fa-check-square</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-circle')">
            <i class="far fa-circle"></i>
            <span>far fa-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-dot-circle')">
            <i class="far fa-dot-circle"></i>
            <span>far fa-dot-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-plus-square')">
            <i class="far fa-plus-square"></i>
            <span>far fa-plus-square</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-minus-square')">
            <i class="far fa-minus-square"></i>
            <span>far fa-minus-square</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-times-circle')">
            <i class="far fa-times-circle"></i>
            <span>far fa-times-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-check-circle')">
            <i class="far fa-check-circle"></i>
            <span>far fa-check-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-question-circle')">
            <i class="far fa-question-circle"></i>
            <span>far fa-question-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-exclamation-circle')">
            <i class="far fa-exclamation-circle"></i>
            <span>far fa-exclamation-circle</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('far fa-info-circle')">
            <i class="far fa-info-circle"></i>
            <span>far fa-info-circle</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Brand Icons -->
    <div id="brands-icons" class="hidden">
      <!-- Social Media -->
      <div class="category-section">
        <div class="category-header">
          <i class="fab fa-facebook"></i> Social Media
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fab fa-facebook')">
            <i class="fab fa-facebook"></i>
            <span>fab fa-facebook</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-facebook-f')">
            <i class="fab fa-facebook-f"></i>
            <span>fab fa-facebook-f</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-twitter')">
            <i class="fab fa-twitter"></i>
            <span>fab fa-twitter</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-instagram')">
            <i class="fab fa-instagram"></i>
            <span>fab fa-instagram</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-linkedin')">
            <i class="fab fa-linkedin"></i>
            <span>fab fa-linkedin</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-linkedin-in')">
            <i class="fab fa-linkedin-in"></i>
            <span>fab fa-linkedin-in</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-youtube')">
            <i class="fab fa-youtube"></i>
            <span>fab fa-youtube</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-pinterest')">
            <i class="fab fa-pinterest"></i>
            <span>fab fa-pinterest</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-pinterest-p')">
            <i class="fab fa-pinterest-p"></i>
            <span>fab fa-pinterest-p</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-snapchat')">
            <i class="fab fa-snapchat"></i>
            <span>fab fa-snapchat</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-tiktok')">
            <i class="fab fa-tiktok"></i>
            <span>fab fa-tiktok</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-whatsapp')">
            <i class="fab fa-whatsapp"></i>
            <span>fab fa-whatsapp</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-telegram')">
            <i class="fab fa-telegram"></i>
            <span>fab fa-telegram</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-discord')">
            <i class="fab fa-discord"></i>
            <span>fab fa-discord</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-reddit')">
            <i class="fab fa-reddit"></i>
            <span>fab fa-reddit</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-tumblr')">
            <i class="fab fa-tumblr"></i>
            <span>fab fa-tumblr</span>
          </div>
        </div>
      </div>

      <!-- Technology Companies -->
      <div class="category-section">
        <div class="category-header">
          <i class="fab fa-google"></i> Technology Companies
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fab fa-google')">
            <i class="fab fa-google"></i>
            <span>fab fa-google</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-microsoft')">
            <i class="fab fa-microsoft"></i>
            <span>fab fa-microsoft</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-apple')">
            <i class="fab fa-apple"></i>
            <span>fab fa-apple</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-amazon')">
            <i class="fab fa-amazon"></i>
            <span>fab fa-amazon</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-android')">
            <i class="fab fa-android"></i>
            <span>fab fa-android</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-chrome')">
            <i class="fab fa-chrome"></i>
            <span>fab fa-chrome</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-firefox')">
            <i class="fab fa-firefox"></i>
            <span>fab fa-firefox</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-safari')">
            <i class="fab fa-safari"></i>
            <span>fab fa-safari</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-edge')">
            <i class="fab fa-edge"></i>
            <span>fab fa-edge</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-opera')">
            <i class="fab fa-opera"></i>
            <span>fab fa-opera</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-spotify')">
            <i class="fab fa-spotify"></i>
            <span>fab fa-spotify</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-dropbox')">
            <i class="fab fa-dropbox"></i>
            <span>fab fa-dropbox</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-slack')">
            <i class="fab fa-slack"></i>
            <span>fab fa-slack</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-skype')">
            <i class="fab fa-skype"></i>
            <span>fab fa-skype</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-github')">
            <i class="fab fa-github"></i>
            <span>fab fa-github</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-gitlab')">
            <i class="fab fa-gitlab"></i>
            <span>fab fa-gitlab</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-bitbucket')">
            <i class="fab fa-bitbucket"></i>
            <span>fab fa-bitbucket</span>
          </div>
        </div>
      </div>

      <!-- Programming Languages -->
      <div class="category-section">
        <div class="category-header">
          <i class="fab fa-js"></i> Programming Languages
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fab fa-html5')">
            <i class="fab fa-html5"></i>
            <span>fab fa-html5</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-css3')">
            <i class="fab fa-css3"></i>
            <span>fab fa-css3</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-css3-alt')">
            <i class="fab fa-css3-alt"></i>
            <span>fab fa-css3-alt</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-js')">
            <i class="fab fa-js"></i>
            <span>fab fa-js</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-js-square')">
            <i class="fab fa-js-square"></i>
            <span>fab fa-js-square</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-react')">
            <i class="fab fa-react"></i>
            <span>fab fa-react</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-angular')">
            <i class="fab fa-angular"></i>
            <span>fab fa-angular</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-vue')">
            <i class="fab fa-vuejs"></i>
            <span>fab fa-vuejs</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-node')">
            <i class="fab fa-node"></i>
            <span>fab fa-node</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-node-js')">
            <i class="fab fa-node-js"></i>
            <span>fab fa-node-js</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-npm')">
            <i class="fab fa-npm"></i>
            <span>fab fa-npm</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-yarn')">
            <i class="fab fa-yarn"></i>
            <span>fab fa-yarn</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-bootstrap')">
            <i class="fab fa-bootstrap"></i>
            <span>fab fa-bootstrap</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-sass')">
            <i class="fab fa-sass"></i>
            <span>fab fa-sass</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-sass')">
            <i class="fab fa-sass"></i>
            <span>fab fa-sass</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-less')">
            <i class="fab fa-less"></i>
            <span>fab fa-less</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-python')">
            <i class="fab fa-python"></i>
            <span>fab fa-python</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-java')">
            <i class="fab fa-java"></i>
            <span>fab fa-java</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-php')">
            <i class="fab fa-php"></i>
            <span>fab fa-php</span>
          </div>
        </div>
      </div>

      <!-- Payment & E-commerce -->
      <div class="category-section">
        <div class="category-header">
          <i class="fab fa-paypal"></i> Payment & E-commerce
        </div>
        <div class="icons-grid">
          <div class="icon-item" onclick="copyToClipboard('fab fa-paypal')">
            <i class="fab fa-paypal"></i>
            <span>fab fa-paypal</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-stripe')">
            <i class="fab fa-stripe"></i>
            <span>fab fa-stripe</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-stripe-s')">
            <i class="fab fa-stripe-s"></i>
            <span>fab fa-stripe-s</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-cc-visa')">
            <i class="fab fa-cc-visa"></i>
            <span>fab fa-cc-visa</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-cc-mastercard')">
            <i class="fab fa-cc-mastercard"></i>
            <span>fab fa-cc-mastercard</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-cc-amex')">
            <i class="fab fa-cc-amex"></i>
            <span>fab fa-cc-amex</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-cc-paypal')">
            <i class="fab fa-cc-paypal"></i>
            <span>fab fa-cc-paypal</span>
          </div>
          <div class="icon-item" onclick="copyToClipboard('fab fa-bitcoin')">
            <i class="fab fa-bitcoin"></i>
            <span>fab fa-bitcoin</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="container">
        <h1><i class="fas fa-cogs"></i> Management Panel Icons</h1>

        <div class="icon-section">
            <h2 class="section-title"><i class="fas fa-solid"></i> Font Awesome Solid (FAS) Icons</h2>
            <div class="icon-grid">
                <div class="icon-item">
                    <i class="fas fa-tachometer-alt"></i>
                    <div class="icon-name">Dashboard</div>
                    <div class="icon-class">fas fa-tachometer-alt</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-cogs"></i>
                    <div class="icon-name">Settings</div>
                    <div class="icon-class">fas fa-cogs</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-users"></i>
                    <div class="icon-name">User Management</div>
                    <div class="icon-class">fas fa-users</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-chart-bar"></i>
                    <div class="icon-name">Analytics</div>
                    <div class="icon-class">fas fa-chart-bar</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-database"></i>
                    <div class="icon-name">Database</div>
                    <div class="icon-class">fas fa-database</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-shield-alt"></i>
                    <div class="icon-name">Security</div>
                    <div class="icon-class">fas fa-shield-alt</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-tasks"></i>
                    <div class="icon-name">Task Manager</div>
                    <div class="icon-class">fas fa-tasks</div>
                </div>
                <div class="icon-item">
                    <i class="fas fa-server"></i>
                    <div class="icon-name">Server</div>
                    <div class="icon-class">fas fa-server</div>
                </div>
            </div>
        </div>

        <div class="icon-section">
            <h2 class="section-title"><i class="far fa-regular"></i> Font Awesome Regular (FAR) Icons</h2>
            <div class="icon-grid">
                <div class="icon-item">
                    <i class="far fa-chart-bar"></i>
                    <div class="icon-name">Analytics</div>
                    <div class="icon-class">far fa-chart-bar</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-user"></i>
                    <div class="icon-name">User Profile</div>
                    <div class="icon-class">far fa-user</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-file-alt"></i>
                    <div class="icon-name">Documents</div>
                    <div class="icon-class">far fa-file-alt</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-envelope"></i>
                    <div class="icon-name">Messages</div>
                    <div class="icon-class">far fa-envelope</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-calendar-alt"></i>
                    <div class="icon-name">Schedule</div>
                    <div class="icon-class">far fa-calendar-alt</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-bell"></i>
                    <div class="icon-name">Notifications</div>
                    <div class="icon-class">far fa-bell</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-folder"></i>
                    <div class="icon-name">File Manager</div>
                    <div class="icon-class">far fa-folder</div>
                </div>
                <div class="icon-item">
                    <i class="far fa-clock"></i>
                    <div class="icon-name">Time Tracking</div>
                    <div class="icon-class">far fa-clock</div>
                </div>
            </div>
        </div>

        <div class="comparison">
            <h2 class="section-title">FAS vs FAR Comparison</h2>
            <div class="comparison-grid">
                <div class="comparison-item">
                    <h3>Font Awesome Solid (FAS)</h3>
                    <p>Filled, bold icons perfect for primary actions and main navigation</p>
                    <div>
                        <i class="fas fa-heart"></i>
                        <i class="fas fa-star"></i>
                        <i class="fas fa-home"></i>
                    </div>
                </div>
                <div class="comparison-item">
                    <h3>Font Awesome Regular (FAR)</h3>
                    <p>Outlined, lighter icons ideal for secondary actions and subtle UI elements</p>
                    <div>
                        <i class="far fa-heart"></i>
                        <i class="far fa-star"></i>
                        <i class="far fa-building"></i>
                    </div>
                </div>
            </div>
        </div>
    </div>

  <div class="toast" id="toast">Icon class copied to clipboard!</div>

  <script>
    // Icon counts
    const solidIcons = document.querySelectorAll('#solid-icons .icon-item').length;
    const regularIcons = document.querySelectorAll('#regular-icons .icon-item').length;
    const brandsIcons = document.querySelectorAll('#brands-icons .icon-item').length;

    // Update counters
    document.getElementById('solidCount').textContent = solidIcons;
    document.getElementById('regularCount').textContent = regularIcons;
    document.getElementById('brandsCount').textContent = brandsIcons;

    // Style switching functionality
    function showStyle(style) {
      // Hide all sections
      document.getElementById('solid-icons').classList.add('hidden');
      document.getElementById('regular-icons').classList.add('hidden');
      document.getElementById('brands-icons').classList.add('hidden');

      // Show selected section
      document.getElementById(style + '-icons').classList.remove('hidden');

      // Update active tab
      document.querySelectorAll('.style-tab').forEach(tab => tab.classList.remove('active'));
      event.target.classList.add('active');
    }

    // Search functionality
    document.getElementById('searchInput').addEventListener('input', function(e) {
      const searchTerm = e.target.value.toLowerCase();
      const activeSection = document.querySelector('[id$="-icons"]:not(.hidden)');
      const iconItems = activeSection.querySelectorAll('.icon-item');
      const categorySection = activeSection.querySelectorAll('.category-section');

      iconItems.forEach(item => {
        const iconName = item.querySelector('span').textContent.toLowerCase();
        const isVisible = iconName.includes(searchTerm);
        item.style.display = isVisible ? 'flex' : 'none';
      });

      // Hide empty categories
      categorySection.forEach(section => {
        const visibleIcons = section.querySelectorAll('.icon-item[style="display: flex"], .icon-item:not([style*="display: none"])');
        const hasVisibleIcons = Array.from(visibleIcons).some(icon =>
          !icon.style.display || icon.style.display === 'flex'
        );
        section.style.display = hasVisibleIcons ? 'block' : 'none';
      });
    });

    // Copy to clipboard functionality
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(function() {
        showToast();
      }).catch(function() {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast();
      });
    }

    // Toast notification
    function showToast() {
      const toast = document.getElementById('toast');
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }

    // Initialize with solid icons
    showStyle('solid');
  </script>
</body>

</html>