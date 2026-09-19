import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, fmtRelativeTime, roleBadge, activeStatusBadge, escapeHtml } from '../utils.js';
import { getCurrentUser } from '../current-user.js';

export async function render(container) {
  renderState(container, 'loading', { loadingText: 'Loading users…' });

  async function load() {
    let users;
    try {
      const resp = await Api.getUsers();
      users = resp.users;
    } catch (err) {
      renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: load });
      return;
    }

    if (users.length === 0) {
      renderState(container, 'empty', { title: 'No users yet', message: 'Registered users will appear here.' });
      return;
    }

    const me = getCurrentUser();

    container.innerHTML = `
      <div class="panel-box">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Registered</th><th>Last login</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map((u) => `
                <tr data-user-id="${u.id}">
                  <td class="mono-cell">${escapeHtml(u.email)}</td>
                  <td>${roleBadge(u.role)}</td>
                  <td>${activeStatusBadge(u.is_active)}</td>
                  <td>${fmtDateTime(u.created_at)}</td>
                  <td>${u.last_login_at ? fmtRelativeTime(u.last_login_at) : 'never'}</td>
                  <td>
                    ${u.id === me?.id
                      ? '<span class="text-dim" style="font-size:12px;">(you)</span>'
                      : u.is_active
                        ? `<button class="btn btn-sm btn-danger" data-action="deactivate" data-id="${u.id}">Deactivate</button>`
                        : `<button class="btn btn-sm" data-action="activate" data-id="${u.id}">Activate</button>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '…';
        try {
          await Api.patchUser(id, action);
          await load();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = originalText;
          alert(safeErrorMessage(err));
        }
      });
    });
  }

  await load();
}
