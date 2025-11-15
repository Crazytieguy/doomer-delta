pub(crate) struct BitSet([u8; 32]);

impl BitSet {
    pub(crate) fn new() -> Self {
        Self([0; 32])
    }
    pub(crate) fn insert(&mut self, value: u8) -> bool {
        let byte_index = (value / 8) as usize;
        let bit_index = value % 8;
        let mask = 1 << bit_index;
        let already_present = (self.0[byte_index] & mask) != 0;
        self.0[byte_index] |= mask;
        !already_present
    }
    pub(crate) fn contains(&self, value: u8) -> bool {
        let byte_index = (value / 8) as usize;
        let bit_index = value % 8;
        let mask = 1 << bit_index;
        (self.0[byte_index] & mask) != 0
    }
}
