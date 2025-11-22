use rand::SeedableRng;
use rand_xoshiro::Xoshiro128Plus;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

mod bit_set;
mod sample;
mod serialize;

const RELATIVE_TOL: f64 = 0.001;
const ABSOLUTE_TOL: f64 = 0.0005;
const MIN_SAMPLES: usize = 1000;
const CHECK_INTERVAL: usize = 1000;
const Z_SCORE: f64 = 1.96;

fn has_converged(count: usize, n: usize) -> bool {
    if n < MIN_SAMPLES {
        return false;
    }

    #[allow(clippy::cast_precision_loss)]
    let p_hat = count as f64 / n as f64;

    let adjusted_count = count + 2;
    let adjusted_n = n + 4;
    #[allow(clippy::cast_precision_loss)]
    let p_tilde = adjusted_count as f64 / adjusted_n as f64;
    #[allow(clippy::cast_precision_loss)]
    let margin = Z_SCORE * (p_tilde * (1.0 - p_tilde) / adjusted_n as f64).sqrt();

    let threshold = ABSOLUTE_TOL.max(RELATIVE_TOL * p_hat);

    margin < threshold
}

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[derive(Serialize)]
pub struct SensitivityResult {
    pub node_id: String,
    pub sensitivity: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CptEntry {
    pub parent_states: HashMap<String, Option<bool>>,
    pub probability: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    #[serde(rename = "_id")]
    pub id: String,
    pub cpt_entries: Vec<CptEntry>,
}

#[wasm_bindgen]
#[allow(clippy::missing_errors_doc)]
pub fn compute_marginals(nodes: JsValue, num_samples: usize) -> Result<JsValue, JsValue> {
    if num_samples == 0 {
        return Err(JsValue::from_str("num_samples must be greater than 0"));
    }

    let nodes: Vec<Node> = serde_wasm_bindgen::from_value(nodes)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize nodes: {e}")))?;

    let serialized = serialize::serialize_network(&nodes)
        .map_err(|e| JsValue::from_str(&format!("Serialization failed: {e}")))?;

    let mut seed = [0u8; 16];
    getrandom::fill(&mut seed).map_err(|e| JsValue::from_str(&format!("RNG seed failed: {e}")))?;
    let mut rng = Xoshiro128Plus::from_seed(seed);

    let num_nodes = u8::try_from(serialized.topo_order.len())
        .map_err(|_| JsValue::from_str("Too many nodes for u8"))?;
    let mut node_true_counts = vec![0usize; usize::from(num_nodes)];
    let max_samples = num_samples;
    let mut n = 0usize;

    loop {
        for _ in 0..CHECK_INTERVAL.min(max_samples - n) {
            let sample_result = sample::sample(&serialized.data, num_nodes, None, &mut rng)
                .map_err(|e| JsValue::from_str(&format!("Sampling failed: {e}")))?;

            for node_idx in 0..num_nodes {
                if sample_result.contains(node_idx) {
                    node_true_counts[usize::from(node_idx)] += 1;
                }
            }
            n += 1;
        }

        if n >= max_samples {
            break;
        }

        if n >= MIN_SAMPLES {
            let all_converged = node_true_counts
                .iter()
                .all(|&count| has_converged(count, n));

            if all_converged {
                break;
            }
        }
    }

    #[allow(clippy::cast_precision_loss)]
    let probabilities: HashMap<String, f64> = serialized
        .topo_order
        .into_iter()
        .zip(node_true_counts)
        .map(|(node_id, count)| {
            let probability = count as f64 / n as f64;
            (node_id, probability)
        })
        .collect();

    serde_wasm_bindgen::to_value(&probabilities)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {e}")))
}

#[wasm_bindgen]
#[allow(clippy::missing_errors_doc, clippy::needless_pass_by_value)]
pub fn compute_sensitivity(
    nodes: JsValue,
    target_node_id: String,
    num_samples: usize,
) -> Result<JsValue, JsValue> {
    if num_samples == 0 {
        return Err(JsValue::from_str("num_samples must be greater than 0"));
    }

    let nodes: Vec<Node> = serde_wasm_bindgen::from_value(nodes)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize nodes: {e}")))?;

    // Verify target node exists
    if !nodes.iter().any(|n| n.id == target_node_id) {
        return Err(JsValue::from_str(&format!(
            "Target node {target_node_id} not found"
        )));
    }

    // Get ancestors before serialization
    let ancestor_set = get_ancestors(&nodes, &target_node_id);

    // If no ancestors (root node), return empty sensitivity map
    if ancestor_set.is_empty() {
        return serde_wasm_bindgen::to_value(&HashMap::<String, f64>::new())
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {e}")));
    }

    // Only serialize ancestors + target
    let nodes_to_serialize: Vec<Node> = nodes
        .into_iter()
        .filter(|n| ancestor_set.contains(n.id.as_str()) || n.id == target_node_id)
        .collect();

    let serialized = serialize::serialize_network(&nodes_to_serialize)
        .map_err(|e| JsValue::from_str(&format!("Serialization failed: {e}")))?;

    let num_nodes = u8::try_from(serialized.topo_order.len())
        .map_err(|_| JsValue::from_str("Too many nodes for u8"))?;

    let target_idx = u8::try_from(
        serialized
            .topo_order
            .iter()
            .position(|id| id == &target_node_id)
            .ok_or_else(|| JsValue::from_str(&format!("Target node {target_node_id} not found")))?,
    )
    .map_err(|_| JsValue::from_str("Target index exceeds u8::MAX"))?;

    let mut seed = [0u8; 16];
    getrandom::fill(&mut seed).map_err(|e| JsValue::from_str(&format!("RNG seed failed: {e}")))?;
    let mut rng = Xoshiro128Plus::from_seed(seed);

    let max_samples = num_samples;
    let mut compute_intervention_prob =
        |ancestor_idx: u8, intervention_value: bool| -> Result<f64, JsValue> {
            let mut count = 0usize;
            let mut n = 0usize;

            loop {
                for _ in 0..CHECK_INTERVAL.min(max_samples - n) {
                    let sample_result = sample::sample(
                        &serialized.data,
                        num_nodes,
                        Some(sample::Intervention {
                            on_node: ancestor_idx,
                            value: intervention_value,
                        }),
                        &mut rng,
                    )
                    .map_err(|e| JsValue::from_str(&format!("Sampling failed: {e}")))?;

                    if sample_result.contains(target_idx) {
                        count += 1;
                    }
                    n += 1;
                }

                if n >= max_samples {
                    break;
                }

                if n >= MIN_SAMPLES && has_converged(count, n) {
                    break;
                }
            }

            #[allow(clippy::cast_precision_loss)]
            let probability = count as f64 / n as f64;
            Ok(probability)
        };

    let mut sensitivities: HashMap<String, f64> = HashMap::new();

    for node in nodes_to_serialize {
        if node.id == target_node_id {
            continue;
        }

        let ancestor_idx = u8::try_from(
            serialized
                .topo_order
                .iter()
                .position(|id| id == &node.id)
                .ok_or_else(|| {
                    JsValue::from_str(&format!("Ancestor node {id} not found", id = node.id))
                })?,
        )
        .map_err(|_| JsValue::from_str("Ancestor index exceeds u8::MAX"))?;

        let prob_true = compute_intervention_prob(ancestor_idx, true)?;
        let prob_false = compute_intervention_prob(ancestor_idx, false)?;

        let sensitivity = prob_true - prob_false;
        sensitivities.insert(node.id, sensitivity);
    }

    serde_wasm_bindgen::to_value(&sensitivities)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {e}")))
}

fn get_ancestors(nodes: &[Node], target_node_id: &str) -> HashSet<String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    // Build parent cache
    let mut parent_map: HashMap<&str, HashSet<&str>> = HashMap::new();
    for node in nodes {
        let mut parents = HashSet::new();
        for entry in &node.cpt_entries {
            for parent_id in entry.parent_states.keys() {
                parents.insert(parent_id.as_str());
            }
        }
        parent_map.insert(node.id.as_str(), parents);
    }

    // BFS to find ancestors
    let mut ancestors = HashSet::new();
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();

    queue.push_back(target_node_id);
    visited.insert(target_node_id);

    while let Some(current_id) = queue.pop_front() {
        if let Some(parents) = parent_map.get(current_id) {
            for &parent_id in parents {
                if visited.insert(parent_id) {
                    ancestors.insert(parent_id.into());
                    queue.push_back(parent_id);
                }
            }
        }
    }

    ancestors
}
