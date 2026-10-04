document.addEventListener('DOMContentLoaded', function () {
    // Password toggle
    const toggleBtn = document.getElementById('passwordToggleBtn');
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    const eyeOffIcon = document.getElementById('eyeOffIcon');

    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', function (e) {
            e.preventDefault();
            const isPassword = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');

            if (eyeIcon && eyeOffIcon) {
                if (isPassword) {
                    eyeIcon.classList.add('hidden');
                    eyeOffIcon.classList.remove('hidden');
                } else {
                    eyeIcon.classList.remove('hidden');
                    eyeOffIcon.classList.add('hidden');
                }
            }
        });
    }

    // Auto-focus username if empty, or password if username is already filled
    const usernameInput = document.getElementById('username');
    if (usernameInput && usernameInput.value.trim().length > 0 && passwordInput) {
        passwordInput.focus();
    }
});
