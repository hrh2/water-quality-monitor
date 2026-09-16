import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, categoryBadge, escapeHtml } from '../utils.js';
import { renderDoughnutChart, renderCategoryTimeChart } from '../charts.js';

const CATEGORY_ORDER = ['Safe', 'Moderate', 'Unsafe', 'Critical'];
const CATEGORY_COLORS = {
  Safe: '#35d0c4',
  Moderate: '#e8b34c',
  Unsafe: '#e0863f',
  Critical: '#e2645a',
};

export async function render(container) {
  renderState(container, 'loading', { loadingText: 'Loading water quality data…' });

  let resp;
  try {
    resp = await Api.getPredictions({ limit: 200 });
  } catch (err) {
    renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: () => render(container) });
    return;
  }

  const { predictions, class_distribution } = resp;

  if (predictions.length === 0) {
    renderState(container, 'empty', {
      title: 'No predictions yet',
      message:
        'Predictions are generated automatically whenever a device sends a reading. ' +
        'Once at least one reading has been ingested, classifications will appear here. ' +
        'You can also try the model directly from the <strong>ML</strong> tab.',
    });
    return;
  }

  const distMap = new Map(class_distribution.map((r) => [r.water_quality_category, Number(r.count)]));
  const chronological = [...predictions].reverse();

  container.innerHTML = `
    <div class="grid-2">
      <div class="panel-box">
        <h4>Current classification distribution</h4>
        <div class="chart-wrap"><canvas id="wqDistChart"></canvas></div>
      </div>
      <div class="panel-box">
        <h4>Predicted category over time</h4>
        <div class="chart-wrap"><canvas id="wqTimeChart"></canvas></div>
      </div>
    </div>

    <div class="panel-box">
      <h4>Recent predictions</h4>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Device</th><th>Category</th><th>Confidence</th><th>pH</th><th>Turbidity</th><th>TDS</th><th>Contamination risk</th></tr></thead>
          <tbody>
            ${predictions.slice(0, 100).map((p) => `
              <tr>
                <td>${fmtDateTime(p.created_at)}</td>
                <td class="mono-cell">${escapeHtml(p.device_id)}</td>
                <td>${categoryBadge(p.water_quality_category)}</td>
                <td class="mono-cell">${(p.prediction_confidence * 100).toFixed(0)}%</td>
                <td class="mono-cell">${typeof p.ph === 'number' ? p.ph.toFixed(2) : '—'}</td>
                <td class="mono-cell">${p.turbidity_ntu.toFixed(1)}</td>
                <td class="mono-cell">${p.tds_ppm.toFixed(0)}</td>
                <td>${p.contamination_risk ? '<span class="badge badge-danger">risk</span>' : '<span class="badge badge-accent">none</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderDoughnutChart('wqDistChart', {
    labels: CATEGORY_ORDER,
    data: CATEGORY_ORDER.map((c) => distMap.get(c) || 0),
    colors: CATEGORY_ORDER.map((c) => CATEGORY_COLORS[c]),
  });

  renderCategoryTimeChart('wqTimeChart', {
    points: chronological.map((p) => ({ x: new Date(p.created_at).getTime(), category: p.water_quality_category })),
    categoryOrder: CATEGORY_ORDER,
    colorFor: (cat) => CATEGORY_COLORS[cat] || '#8892f0',
  });
}
