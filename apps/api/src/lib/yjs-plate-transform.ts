import * as Y from "yjs";
import {
  slateNodesToInsertDelta,
  yTextToSlateElement,
} from "@slate-yjs/core";
import type { PlateValue } from "./yjs-to-plate";

export const PLATE_YJS_ROOT_KEY = "content";

function emptyPlateValue(): PlateValue {
  return [{ type: "p", children: [{ text: "" }] }];
}

function getSharedRoot(doc: Y.Doc): Y.XmlText {
  return doc.get(PLATE_YJS_ROOT_KEY, Y.XmlText) as Y.XmlText;
}

export function yDocToPlateValue(doc: Y.Doc): PlateValue {
  const sharedRoot = getSharedRoot(doc);
  if (sharedRoot.length === 0) {
    return emptyPlateValue();
  }
  const slateRoot = yTextToSlateElement(sharedRoot) as { children?: unknown[] };
  const children = slateRoot?.children;
  if (!Array.isArray(children) || children.length === 0) {
    return emptyPlateValue();
  }
  return children as PlateValue;
}

export function yjsStateToPlateValue(state: Uint8Array): PlateValue {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return yDocToPlateValue(doc);
}

export function transformYjsStateWithPlateValue(input: {
  currentState: Uint8Array;
  draft: PlateValue;
}): {
  state: Uint8Array;
  stateVector: Uint8Array;
  plateValue: PlateValue;
} {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, input.currentState);
  const sharedRoot = getSharedRoot(doc);

  doc.transact(() => {
    if (sharedRoot.length > 0) {
      sharedRoot.delete(0, sharedRoot.length);
    }
    const insertDelta = slateNodesToInsertDelta(
      input.draft as unknown as Parameters<typeof slateNodesToInsertDelta>[0],
    );
    sharedRoot.applyDelta(insertDelta);
  }, "agentic-note-update.apply");

  return {
    state: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
    plateValue: yDocToPlateValue(doc),
  };
}
