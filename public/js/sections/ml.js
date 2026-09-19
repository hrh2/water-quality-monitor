import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, categoryBadge, escapeHtml } from '../utils.js';
import { renderBarChart } from '../charts.js';

const CATEGORY_COLORS = {
  Safe: '#35d0c4',
  Moderate: '#e8b34c',
  Unsafe: '#e0863f',
  Critical: '#e2645a',
};

export async function render(container) {
  renderState(container, 'loading', { loadingText: 'Loading model info…' });

  // Api.getDashboard() is role-aware (see api/dashboard.js): a regular
  // user gets their own usage stats back, which has no `ml_model` field -
  // so `model` below is simply undefined for them, and the "Model status"
  // card doesn't render. Still wrapped in .catch() in case the call fails
  // outright (network error etc.), isolating that to this one card rather
  // than failing the whole tab like Api.getPredictions() already does for
  // its own possible failure.
  const [health, predictionsResp] = await Promise.all([
    Api.getDashboard().catch(() => null),
    Api.getPredictions({ limit: 10 }).catch(() => ({ predictions: [] })),
  ]);

  const model = health?.ml_model || null;
  const modelOk = model?.status === 'ok';

  container.innerHTML = `
    ${model ? `
    <div class="panel-box">
      <h4>Model status</h4>
      <div class="card-grid" style="margin-bottom:0;">
        <div class="card">
          <div class="label">Status</div>
          <div class="value" style="font-size:16px;">
            <span class="badge ${modelOk ? 'badge-accent' : 'badge-danger'}">${escapeHtml(model.status || 'unknown')}</span>
          </div>
        </div>
        <div class="card">
          <div class="label">Model type</div>
          <div class="value mono" style="font-size:16px;">${escapeHtml(model.model_type || '—')}</div>
        </div>
        <div class="card">
          <div class="label">Class labels</div>
          <div class="value" style="font-size:14px;">${(model.class_labels || []).map((c) => categoryBadge(c)).join(' ')}</div>
        </div>
        <div class="card">
          <div class="label">Feature order</div>
          <div class="value mono" style="font-size:13px;">${(model.feature_order || []).join(', ') || '—'}</div>
        </div>
      </div>
    </div>
    ` : ''}

    <div class="grid-2">
      <div class="panel-box">
        <h4>Try a prediction</h4>
        <p class="text-dim" style="font-size:12.5px; margin-top:-8px;">
          Runs the model against the values you enter. No new sensor or device data is
          created - only the request itself is logged (to power your Dashboard's usage stats).
        </p>
        <form id="tryPredictForm">
          <div class="inline-fields">
            <div class="field">
              <label for="predPh">pH (optional)</label>
              <input type="number" step="0.01" id="predPh" placeholder="e.g. 7.10" />
            </div>
            <div class="field">
              <label for="predTurbidity">Turbidity (NTU) *</label>
              <input type="number" step="0.01" id="predTurbidity" required placeholder="e.g. 3.4" />
            </div>
            <div class="field">
              <label for="predTds">TDS (ppm) *</label>
              <input type="number" step="0.01" id="predTds" required placeholder="e.g. 214.6" />
            </div>
          </div>
          <div id="predictBanner" class="hidden" style="color:var(--danger); font-size:13px; margin-bottom:12px;"></div>
          <button type="submit" class="btn btn-primary" id="predictSubmitBtn">Predict</button>
        </form>
        <div id="predictResult" style="margin-top:20px;"></div>
      </div>

      <div class="panel-box">
        <h4>Recent predictions</h4>
        <div id="mlRecentPredictions"></div>
      </div>
    </div>
  `;

  renderRecentPredictions(predictionsResp.predictions);

  document.getElementById('tryPredictForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const banner = document.getElementById('predictBanner');
    const submitBtn = document.getElementById('predictSubmitBtn');
    const resultEl = document.getElementById('predictResult');
    banner.classList.add('hidden');

    const phRaw = document.getElementById('predPh').value;
    const turbidity_ntu = parseFloat(document.getElementById('predTurbidity').value);
    const tds_ppm = parseFloat(document.getElementById('predTds').value);

    if (Number.isNaN(turbidity_ntu) || Number.isNaN(tds_ppm)) {
      banner.textContent = 'Turbidity and TDS are required numbers.';
      banner.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Predicting…';
    try {
      const payload = { turbidity_ntu, tds_ppm };
      if (phRaw !== '') payload.ph = parseFloat(phRaw);
      const result = await Api.predict(payload);
      renderPredictResult(resultEl, result);
    } catch (err) {
      banner.textContent = safeErrorMessage(err);
      banner.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Predict';
    }
  });
}

function renderRecentPredictions(predictions) {
  const el = document.getElementById('mlRecentPredictions');
  if (predictions.length === 0) {
    renderState(el, 'empty', { title: 'No predictions yet', message: 'Recent predictions will appear here as devices send readings.' });
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Time</th><th>Device</th><th>Category</th><th>Confidence</th></tr></thead>
        <tbody>
          ${predictions.map((p) => `
            <tr>
              <td>${fmtDateTime(p.created_at)}</td>
              <td class="mono-cell">${escapeHtml(p.device_id)}</td>
              <td>${categoryBadge(p.water_quality_category)}</td>
              <td class="mono-cell">${(p.prediction_confidence * 100).toFixed(0)}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPredictResult(container, result) {
  const probs = result.class_probabilities || {};
  const labels = Object.keys(probs);
  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; margin-bottom:14px; flex-wrap:wrap;">
      ${categoryBadge(result.water_quality_category)}
      <span class="mono text-dim">confidence ${(result.prediction_confidence * 100).toFixed(1)}%</span>
    </div>
    <div class="chart-wrap small"><canvas id="predictProbsChart"></canvas></div>
  `;
  renderBarChart('predictProbsChart', {
    labels,
    data: labels.map((l) => probs[l]),
    colors: labels.map((l) => CATEGORY_COLORS[l] || '#8892f0'),
  });
}
