export type PlateValue = Array<Record<string, unknown>>;
export { yjsStateToPlateValue } from "./yjs-plate-transform";

// Empty paragraph keeps Plate happy (it requires at least one block child).
const EMPTY_PLATE: PlateValue = [{ type: "p", children: [{ text: "" }] }];

export function fallbackPlateValue(content: unknown): PlateValue {
  if (Array.isArray(content) && content.length > 0) {
    return content as PlateValue;
  }
  return EMPTY_PLATE;
}
