import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createDb, eq, noteVersions } from "@opencairn/db";

import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "../../api/tests/helpers/seed.js";
import { makePersistence } from "../src/persistence.js";
import { PLATE_BRIDGE_ROOT_KEY } from "../src/plate-bridge.js";

const db = createDb(process.env.DATABASE_URL!);
const persistence = makePersistence({ db });

describe("persistence note version capture", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("creates an automatic version when storing a changed Plate note", async () => {
    await persistence.fetch({ documentName: `page:${seed.noteId}` });
    const doc = new Y.Doc();
    const root = doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText;
    root.insert(0, "hello version history");

    await persistence.store({
      documentName: `page:${seed.noteId}`,
      state: Y.encodeStateAsUpdate(doc),
    });

    const rows = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("auto_save");
    expect(rows[0]?.actorType).toBe("system");
  });

  it("does not create duplicate versions for identical state", async () => {
    const doc = new Y.Doc();
    const root = doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText;
    root.insert(0, "same");
    const state = Y.encodeStateAsUpdate(doc);

    await persistence.store({ documentName: `page:${seed.noteId}`, state });
    await persistence.store({ documentName: `page:${seed.noteId}`, state });

    const rows = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(1);
  });
});
