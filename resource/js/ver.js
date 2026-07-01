// resource/js/ver.js --> global version system

const ver = document.getElementById('version');
if (ver) {
  ver.innerHTML = '<i class="fas fa-code-branch" style="margin-right:4px;"></i>Version: 2.3.16';
  ver.style.display = 'block';
  ver.style.fontFamily = 'Roboto, Arial, sans-serif';
  ver.style.fontSize = '1.5vmin';
  ver.style.fontWeight = 'bold';
  ver.style.paddingRight = '20px';
  ver.style.position = 'fixed';
  ver.style.bottom = '1vmin';
  ver.style.right = '1.2vmin';
  ver.style.zIndex = '1000';
  ver.style.color = 'gray';
}