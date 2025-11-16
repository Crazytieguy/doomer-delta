interface CPTEntry {
  parentStates: Record<string, boolean | null>;
  probability: number;
}

interface NodeWithCPT {
  _id: string;
  cptEntries: CPTEntry[];
}

export function computeProbabilisticFingerprint(nodes: NodeWithCPT[]): string {
  return nodes
    .slice()
    .sort((a, b) => a._id.localeCompare(b._id))
    .map((node) => {
      const entriesStr = node.cptEntries
        .map((entry) => {
          const parentsStr = Object.keys(entry.parentStates)
            .sort()
            .map((pid) => `${pid}:${entry.parentStates[pid]}`)
            .join(",");
          return `${parentsStr}|${entry.probability}`;
        })
        .join(";");
      return `${node._id}:${entriesStr}`;
    })
    .join("|");
}
