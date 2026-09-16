import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, severityBadge, alertStatusBadge, escapeHtml } from '../utils.js';

const state = { statusFilter: 'active' };

export async function render(container) {
  container.innerHTML = `
    <div class="filters-bar">
      <div class="field">
        <label for="alertStatusFilter">Show</label>
        <select id="alertStatusFilter">
          <option value="active" ${state.statusFilter === 'active' ? 'selected' : ''}>Active only</option>
          <option value="" ${state.statusFilter === '' ? 'selected' : ''}>All alerts</option>
        </select>
      </div>
    </div>
    <div id="alertsResults"></div>
  `;

  document.getElementById('alertStatusFilter').addEventListener('change', (e) => {
    state.statusFilter = e.target.value;
    loadResults();
  });

  async function loadResults() {
    const resultsEl = document.getElementById('alertsResults');
    renderState(resultsEl, 'loading', { loadingText: 'Loading alerts…' });

    let alerts;
    try {
      const resp = await Api.getAlerts(state.statusFilter ? { status: state.statusFilter } : undefined);
      alerts = resp.alerts;
    } catch (err) {
      renderState(resultsEl, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: loadResults });
      return;
    }

    if (alerts.length === 0) {
      renderState(resultsEl, 'empty', {
        title: state.statusFilter === 'active' ? 'No active alerts' : 'No alerts recorded yet',
        message: state.statusFilter === 'active'
          ? 'All clear - no unresolved alerts right now.'
          : 'Alerts are raised automatically when a reading looks unsafe or anomalous.',
      });
      return;
    }

    resultsEl.innerHTML = `
      <div class="panel-box">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Severity</th><th>Device</th><th>Reason</th><th>Status</th><th>Created</th><th>Acknowledged</th><th>Resolved</th><th>Actions</th></tr></thead>
            <tbody>
              ${alerts.map((a) => `
                <tr data-alert-id="${a.id}">
                  <td>${severityBadge(a.severity)}</td>
                  <td class="mono-cell">${escapeHtml(a.device_id)}</td>
                  <td>${escapeHtml(a.reason)}</td>
                  <td>${alertStatusBadge(a.status)}</td>
                  <td>${fmtDateTime(a.created_at)}</td>
                  <td>${a.acknowledged_at ? fmtDateTime(a.acknowledged_at) : '—'}</td>
                  <td>${a.resolved_at ? fmtDateTime(a.resolved_at) : '—'}</td>
                  <td>
                    ${a.status === 'active' ? `<button class="btn btn-sm" data-action="acknowledge" data-id="${a.id}">Acknowledge</button>` : ''}
                    ${a.status !== 'resolved' ? `<button class="btn btn-sm btn-danger" data-action="resolve" data-id="${a.id}">Resolve</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    resultsEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '…';
        try {
          await Api.patchAlert(id, action);
          await loadResults();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = originalText;
          alert(safeErrorMessage(err));
        }
      });
    });
  }

  await loadResults();
}
