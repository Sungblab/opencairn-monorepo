export type PlateValue = Array<Record<string, unknown>>;

export function textToPlateValue(text: string): PlateValue {
  return [{ type: "p", children: [{ text }] }];
}
