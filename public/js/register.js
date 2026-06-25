function previewAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const preview = document.getElementById('avatar-preview');
    const label = document.getElementById('file-label-text');
    const reader = new FileReader();
    reader.onload = e => {
        preview.src = e.target.result;
        preview.classList.add('visible');
        label.textContent = file.name;
    };
    reader.readAsDataURL(file);
}

document.getElementById('register-form').addEventListener('submit', function () {
    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Creando cuenta...';
    btn.disabled = true;
});