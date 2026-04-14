Tools extend the capabilities of Gemini models, enabling them to take action in
the world, access real-time information, and perform complex computational
tasks. Models can use tools in both standard request-response interactions and
real-time streaming sessions using the [Live API](https://ai.google.dev/gemini-api/docs/live-tools).

Tools are specific capabilities (like Google Search or Code Execution) that a
model can use to answer queries. The Gemini API provides a suite of fully
managed, built-in tools, or you can define custom tools using [Function
Calling](https://ai.google.dev/gemini-api/docs/function-calling).

To build multi-step, goal-oriented systems, see the [Agents
Overview](https://ai.google.dev/gemini-api/docs/agents).

## Available built-in tools

| Tool                                                                         | Description                                                                                                   | Use Cases                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Google Search](https://ai.google.dev/gemini-api/docs/google-search)         | Ground responses in current events and facts from the web to reduce hallucinations.                           | \\- Answering questions about recent events \\- Verifying facts with diverse sources                              |
| [Google Maps](https://ai.google.dev/gemini-api/docs/maps-grounding)          | Build location-aware assistants that can find places, get directions, and provide rich local context.         | \\- Planning travel itineraries with multiple stops \\- Finding local businesses based on user criteria           |
| [Code Execution](https://ai.google.dev/gemini-api/docs/code-execution)       | Allow the model to write and run Python code to solve math problems or process data accurately.               | \\- Solving complex mathematical equations \\- Processing and analyzing text data precisely                       |
| [URL Context](https://ai.google.dev/gemini-api/docs/url-context)             | Direct the model to read and analyze content from specific web pages or documents.                            | \\- Answering questions based on specific URLs or documents \\- Retrieving information across different web pages |
| [Computer Use (Preview)](https://ai.google.dev/gemini-api/docs/computer-use) | Enable Gemini to view a screen and generate actions to interact with web browser UIs (Client-side execution). | \\- Automating repetitive web-based workflows \\- Testing web application user interfaces                         |
| [File Search](https://ai.google.dev/gemini-api/docs/file-search)             | Index and search your own documents to enable Retrieval Augmented Generation (RAG).                           | \\- Searching technical manuals \\- Question answering over proprietary data                                      |

See the [Pricing page](https://ai.google.dev/gemini-api/docs/pricing#pricing_for_tools) for details
on costs associated with specific tools.

## How tools execution works

Tools allow the model to request actions during a conversation. The flow differs
depending on whether the tool is built-in (managed by Google) or custom (managed
by you).

### Built-in tool flow

For built-in tools (Google Search, Google Maps, URL Context, File Search,
Code Execution), the entire process happens within one API call:

1. **You** send a prompt: "What is the square root of the latest stock price of GOOG?"
2. **Gemini** decides it needs tools and executes them on Google's servers (e.g., searches for the stock price, then runs Python code to calculate the square root).
3. **Gemini** sends back the final answer grounded in the tool results.

### Custom tool flow (Function calling)

For custom tools and Computer Use, your application handles the execution:

1. **You** send a prompt along with functions (tools) declarations.
2. **Gemini** might send back structured JSON to call a specific function (for example, `{"name": "get_order_status", "args": {"order_id": "123"}}`), always with a unique `id`.
3. **You** execute the function in your application or environment.
4. **You** send the function results, with the same `id` as the function call, back to Gemini.
5. **Gemini** uses the results to generate a final response or another tool call.

> [!WARNING]
> **Preview:** For those building with a mix of bash and custom tools, Gemini 3.1 Pro Preview comes with a separate endpoint available via the API called [`gemini-3.1-pro-preview-customtools`](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview#gemini-31-pro-preview-customtools).

Learn more in the [Function calling guide](https://ai.google.dev/gemini-api/docs/function-calling).

### Combining built-in and custom tools flow

> [!WARNING]
> **Preview:** Gemini 3 series models support the option to combine built-in tools with custom tools in a single turn.

For requests that combine built-in tools and custom tools (function calls), the
model uses [tool context circulation](https://ai.google.dev/gemini-api/docs/toold-combination) to
coordinate execution across different environments:

1. **You** send a prompt and declare the built-in tools and custom functions you want to enable, setting a flag to turn on combination support.
2. **Gemini** executes built-in tools and yields to the user if any client-side function calls are generated (which executes first depends on the prompt and what the model decides). It sends back a response with:
   - Confirmation of the tool call
   - Results of the tool response (this may come after the JSON if the model generated two parallel function calls)
   - Structured JSON to call your function
   - Encrypted thought signatures to preserve context
3. **You** execute the function in your application or environment.
4. **You** return all parts of Gemini's response, plus your function call results.
5. **Gemini** generates the final response using all combined context.

Read the [Tool combination guide](https://ai.google.dev/gemini-api/docs/tool-combination) to learn
how to turn on support for built-in and custom tools combination and examples of
context circulation.

## Structured outputs vs. function calling

Gemini offers two methods for generating structured outputs. Use [Function
calling](https://ai.google.dev/gemini-api/docs/function-calling) when the model needs to perform an
intermediate step by connecting to your own tools or data systems. Use
[Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output) when you strictly need
the model's final response to adhere to a specific schema, such as for rendering
a custom UI.

## Structured outputs with tools

> [!WARNING]
> **Preview:** This feature is only available only to Gemini 3 series models.

You can combine [Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output) with
built-in tools to ensure that model responses grounded in external data or
computation still adhere to a strict schema.

See [Structured outputs with tools](https://ai.google.dev/gemini-api/docs/structured-output?example=recipe#structured_outputs_with_tools)
for code examples.
