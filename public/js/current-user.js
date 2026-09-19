// Tiny in-memory store for the currently authenticated user's own profile
// (id/email/role), set once at boot (app.js::bootFromExistingToken) from a
// live /api/auth/me call. Deliberately not persisted anywhere (no
// localStorage) - it's re-fetched fresh on every page load/login, same as
// the must_change_password check it travels alongside, so it can never go
// stale relative to the server's view of the account.
let currentUser = null;

export function setCurrentUser(user) {
  currentUser = user;
}

export function getCurrentUser() {
  return currentUser;
}

export function isAdmin() {
  return currentUser?.role === 'admin';
}
