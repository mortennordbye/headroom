/**
 * Property value estimate from an SSB square-metre price.
 * estimatedValue = sizeSqm × price/m² (kommune average for the dwelling type).
 * Guards every input so a missing size or price yields null, never NaN.
 */
export function estimatedPropertyValue(
  sizeSqm: number | undefined | null,
  pricePerSqm: number | null | undefined,
): number | null {
  if (!sizeSqm || sizeSqm <= 0) return null;
  if (pricePerSqm == null || !(pricePerSqm > 0)) return null;
  return Math.round(sizeSqm * pricePerSqm);
}
