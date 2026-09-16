// Pure-JS evaluator for the portable model exported by
// ml/inference/export_portable_model.py. No native/binary ML dependency is
// required, which keeps this compatible with Vercel Node.js serverless
// functions. See docs/architecture/adr-002-ml-inference-runtime.md for why
// this split exists instead of running the Python model directly.
//
// Feature order/names must match docs/architecture/data-contract.md exactly:
// [ph, turbidity_ntu, tds_ppm].

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.join(__dirname, '..', '..', 'ml', 'models', 'portable_model.json');

let cachedModel = null;

function loadModel() {
  if (!cachedModel) {
    const raw = readFileSync(MODEL_PATH, 'utf-8');
    cachedModel = JSON.parse(raw);
  }
  return cachedModel;
}

function scaleFeatures(model, rawFeatures) {
  const { impute_values, scale_mean, scale_std } = model.preprocessor;
  return model.feature_order.map((_, i) => {
    let value = rawFeatures[i];
    if (value === null || value === undefined || Number.isNaN(value)) {
      value = impute_values[i];
    }
    return (value - scale_mean[i]) / scale_std[i];
  });
}

function evalTree(tree, features) {
  let nodeIdx = 0;
  const nodes = tree.nodes;
  // Bounded by tree depth; guard against malformed exports looping forever.
  for (let guard = 0; guard < nodes.length; guard++) {
    const node = nodes[nodeIdx];
    if (node.leaf) return node.proba;
    nodeIdx = features[node.feature] <= node.threshold ? node.left : node.right;
  }
  throw new Error('Tree traversal exceeded node count - malformed portable model export.');
}

function predictTreeEnsemble(model, features) {
  const nClasses = model.class_labels.length;
  const totals = new Array(nClasses).fill(0);
  for (const tree of model.trees) {
    const proba = evalTree(tree, features);
    for (let c = 0; c < nClasses; c++) totals[c] += proba[c];
  }
  return totals.map((t) => t / model.trees.length);
}

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function predictLogisticRegression(model, features) {
  const scores = model.coef.map(
    (rowWeights, classIdx) =>
      rowWeights.reduce((sum, w, i) => sum + w * features[i], 0) + model.intercept[classIdx]
  );
  // Binary logistic regression stores a single weight row; scikit-learn's
  // convention there is [P(class_1)], with P(class_0) = 1 - P(class_1).
  if (model.coef.length === 1) {
    const p1 = 1 / (1 + Math.exp(-scores[0]));
    return [1 - p1, p1];
  }
  return softmax(scores);
}

/**
 * Runs a prediction against the exported model.
 * @param {{ph: number|null, turbidity_ntu: number, tds_ppm: number}} reading
 * @returns {{water_quality_category: string, prediction_confidence: number, class_probabilities: Record<string, number>}}
 */
export function predictWaterQuality(reading) {
  const model = loadModel();
  const rawFeatures = model.feature_order.map((name) => {
    const value = reading[name];
    return typeof value === 'number' ? value : null;
  });
  const features = scaleFeatures(model, rawFeatures);

  let probabilities;
  if (model.model_type === 'random_forest' || model.model_type === 'decision_tree') {
    probabilities = predictTreeEnsemble(model, features);
  } else if (model.model_type === 'logistic_regression') {
    probabilities = predictLogisticRegression(model, features);
  } else {
    throw new Error(`Unsupported portable model_type: ${model.model_type}`);
  }

  let bestIdx = 0;
  for (let i = 1; i < probabilities.length; i++) {
    if (probabilities[i] > probabilities[bestIdx]) bestIdx = i;
  }

  const class_probabilities = {};
  model.class_labels.forEach((label, i) => {
    class_probabilities[label] = probabilities[i];
  });

  return {
    water_quality_category: model.class_labels[bestIdx],
    prediction_confidence: probabilities[bestIdx],
    class_probabilities,
  };
}

export function getModelMetadata() {
  const model = loadModel();
  return { model_type: model.model_type, class_labels: model.class_labels, feature_order: model.feature_order };
}
