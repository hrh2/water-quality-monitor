import { Api, setToken, ApiError, NetworkError } from './api.js';
import { safeErrorMessage } from './utils.js';

// Manages the login screen and the forced "change your password" screen.
// Neither screen is skippable when must_change_password is true - the
// caller (app.js) only boots the main dashboard once onReady() fires.

export function initAuthScreens({ onReady }) {
  const loginScreen = document.getElementById('loginScreen');
  const changePwScreen = document.getElementById('changePasswordScreen');
  const registerScreen = document.getElementById('registerScreen');
  const loginForm = document.getElementById('loginForm');
  const loginBanner = document.getElementById('loginBanner');
  const loginBtn = document.getElementById('loginSubmitBtn');

  const pwForm = document.getElementById('changePasswordForm');
  const pwBanner = document.getElementById('changePasswordBanner');
  const pwBtn = document.getElementById('changePasswordSubmitBtn');

  const registerForm = document.getElementById('registerForm');
  const registerBanner = document.getElementById('registerBanner');
  const registerBtn = document.getElementById('registerSubmitBtn');

  function showLogin() {
    changePwScreen.classList.add('hidden');
    registerScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginBanner.classList.add('hidden');
    loginForm.reset();
  }

  function showChangePassword() {
    loginScreen.classList.add('hidden');
    registerScreen.classList.add('hidden');
    changePwScreen.classList.remove('hidden');
    pwBanner.classList.add('hidden');
  }

  function showRegister() {
    loginScreen.classList.add('hidden');
    changePwScreen.classList.add('hidden');
    registerScreen.classList.remove('hidden');
    registerBanner.classList.add('hidden');
    registerForm.reset();
  }

  document.getElementById('showRegisterLink').addEventListener('click', (e) => {
    e.preventDefault();
    showRegister();
  });
  document.getElementById('showLoginLink').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
  });

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

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerBanner.classList.add('hidden');
    const firstName = document.getElementById('registerFirstName').value.trim();
    const lastName = document.getElementById('registerLastName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!firstName || !lastName) {
      registerBanner.textContent = 'First and last name are required.';
      registerBanner.classList.remove('hidden');
      return;
    }
    if (password.length < 10) {
      registerBanner.textContent = 'Password must be at least 10 characters.';
      registerBanner.classList.remove('hidden');
      return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Creating account…';
    try {
      const result = await Api.register(email, password, firstName, lastName);
      setToken(result.token);
      // Self-registered accounts never require a forced password change
      // (the user chose their own password), so onReady will go straight
      // to the dashboard - but it still re-checks via /api/auth/me rather
      // than trusting this response, same as the login path.
      onReady();
    } catch (err) {
      registerBanner.textContent =
        err instanceof ApiError || err instanceof NetworkError
          ? safeErrorMessage(err)
          : 'Registration failed. Please try again.';
      registerBanner.classList.remove('hidden');
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create account';
    }
  });

  return { showLogin, showChangePassword, showRegister };
}
