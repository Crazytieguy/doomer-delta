use rand::SeedableRng;
use rand_xoshiro::Xoshiro128Plus;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

mod bit_set;
mod sample;
mod serialize;

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterventionResult {
    pub true_case: HashMap<String, f64>,
    pub false_case: HashMap<String, f64>,
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
pub fn compute_marginals(
    nodes: JsValue,
    num_samples: usize,
    intervention_node_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let nodes: Vec<Node> = serde_wasm_bindgen::from_value(nodes)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize nodes: {e}")))?;

    let serialized = serialize::serialize_network(&nodes)
        .map_err(|e| JsValue::from_str(&format!("Serialization failed: {e}")))?;

    let mut seed = [0u8; 16];
    getrandom::fill(&mut seed).map_err(|e| JsValue::from_str(&format!("RNG seed failed: {e}")))?;
    let mut rng = Xoshiro128Plus::from_seed(seed);

    let num_nodes = u8::try_from(serialized.topo_order.len())
        .map_err(|_| JsValue::from_str("Too many nodes for u8"))?;

    // If no intervention, compute baseline marginals
    if intervention_node_id.is_none() {
        let mut node_true_counts = vec![0usize; usize::from(num_nodes)];

        for _ in 0..num_samples {
            let sample_result = sample::sample(&serialized.data, num_nodes, None, &mut rng)
                .map_err(|e| JsValue::from_str(&format!("Sampling failed: {e}")))?;

            for node_idx in 0..num_nodes {
                if sample_result.contains(node_idx) {
                    node_true_counts[usize::from(node_idx)] += 1;
                }
            }
        }

        #[allow(clippy::cast_precision_loss)]
        let probabilities: HashMap<String, f64> = serialized
            .topo_order
            .into_iter()
            .zip(node_true_counts)
            .map(|(node_id, count)| {
                let probability = count as f64 / num_samples as f64;
                (node_id, probability)
            })
            .collect();

        return serde_wasm_bindgen::to_value(&probabilities)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {e}")));
    }

    // Intervention case: compute both do(node=true) and do(node=false)
    let intervention_node_id = intervention_node_id.unwrap();
    let intervention_idx = u8::try_from(
        serialized
            .topo_order
            .iter()
            .position(|id| id == &intervention_node_id)
            .ok_or_else(|| {
                JsValue::from_str(&format!("Intervention node {intervention_node_id} not found"))
            })?,
    )
    .map_err(|_| JsValue::from_str("Intervention index exceeds u8::MAX"))?;

    let mut compute_marginals_with_intervention =
        |intervention_value: bool| -> Result<HashMap<String, f64>, JsValue> {
            let mut node_true_counts = vec![0usize; usize::from(num_nodes)];

            for _ in 0..num_samples {
                let sample_result = sample::sample(
                    &serialized.data,
                    num_nodes,
                    Some(sample::Intervention {
                        on_node: intervention_idx,
                        value: intervention_value,
                    }),
                    &mut rng,
                )
                .map_err(|e| JsValue::from_str(&format!("Sampling failed: {e}")))?;

                for node_idx in 0..num_nodes {
                    if sample_result.contains(node_idx) {
                        node_true_counts[usize::from(node_idx)] += 1;
                    }
                }
            }

            #[allow(clippy::cast_precision_loss)]
            let probabilities: HashMap<String, f64> = serialized
                .topo_order
                .iter()
                .cloned()
                .zip(node_true_counts)
                .map(|(node_id, count)| {
                    let probability = count as f64 / num_samples as f64;
                    (node_id, probability)
                })
                .collect();

            Ok(probabilities)
        };

    let true_case = compute_marginals_with_intervention(true)?;
    let false_case = compute_marginals_with_intervention(false)?;

    let result = InterventionResult {
        true_case,
        false_case,
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {e}")))
}

