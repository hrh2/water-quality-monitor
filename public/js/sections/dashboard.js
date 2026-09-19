import { Api } from '../api.js';
import { getCurrentUser } from '../current-user.js';
import { renderState, safeErrorMessage, fmtDateTime, fmtRelativeTime, categoryBadge, escapeHtml } from '../utils.js';
import { renderDoughnutChart } from '../charts.js';

const CATEGORY_ORDER = ['Safe', 'Moderate', 'Unsafe', 'Critical'];
const CATEGORY_COLORS = { Safe: '#35d0c4', Moderate: '#e8b34c', Unsafe: '#e0863f', Critical: '#e2645a' };

function countFor(distribution, category) {
  const row = (distribution || []).find((r) => r.water_quality_category === category);
  return row ? Number(row.count) : 0;
}

function greeting(me) {
  const name = me?.first_name ? escapeHtml(me.first_name) : null;
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${timeGreeting}, ${name}` : timeGreeting;
}

// Dashboard content differs entirely by role: admins see cross-platform
// system-wide stats (every device, every reading, every user), regular
// users see stats scoped to only their own activity (their own what-if
// predictions and report exports) - never another user's data. Both
// branches call the same role-aware GET /api/dashboard (api/dashboard.js).
export async function render(container) {
  const me = getCurrentUser();
  if (me?.role === 'admin') return renderAdminDashboard(container, me);
  return renderUserDashboard(container, me);
}

async function renderAdminDashboard(container, me) {
  renderState(container, 'loading', { loadingText: 'Loading dashboard…' });

  let dash;
  let latestPredictionResp;
  try {
    [dash, latestPredictionResp] = await Promise.all([
      Api.getDashboard(),
      Api.getPredictions({ limit: 1 }).catch(() => null),
    ]);
  } catch (err) {
    renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: () => render(container) });
    return;
  }

  const noDevices = dash.devices.total === 0;
  const noReadings = dash.total_readings === 0;
  const dbOk = dash.database.status === 'ok';
  const mlOk = dash.ml_model.status === 'ok';
  const latest = latestPredictionResp && latestPredictionResp.predictions[0];
  const categoryData = CATEGORY_ORDER.map((c) => countFor(dash.category_distribution, c));

  container.innerHTML = `
    <h3 style="margin:0 0 18px; font-weight:500;">${greeting(me)}</h3>

    <div class="card-grid">
      <div class="card">
        <div class="label">Devices</div>
        <div class="value">${dash.devices.total}</div>
        <div class="sub">${dash.devices.online} online &middot; ${dash.devices.offline} offline</div>
      </div>
      <div class="card">
        <div class="label">Total readings</div>
        <div class="value">${dash.total_readings}</div>
      </div>
      <div class="card">
        <div class="label">Active alerts</div>
        <div class="value">${dash.active_alerts}</div>
        <div class="sub ${dash.active_alerts > 0 ? 'warn' : 'ok'}">${dash.active_alerts > 0 ? 'needs attention' : 'all clear'}</div>
      </div>
      <div class="card">
        <div class="label">System health</div>
        <div class="value" style="font-size:16px;">
          <span class="badge ${dbOk ? 'badge-accent' : 'badge-danger'}">DB ${dbOk ? 'ok' : 'down'}</span>
          <span class="badge ${mlOk ? 'badge-accent' : 'badge-danger'}" style="margin-left:6px;">Model ${mlOk ? 'ok' : 'down'}</span>
        </div>
      </div>
    </div>

    <div class="card-grid">
      <div class="card">
        <div class="label">Registered users</div>
        <div class="value">${dash.total_users}</div>
      </div>
      <div class="card">
        <div class="label">What-if predictions run</div>
        <div class="value">${dash.total_prediction_requests}</div>
        <div class="sub">all users, all time</div>
      </div>
      <div class="card">
        <div class="label">Reports exported</div>
        <div class="value">${dash.total_reports_exported}</div>
        <div class="sub">all users, all time</div>
      </div>
    </div>

    ${noDevices && noReadings ? `
    <div class="panel-box">
      <div class="state-block">
        <div class="state-title">No devices registered yet</div>
        <div>Go to the <strong>Devices</strong> tab and register your first device to get a
        one-time device token, then configure the firmware with it. Readings and predictions
        will appear here as soon as the device starts sending data.</div>
      </div>
    </div>
    ` : `
    <div class="grid-2">
      <div class="panel-box">
        <h4>Water quality classifications (all-time)</h4>
        <div class="chart-wrap small"><canvas id="dashCategoryChart"></canvas></div>
      </div>
      <div class="panel-box">
        <h4>Latest prediction</h4>
        ${
          latest
            ? `<div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
                ${categoryBadge(latest.water_quality_category)}
                <span class="mono text-dim">confidence ${(latest.prediction_confidence * 100).toFixed(0)}%</span>
                <span class="mono text-dim">device ${escapeHtml(latest.device_id)}</span>
                <span class="mono text-dim">${fmtDateTime(latest.created_at)}</span>
              </div>`
            : `<div class="text-dim">No predictions recorded yet.</div>`
        }
      </div>
    </div>
    `}
  `;

  if (!(noDevices && noReadings)) {
    renderDoughnutChart('dashCategoryChart', {
      labels: CATEGORY_ORDER,
      data: categoryData,
      colors: CATEGORY_ORDER.map((c) => CATEGORY_COLORS[c]),
    });
  }
}

async function renderUserDashboard(container, me) {
  renderState(container, 'loading', { loadingText: 'Loading your dashboard…' });

  let dash;
  try {
    dash = await Api.getDashboard();
  } catch (err) {
    renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: () => render(container) });
    return;
  }

  const total = dash.predictions.total;
  const categoryData = CATEGORY_ORDER.map((c) => countFor(dash.predictions.by_category, c));
  const topCategory = dash.predictions.by_category.slice().sort((a, b) => Number(b.count) - Number(a.count))[0];

  container.innerHTML = `
    <h3 style="margin:0 0 18px; font-weight:500;">${greeting(me)}</h3>

    <div class="card-grid">
      <div class="card">
        <div class="label">Predictions you've run</div>
        <div class="value">${total}</div>
      </div>
      <div class="card">
        <div class="label">Most common result</div>
        <div class="value" style="font-size:16px;">${topCategory ? categoryBadge(topCategory.water_quality_category) : '—'}</div>
      </div>
      <div class="card">
        <div class="label">Reports you've exported</div>
        <div class="value">${dash.reports_exported.total}</div>
      </div>
      <div class="card">
        <div class="label">Member since</div>
        <div class="value" style="font-size:16px;">${fmtDateTime(dash.account.created_at)}</div>
      </div>
    </div>

    ${total === 0 ? `
    <div class="panel-box">
      <div class="state-block">
        <div class="state-title">No predictions yet</div>
        <div>Head to the <strong>ML / Prediction</strong> tab and try a what-if prediction -
        your results and stats will show up here.</div>
      </div>
    </div>
    ` : `
    <div class="grid-2">
      <div class="panel-box">
        <h4>Your predictions by category</h4>
        <div class="chart-wrap small"><canvas id="dashUserCategoryChart"></canvas></div>
      </div>
      <div class="panel-box">
        <h4>Your recent predictions</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Time</th><th>Category</th><th>Confidence</th></tr></thead>
            <tbody>
              ${dash.predictions.recent.map((p) => `
                <tr>
                  <td>${fmtRelativeTime(p.created_at)}</td>
                  <td>${categoryBadge(p.water_quality_category)}</td>
                  <td class="mono-cell">${(p.prediction_confidence * 100).toFixed(0)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    `}
  `;

  if (total > 0) {
    renderDoughnutChart('dashUserCategoryChart', {
      labels: CATEGORY_ORDER,
      data: categoryData,
      colors: CATEGORY_ORDER.map((c) => CATEGORY_COLORS[c]),
    });
  }
}
