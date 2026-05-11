import * as Y from "yjs";
import {
  slateNodesToInsertDelta,
  yTextToSlateElement,
} from "@slate-yjs/core";
import type { PlateValue } from "./yjs-to-plate";

export const PLATE_YJS_ROOT_KEY = "content";
type SharedRoot = Y.XmlText | Y.XmlFragment;

function emptyPlateValue(): PlateValue {
  return [{ type: "p", children: [{ text: "" }] }];
}

function getSharedRoot(doc: Y.Doc): SharedRoot {
  try {
    return doc.get(PLATE_YJS_ROOT_KEY, Y.XmlText) as Y.XmlText;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("different constructor")
    ) {
      return doc.getXmlFragment(PLATE_YJS_ROOT_KEY);
    }
    throw err;
  }
}

function getEditableSharedRoot(doc: Y.Doc): Y.XmlText {
  const sharedRoot = getSharedRoot(doc);
  if (sharedRoot instanceof Y.XmlText) {
    return sharedRoot;
  }
  return doc.get(PLATE_YJS_ROOT_KEY, Y.XmlText) as Y.XmlText;
}

function xmlTextToTextNode(text: Y.XmlText): { text: string } {
  return { text: text.toString() };
}

function xmlElementToPlateNode(element: Y.XmlElement): Record<string, unknown> {
  const children = element
    .toArray()
    .flatMap((child): Array<Record<string, unknown>> => {
      if (child instanceof Y.XmlText) {
        return [xmlTextToTextNode(child)];
      }
      if (child instanceof Y.XmlElement) {
        return [xmlElementToPlateNode(child)];
      }
      return [];
    });

  return {
    type: element.nodeName || "p",
    children: children.length > 0 ? children : [{ text: "" }],
  };
}

function xmlFragmentToPlateValue(fragment: Y.XmlFragment): PlateValue {
  const children = fragment
    .toArray()
    .flatMap((child): Array<Record<string, unknown>> => {
      if (child instanceof Y.XmlElement) {
        return [xmlElementToPlateNode(child)];
      }
      if (child instanceof Y.XmlText) {
        return [{ type: "p", children: [xmlTextToTextNode(child)] }];
      }
      return [];
    });

  return children.length > 0 ? (children as PlateValue) : emptyPlateValue();
}

function legacyXmlTextToPlateValue(text: Y.XmlText): PlateValue {
  const plainText = text.toString().replace(/<[^>]*>/g, "");
  return [{ type: "p", children: [{ text: plainText }] }];
}

export function yDocToPlateValue(doc: Y.Doc): PlateValue {
  const sharedRoot = getSharedRoot(doc);
  if (sharedRoot instanceof Y.XmlFragment) {
    return xmlFragmentToPlateValue(sharedRoot);
  }
  if (!(sharedRoot instanceof Y.XmlText)) {
    return emptyPlateValue();
  }
  if (sharedRoot.length === 0) {
    return emptyPlateValue();
  }
  let slateRoot: { children?: unknown[] };
  try {
    slateRoot = yTextToSlateElement(sharedRoot) as { children?: unknown[] };
  } catch (err) {
    if (err instanceof TypeError && err.message.includes("toDelta")) {
      return legacyXmlTextToPlateValue(sharedRoot);
    }
    throw err;
  }
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
  const sharedRoot = getEditableSharedRoot(doc);

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
