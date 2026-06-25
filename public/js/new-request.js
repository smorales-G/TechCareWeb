function updateMediaLabel(event) {
    const files = Array.from(event.target.files).slice(0, 5);
    const label = document.getElementById('media-label');
    const previews = document.getElementById('media-previews');
    label.textContent = `${files.length} archivo(s) seleccionado(s)`;
    previews.innerHTML = '';
    if (files.length > 0) previews.style.display = 'grid';
    files.forEach(file => {
        const isVideo = file.type.startsWith('video/');
        const el = isVideo ? document.createElement('video') : document.createElement('img');
        el.className = 'media-thumb';
        if (isVideo) { el.controls = false; el.muted = true; }
        const reader = new FileReader();
        reader.onload = e => { el.src = e.target.result; };
        reader.readAsDataURL(file);
        previews.appendChild(el);
    });
}

document.getElementById('req-form').addEventListener('submit', function () {
    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Enviando solicitud...';
    btn.disabled = true;
});