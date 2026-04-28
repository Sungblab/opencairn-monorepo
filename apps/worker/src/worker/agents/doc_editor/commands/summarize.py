from worker.agents.doc_editor.commands.spec import CommandSpec

SUMMARIZE_SYSTEM = """You are a concise summarizer. Replace the user's
selection with a faithful summary in the same language as the source. Aim
for 30-50% of the original length. Preserve any citation markers like
[^1]. Do not introduce facts not in the original.

Return JSON only with one hunk that replaces the selection. summary should
read e.g. 'Summarized 4 paragraphs to 2'."""

SPEC = CommandSpec(name="summarize", system_prompt=SUMMARIZE_SYSTEM, output_mode="diff")
