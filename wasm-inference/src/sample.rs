use anyhow::anyhow;
use rand::Rng;
use rand_xoshiro::Xoshiro128Plus;
use winnow::{
    Parser,
    binary::{le_f32, le_u8, length_take},
    combinator::seq,
    token::take,
};

use crate::bit_set::BitSet;

pub(crate) fn sample(
    mut serialized_network: &[u8],
    num_nodes: u8,
    intervention: Option<Intervention>,
    rng: &mut Xoshiro128Plus,
) -> anyhow::Result<BitSet> {
    let mut samples = BitSet::new();
    if let Some(Intervention { value, on_node }) = intervention
        && value
    {
        samples.insert(on_node);
    }
    for node in 0..num_nodes {
        let probability = process_node(&samples, &mut serialized_network)
            .map_err(anyhow::Error::msg)?
            .ok_or_else(|| anyhow!("Node without a matching CPT Entry"))?;
        if let Some(Intervention { value: _, on_node }) = intervention
            && on_node == node
        {
            continue;
        }
        if rng.random_bool(f64::from(probability)) {
            samples.insert(node);
        }
    }
    debug_assert!(serialized_network.is_empty());
    Ok(samples)
}

#[derive(Clone, Copy)]
pub(crate) struct Intervention {
    pub(crate) value: bool,
    pub(crate) on_node: u8,
}

fn process_node(samples: &BitSet, input: &mut &[u8]) -> winnow::Result<Option<f32>> {
    let parents = length_take(le_u8).parse_next(input)?;
    let parent_states = parents.iter().map(|&p| samples.contains(p));
    let num_cpt_entries = le_u8.parse_next(input)?;
    let mut probability = None;
    for _ in 0..num_cpt_entries {
        let entry = cpt_entry(parents.len()).parse_next(input)?;
        if probability.is_none() && entry.matches(parent_states.clone()) {
            probability = Some(entry.probability);
        }
    }
    Ok(probability)
}

struct CPTEntry<'a> {
    parent_pattern: &'a [u8],
    probability: f32,
}

impl CPTEntry<'_> {
    fn matches(&self, mut parent_states: impl Iterator<Item = bool>) -> bool {
        self.parent_pattern.iter().all(|pattern_shard| {
            let state_shard =
                parent_states
                    .by_ref()
                    .take(4)
                    .enumerate()
                    .fold(
                        0u8,
                        |acc, (i, state)| {
                            if state { acc | (1 << i) } else { acc }
                        },
                    );
            let mask = pattern_shard >> 4;
            (state_shard & mask) == (pattern_shard & mask)
        })
    }
}

fn cpt_entry<'a>(
    num_parents: usize,
) -> impl Parser<&'a [u8], CPTEntry<'a>, winnow::error::ContextError> {
    let parent_pattern_bytes = num_parents.div_ceil(4);
    seq! { CPTEntry {
        parent_pattern: take(parent_pattern_bytes),
        probability: le_f32
    }}
}
