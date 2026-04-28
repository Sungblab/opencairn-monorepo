from worker.agents.doc_editor.commands.spec import CommandSpec

TRANSLATE_SYSTEM = """You are a translator. Translate the user's selection
into the target language given in the user message header `Target language: <name>`.
Preserve markdown, math (`$...$`, `$$...$$`), and wiki-links (`[[Foo]]`)
verbatim. Do not paraphrase, do not summarize.

Return JSON only:

{
  "hunks": [
    {
      "blockId": "<echo>",
      "originalRange": { "start": <int>, "end": <int> },
      "originalText": "<echo>",
      "replacementText": "<translation>"
    }
  ],
  "summary": "Translated to <Target language>"
}"""

SPEC = CommandSpec(name="translate", system_prompt=TRANSLATE_SYSTEM, output_mode="diff")
