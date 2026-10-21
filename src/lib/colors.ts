// Chart colours: a fixed categorical order (validated for colour-vision deficiency on all four
// themes, as in DevTime), given to the range's top artists by rank. Everything else is neutral.

export const CATEGORICAL_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const CATEGORICAL_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const OTHER_COLOR = "var(--text-faint)";

/** id → colour for the given ids, in order; the rest are "Other". */
export function palette(ids: string[], dark: boolean): Map<string, string> {
  const p = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  return new Map(ids.slice(0, p.length).map((id, i) => [id, p[i]]));
}
