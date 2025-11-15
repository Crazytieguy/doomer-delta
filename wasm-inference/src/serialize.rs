use anyhow::{Result, anyhow, bail};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::{CptEntry, Node};

pub struct SerializedNetwork {
    pub data: Vec<u8>,
    pub topo_order: Vec<String>,
}

pub fn serialize_network(nodes: &[Node]) -> Result<SerializedNetwork> {
    if nodes.len() > 255 {
        bail!(
            "Network has {len} nodes, maximum 255 supported",
            len = nodes.len()
        );
    }

    let nodes_by_id: HashMap<&str, &Node> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    if nodes_by_id.len() != nodes.len() {
        bail!("Duplicate node IDs detected");
    }

    let parents_cache: HashMap<&str, Vec<&str>> = nodes
        .iter()
        .map(|n| (n.id.as_str(), get_node_parents(n)))
        .collect();

    for node in nodes {
        let parents = parents_cache
            .get(node.id.as_str())
            .ok_or_else(|| anyhow!("Parents for node {} not found in cache", node.id))?;

        for parent_id in parents {
            if !nodes_by_id.contains_key(parent_id) {
                bail!(
                    "Node {child} references parent {parent} which is not in the node array",
                    child = node.id,
                    parent = parent_id
                );
            }
        }
    }

    let topo_order = topological_sort(nodes, &parents_cache)?;

    let id_to_topo_index: HashMap<&str, u8> = topo_order
        .iter()
        .enumerate()
        .map(|(idx, node_id)| {
            let idx_u8 = u8::try_from(idx).expect("Topo index exceeds u8::MAX");
            (node_id.as_str(), idx_u8)
        })
        .collect();

    let mut buffer = Vec::new();

    for node_id in &topo_order {
        let node = nodes_by_id
            .get(node_id.as_str())
            .ok_or_else(|| anyhow!("Node {node_id} not found"))?;

        let parents = parents_cache
            .get(node_id.as_str())
            .ok_or_else(|| anyhow!("Parents for node {node_id} not found in cache"))?;

        serialize_node(node, parents, &id_to_topo_index, &mut buffer)?;
    }

    Ok(SerializedNetwork {
        data: buffer,
        topo_order,
    })
}

fn topological_sort(
    nodes: &[Node],
    parents_cache: &HashMap<&str, Vec<&str>>,
) -> Result<Vec<String>> {
    let mut graph: HashMap<&str, HashSet<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> = HashMap::new();

    for node in nodes {
        in_degree.entry(node.id.as_str()).or_insert(0);

        let parents = parents_cache
            .get(node.id.as_str())
            .ok_or_else(|| anyhow!("Parents for node {id} not found in cache", id = node.id))?;

        for &parent_id in parents {
            graph.entry(parent_id).or_default().insert(node.id.as_str());
            *in_degree.entry(node.id.as_str()).or_insert(0) += 1;
            in_degree.entry(parent_id).or_insert(0);
        }
    }

    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|&(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut result = Vec::new();

    while let Some(node_id) = queue.pop_front() {
        result.push(node_id.to_string());

        if let Some(children) = graph.get(node_id) {
            for &child_id in children {
                let deg = in_degree.get_mut(child_id).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(child_id);
                }
            }
        }
    }

    if result.len() < nodes.len() {
        bail!("Cycle detected in Bayesian network");
    }

    if result.len() > nodes.len() {
        bail!("Network references undefined parent nodes");
    }

    Ok(result)
}

fn get_node_parents(node: &Node) -> Vec<&str> {
    let mut all_parents = HashSet::new();

    for entry in &node.cpt_entries {
        for parent_id in entry.parent_states.keys() {
            all_parents.insert(parent_id.as_str());
        }
    }

    all_parents.into_iter().collect()
}

fn serialize_node(
    node: &Node,
    parent_ids: &[&str],
    id_to_topo_index: &HashMap<&str, u8>,
    buffer: &mut Vec<u8>,
) -> Result<()> {
    let parent_index_pairs: Vec<(&str, u8)> = parent_ids
        .iter()
        .map(|&id| {
            id_to_topo_index
                .get(id)
                .copied()
                .map(|idx| (id, idx))
                .ok_or_else(|| anyhow!("Parent node {id} not found in topology"))
        })
        .collect::<Result<Vec<_>>>()?;

    let mut sorted_pairs = parent_index_pairs;
    sorted_pairs.sort_unstable_by_key(|(_, idx)| *idx);

    let parent_indices: Vec<u8> = sorted_pairs.iter().map(|(_, idx)| *idx).collect();
    let sorted_parent_ids: Vec<&str> = sorted_pairs.iter().map(|(id, _)| *id).collect();

    let num_parents = u8::try_from(parent_indices.len())
        .map_err(|_| anyhow!("Number of parents exceeds u8::MAX"))?;
    buffer.push(num_parents);
    buffer.extend_from_slice(&parent_indices);

    let num_cpt_entries = u8::try_from(node.cpt_entries.len())
        .map_err(|_| anyhow!("Number of CPT entries exceeds u8::MAX"))?;
    buffer.push(num_cpt_entries);

    for entry in &node.cpt_entries {
        serialize_cpt_entry(entry, &sorted_parent_ids, buffer);
    }

    Ok(())
}

fn serialize_cpt_entry(entry: &CptEntry, parent_ids: &[&str], buffer: &mut Vec<u8>) {
    let num_pattern_bytes = parent_ids.len().div_ceil(4);
    let mut pattern_bytes = vec![0u8; num_pattern_bytes];

    for (local_idx, &parent_id) in parent_ids.iter().enumerate() {
        let byte_idx = local_idx / 4;
        let bit_offset =
            u8::try_from(local_idx % 4).expect("local_idx % 4 is always < 4, fits in u8");

        match entry.parent_states.get(parent_id) {
            Some(Some(true)) => {
                pattern_bytes[byte_idx] |= 1 << (bit_offset + 4);
                pattern_bytes[byte_idx] |= 1 << bit_offset;
            }
            Some(Some(false)) => {
                pattern_bytes[byte_idx] |= 1 << (bit_offset + 4);
            }
            Some(None) | None => {}
        }
    }

    buffer.extend_from_slice(&pattern_bytes);
    buffer.extend_from_slice(&entry.probability.to_le_bytes());
}
