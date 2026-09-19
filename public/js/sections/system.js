import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, escapeHtml } from '../utils.js';

export async function render(container) {
  renderState(container, 'loading', { loadingText: 'Loading system status…' });

  let health;
  try {
    health = await Api.getDashboard();
  } catch (err) {
    renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: () => render(container) });
    return;
  }

  const dbOk = health.database.status === 'ok';
  const mlOk = health.ml_model.status === 'ok';

  container.innerHTML = `
    <div class="card-grid">
      <div class="card">
        <div class="label">Database</div>
        <div class="value" style="font-size:16px;"><span class="badge ${dbOk ? 'badge-accent' : 'badge-danger'}">${escapeHtml(health.database.status)}</span></div>
      </div>
      <div class="card">
        <div class="label">ML model</div>
        <div class="value" style="font-size:16px;"><span class="badge ${mlOk ? 'badge-accent' : 'badge-danger'}">${escapeHtml(health.ml_model.status)}</span></div>
        <div class="sub">${escapeHtml(health.ml_model.model_type || '')}</div>
      </div>
      <div class="card">
        <div class="label">Devices</div>
        <div class="value">${health.devices.total}</div>
        <div class="sub">${health.devices.online} online &middot; ${health.devices.offline} offline</div>
      </div>
      <div class="card">
        <div class="label">Active alerts</div>
        <div class="value">${health.active_alerts}</div>
      </div>
    </div>

    <div class="panel-box">
      <h4>Recent system events</h4>
      <div id="systemEventsWrap"></div>
    </div>
  `;

  const eventsWrap = document.getElementById('systemEventsWrap');
  const events = health.recent_system_events || [];
  if (events.length === 0) {
    renderState(eventsWrap, 'empty', { title: 'No system events recorded', message: 'System events (device registrations, failed logins, ingestion errors) will show up here.' });
    return;
  }

  eventsWrap.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Time</th><th>Event</th><th>Message</th></tr></thead>
        <tbody>
          ${events.map((e) => `
            <tr>
              <td>${fmtDateTime(e.created_at)}</td>
              <td class="mono-cell">${escapeHtml(e.event_type)}</td>
              <td>${escapeHtml(e.message)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
