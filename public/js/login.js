document.getElementById('login-form').addEventListener('submit', function () {
    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Ingresando...';
    btn.disabled = true;
});