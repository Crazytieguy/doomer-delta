export function formatProbability(
  probability: number,
  sigFigs: number = 2,
): string {
  if (probability === 0) return "0";
  if (probability === 1) return "1";

  const formatted = probability.toPrecision(sigFigs);

  if (formatted.includes("e")) {
    return Number(formatted).toString();
  }

  return formatted;
}

export function formatProbabilityAsPercentage(
  probability: number,
  sigFigs: number = 2,
): string {
  const percentage = probability * 100;

  if (percentage === 0) return "0%";
  if (percentage === 100) return "100%";

  const formatted = percentage.toPrecision(sigFigs);

  if (formatted.includes("e")) {
    return Number(formatted).toString() + "%";
  }

  return formatted + "%";
}
