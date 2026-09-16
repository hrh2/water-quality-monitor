import { Api, setToken, ApiError, NetworkError } from './api.js';
import { safeErrorMessage } from './utils.js';

// Manages the login screen and the forced "change your password" screen.
// Neither screen is skippable when must_change_password is true - the
// caller (app.js) only boots the main dashboard once onReady() fires.

export function initAuthScreens({ onReady }) {
  const loginScreen = document.getElementById('loginScreen');
  const changePwScreen = document.getElementById('changePasswordScreen');
  const loginForm = document.getElementById('loginForm');
  const loginBanner = document.getElementById('loginBanner');
  const loginBtn = document.getElementById('loginSubmitBtn');

  const pwForm = document.getElementById('changePasswordForm');
  const pwBanner = document.getElementById('changePasswordBanner');
  const pwBtn = document.getElementById('changePasswordSubmitBtn');

  function showLogin() {
    changePwScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginBanner.classList.add('hidden');
    loginForm.reset();
  }

  function showChangePassword() {
    loginScreen.classList.add('hidden');
    changePwScreen.classList.remove('hidden');
    pwBanner.classList.add('hidden');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginBanner.classList.add('hidden');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return;

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    try {
      const result = await Api.login(email, password);
      setToken(result.token);
      // onReady (app.js's bootFromExistingToken) re-fetches /api/auth/me and
      // decides between the change-password screen and the dashboard from
      // that live value - never from this login response alone - so a
      // later page refresh can't drift out of sync with the server's
      // actual must_change_password state.
      onReady();
    } catch (err) {
      loginBanner.textContent =
        err instanceof ApiError || err instanceof NetworkError
          ? safeErrorMessage(err)
          : 'Sign-in failed. Please try again.';
      loginBanner.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
    }
  });

  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwBanner.classList.add('hidden');
    const current = document.getElementById('currentPassword').value;
    const next = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (next.length < 10) {
      pwBanner.textContent = 'New password must be at least 10 characters.';
      pwBanner.classList.remove('hidden');
      return;
    }
    if (next !== confirm) {
      pwBanner.textContent = 'New password and confirmation do not match.';
      pwBanner.classList.remove('hidden');
      return;
    }

    pwBtn.disabled = true;
    pwBtn.textContent = 'Updating…';
    try {
      await Api.changePassword(current, next);
      pwForm.reset();
      onReady();
    } catch (err) {
      pwBanner.textContent = safeErrorMessage(err);
      pwBanner.classList.remove('hidden');
    } finally {
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password & continue';
    }
  });

  return { showLogin, showChangePassword };
}
