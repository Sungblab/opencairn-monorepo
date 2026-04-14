Agents are systems that leverage Gemini models, a set of tools, and reasoning
capabilities to perform complex, multi-step tasks and achieve specific goals.
Unlike a single model call, an agent can plan, execute a series of actions,
interact with external systems, and synthesize information to fulfill a user's
request.

With the Gemini API, you can build powerful agents by utilizing features like:

- **[Gemini models](https://ai.google.dev/gemini-api/docs/models):** The core intelligence, providing reasoning and language understanding.
- **[Tools](https://ai.google.dev/gemini-api/docs/tools):** Capabilities that connect the model to real-world information and actions. These can be built-in tools (like Google Search, Maps, Code Execution) or custom tools.
- **[Function calling](https://ai.google.dev/gemini-api/docs/function-calling):** The mechanism to define and connect your own custom tools and APIs to the Gemini model.
- **[Thinking](https://ai.google.dev/gemini-api/docs/thinking):** Features that enhance the model's ability to reason and plan for complex tasks.
- **[Long context](https://ai.google.dev/gemini-api/docs/long-context):** Enabling agents to maintain state and information over extended interactions.

## Available Agents

- **[Deep Research Agent](https://ai.google.dev/gemini-api/docs/deep-research):** An autonomous agent that plans, executes, and synthesizes multi-step research tasks for use cases like market analysis, due diligence, and literature reviews.

## Building agents

Agents use models and tools to complete multi-step tasks. While Gemini provides
the reasoning capabilities (the "brain") and the essential tools (the "hands"),
you often need an orchestration framework to manage the agent's memory, plan
loops, and perform complex tool chaining.

To maximize reliability in multi-step workflows, you should craft instructions
that explicitly control how the model reasons and plans. While Gemini provides
strong general reasoning, complex agents benefit from prompts that enforce
specific behaviors like persistence in the face of issues, risk assessment, and
proactive planning.

See the [Agentic
workflows](https://ai.google.dev/gemini-api/docs/prompting-strategies#agentic-workflows) for
strategies on designing these prompts. Here is an example of a [system
instruction](https://ai.google.dev/gemini-api/docs/prompting-strategies#agentic-si-template) that
improved performance on several agentic benchmarks by around 5%.

## Agent frameworks

Gemini integrates with leading open-source agent frameworks such as:

- [**LangChain / LangGraph**](https://ai.google.dev/gemini-api/docs/langgraph-example): Build stateful, complex application flows and multi-agent systems using graph structures.
- [**LlamaIndex**](https://ai.google.dev/gemini-api/docs/llama-index): Connect Gemini agents to your private data for RAG-enhanced workflows.
- [**CrewAI**](https://ai.google.dev/gemini-api/docs/crewai-example): Orchestrate collaborative, role-playing autonomous AI agents.
- [**Vercel AI SDK**](https://ai.google.dev/gemini-api/docs/vercel-ai-sdk-example): Build AI-powered user interfaces and agents in JavaScript/TypeScript.
- [**Google ADK**](https://google.github.io/adk-docs/get-started/python/): An open-source framework for building and orchestrating interoperable AI agents.
