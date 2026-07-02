'use strict';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const loginBtn = document.getElementById('loginBtn');
const togglePass = document.getElementById('togglePass');
const passwordInput = document.getElementById('password');

togglePass.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  togglePass.textContent = show ? '🙈' : '👁';
  togglePass.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

async function checkExistingSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        window.location.replace('/');
      }
    }
  } catch { /* offline or server down */ }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  loginBtn.disabled = true;
  loginBtn.querySelector('.login-submit-text').textContent = 'Signing in…';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 404) {
        errorEl.textContent = 'Auth API not found — restart the server (npm start) and try again.';
      } else {
        errorEl.textContent = data.error || 'Invalid username or password';
      }
      errorEl.hidden = false;
      return;
    }

    if (data.displayName) {
      localStorage.setItem('cphi_user', data.displayName);
    }
    if (data.isAdmin) {
      localStorage.setItem('cphi_is_admin', '1');
    } else {
      localStorage.removeItem('cphi_is_admin');
    }
    if (data.canViewBudget) {
      localStorage.setItem('cphi_can_budget', '1');
    } else {
      localStorage.removeItem('cphi_can_budget');
    }
    if (data.role) {
      localStorage.setItem('cphi_role', data.role);
    }
    window.location.replace('/');
  } catch {
    errorEl.textContent = 'Could not reach the server. Make sure npm start is running.';
    errorEl.hidden = false;
  } finally {
    loginBtn.disabled = false;
    loginBtn.querySelector('.login-submit-text').textContent = 'Enter planner';
  }
});

checkExistingSession();
