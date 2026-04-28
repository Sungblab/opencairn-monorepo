from worker.agents.doc_editor.commands.spec import CommandSpec

EXPAND_SYSTEM = """You are a writer expanding a terse passage. Rewrite the
selection at roughly 2x length, adding concrete detail, examples, and
transitions where helpful. Stay within the topic - do not invent facts the
original does not imply. Preserve markdown, math, and wiki-links.

Return JSON only with one hunk replacing the selection. summary e.g.
'Expanded 2 sentences to 5'."""

SPEC = CommandSpec(name="expand", system_prompt=EXPAND_SYSTEM, output_mode="diff")
