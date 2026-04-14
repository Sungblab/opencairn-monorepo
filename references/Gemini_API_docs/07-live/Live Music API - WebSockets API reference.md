<br />

> [!WARNING]
> **Preview:** The Live Music API is in preview.

Lyria RealTime music generation uses a persistent, bidirectional,
low-latency streaming connection using
[WebSockets](https://en.wikipedia.org/wiki/WebSocket). In this section, you'll
find additional details regarding the WebSockets API.

## Sessions

A WebSocket connection establishes a session to keep a real-time communication
with the model. After a client initiates a new connection the session can
exchange messages with the server to:

- Send prompts and controls to steer music generation.
- Send music playback controls.
- Receive audio chunks.

### WebSocket connection

To start a session, connect to this websocket endpoint:

    wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic

> [!NOTE]
> **Note:** The URL is for version `v1alpha`.

### Session configuration

The initial message after connection sets the model to use during the session.

See the following example configuration. Note that the name casing in SDKs may
vary. You can look up the
[Python SDK configuration options here](https://github.com/googleapis/python-genai/blob/main/google/genai/live_music.py).

    {
      "model": string
    }

## Send messages

To exchange messages over the WebSocket connection, the client must send a JSON
object over an open WebSocket connection. The JSON object must have **exactly
one** of the fields from the following object set:

    {
      "setup": BidiGenerateMusicSetup,
      "client_content": BidiGenerateMusicClientContent,
      "music_generation_config": BidiGenerateMusicGenerationConfig,
      "playback_control": BidiGenerateMusicPlaybackControl
    }

### Supported client messages

See the supported client messages in the following table:

| Message                             | Description                                                |
| ----------------------------------- | ---------------------------------------------------------- |
| `BidiGenerateMusicSetup`            | Session configuration to be sent only in the first message |
| `BidiGenerateMusicClientContent`    | Weighted prompts as the model input                        |
| `BidiGenerateMusicGenerationConfig` | Configuration for music generation                         |
| `BidiGenerateMusicPlaybackControl`  | Playback control signals for model generation              |

## Receive messages

To receive messages from the server, listen for the WebSocket 'message' event,
and then parse the result according to the definition of the supported server
messages.

See the following:

    async def receive_audio(session):
      """Example background task to process incoming audio."""
      while True:
        async for message in session.receive():
          audio_data = message.server_content.audio_chunks[0].data
          # Process audio...
          await asyncio.sleep(10**-12)

    async with (
      client.aio.live.music.connect(model='models/lyria-realtime-exp') as session,
      asyncio.TaskGroup() as tg,
    ):
      # Set up task to receive server messages.
      tg.create_task(receive_audio(session))

      # Send initial prompts and config
      await session.set_weighted_prompts(
        prompts=[
          types.WeightedPrompt(text='minimal techno', weight=1.0),
        ]
      )
      await session.set_music_generation_config(
        config=types.LiveMusicGenerationConfig(bpm=90, temperature=1.0)
      )

      # Start streaming music
      await session.play()

Server messages include **exactly one** of the other fields from the
[`BidiGenerateMusicServerMessage`](https://ai.google.dev/api/live_music#BidiGenerateMusicServerMessage) message.
(The `messageType` union is not expressed in JSON so the field will appear at
the top-level of the message.)

## Messages and events

### AudioChunk

Representation of an audio chunk.

| Fields                                                             |                                                                                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Union field `content`. `content` can be only one of the following: |                                                                                                                                        |
| `data`                                                             | `bytes` Raw bytes of the audio chunk.                                                                                                  |
| `mimeType`                                                         | `string` The MIME type of the content of the audio chunk, such as "audio/wav".                                                         |
| `sourceMetadata`                                                   | `https://ai.google.dev/api/live_music#AudioChunk.SourceMetadata` Output only. Prompts and config used for generating this audio chunk. |

### SourceMetadata

Metadata about the input source used for generating this audio chunk.

| Fields                  |                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `clientContent`         | `https://ai.google.dev/api/live_music#BidiGenerateMusicClientContent` Weighted prompts for generating this audio chunk.           |
| `musicGenerationConfig` | `https://ai.google.dev/api/live_music#BidiGenerateMusicGenerationConfig` Music generation config for generating this audio chunk. |

### BidiGenerateMusicClientContent

User input to start or steer the music.

| Fields              |                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `weightedPrompts[]` | `https://ai.google.dev/api/live_music#WeightedPrompt` Required. Weighted prompts as the model input. |

### BidiGenerateMusicClientMessage

Messages sent by the client in the BidiGenerateMusic call.

| Fields                                                                     |                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Union field `messageType`. `messageType` can be only one of the following: |                                                                                                                                                                 |
| `setup`                                                                    | `https://ai.google.dev/api/live_music#BidiGenerateMusicSetup` Optional. Session configuration sent only in the first client message.                            |
| `clientContent`                                                            | `https://ai.google.dev/api/live_music#BidiGenerateMusicClientContent` Optional. Weighted prompts and music generation configs as the input of music generation. |
| `musicGenerationConfig`                                                    | `https://ai.google.dev/api/live_music#BidiGenerateMusicGenerationConfig` Optional. Configuration for music generation.                                          |
| `playbackControl`                                                          | `https://ai.google.dev/api/live_music#BidiGenerateMusicPlaybackControl` Optional. Playback control signal for the music generation.                             |

### BidiGenerateMusicFilteredPrompt

Filtered prompt with reason.

| Fields                                                                                         |                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `filteredReason`                                                                               | `string` Output only. The reason why the prompt was filtered. |
| Union field `prompt`. The prompt that was filtered. `prompt` can be only one of the following: |                                                               |
| `text`                                                                                         | `string` Optional. Text prompt.                               |

### BidiGenerateMusicGenerationConfig

Configuration for music generation.

| Fields                |                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperature`         | `float` Optional. Controls the variance in audio generation. Higher values produce higher variance. Range is \[0.0, 3.0\]. Default is 1.1.                                            |
| `topK`                | `int32` Optional. Controls how the model selects tokens for output. Samples the topK tokens with the highest probabilities. Range is \[1, 1000\]. Default is 40.                      |
| `seed`                | `int32` Optional. Seeds audio generation. If not set, the request uses a randomly generated seed.                                                                                     |
| `guidance`            | `float` Optional. Controls how closely the model follows prompts. Higher guidance follows more closely, but will make transitions more abrupt. Range is \[0.0, 6.0\]. Default is 4.0. |
| `bpm`                 | `int32` Optional. Beats per minute. Range is \[60, 200\].                                                                                                                             |
| `density`             | `float` Optional. Density of sounds. Range is \[0.0, 1.0\].                                                                                                                           |
| `brightness`          | `float` Optional. Higher value produces brighter audio. Range is \[0.0, 1.0\].                                                                                                        |
| `scale`               | `https://ai.google.dev/api/live_music#BidiGenerateMusicGenerationConfig.Scale` Optional. Scale of the generated music.                                                                |
| `muteBass`            | `bool` Optional. The audio output should not contain bass.                                                                                                                            |
| `muteDrums`           | `bool` Optional. The audio output should not contain drums.                                                                                                                           |
| `onlyBassAndDrums`    | `bool` Optional. The audio output should only contain bass and drums.                                                                                                                 |
| `musicGenerationMode` | `https://ai.google.dev/api/live_music#BidiGenerateMusicGenerationConfig.MusicGenerationMode` Optional. The mode of music generation. Default is QUALITY.                              |

### MusicGenerationMode

| Enums                               |                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `MUSIC_GENERATION_MODE_UNSPECIFIED` | This value is unused.                                                                         |
| `QUALITY`                           | This mode steers text prompts to regions of latent space with higher quality music.           |
| `DIVERSITY`                         | This mode steers text prompts to regions of latent space with a larger diversity of music.    |
| `VOCALIZATION`                      | This mode steers text prompts to regions of latent space more likely to generate vocal music. |

### Scale

Scale of the generated music.

| Enums                       |                                      |
| --------------------------- | ------------------------------------ |
| `SCALE_UNSPECIFIED`         | Default value. This value is unused. |
| `C_MAJOR_A_MINOR`           | C major or A minor                   |
| `D_FLAT_MAJOR_B_FLAT_MINOR` | D flat major or B flat minor         |
| `D_MAJOR_B_MINOR`           | D major or B minor                   |
| `E_FLAT_MAJOR_C_MINOR`      | E flat major or C minor              |
| `E_MAJOR_D_FLAT_MINOR`      | E major or D flat minor              |
| `F_MAJOR_D_MINOR`           | F major or D minor                   |
| `G_FLAT_MAJOR_E_FLAT_MINOR` | G flat major or E flat minor         |
| `G_MAJOR_E_MINOR`           | G major or E minor                   |
| `A_FLAT_MAJOR_F_MINOR`      | A flat major or F minor              |
| `A_MAJOR_G_FLAT_MINOR`      | A major or G flat minor              |
| `B_FLAT_MAJOR_G_MINOR`      | B flat major or G minor              |
| `B_MAJOR_A_FLAT_MINOR`      | B major or A flat minor              |

### BidiGenerateMusicPlaybackControl

Playback control for the music generation.

| Enums                          |                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `PLAYBACK_CONTROL_UNSPECIFIED` | This value is unused.                                                                                         |
| `PLAY`                         | Start generating the music.                                                                                   |
| `PAUSE`                        | Hold the music generation. Use PLAY to resume from the current position.                                      |
| `STOP`                         | Stop the music generation and reset the context (prompts retained). Use PLAY to restart the music generation. |
| `RESET_CONTEXT`                | Reset the context (prompts retained) without stopping the music generation.                                   |

### BidiGenerateMusicServerContent

Incremental server update generated by the model in response to client messages.

Content is generated as quickly as possible, and not in real time. Clients may choose to
buffer and play it out in real time.

| Fields          |                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `audioChunks[]` | `https://ai.google.dev/api/live_music#AudioChunk` Output only. Audio chunks that the model has generated. |

### BidiGenerateMusicServerMessage

Response message for the BidiGenerateMusic call.

| Fields                                                                                              |                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Union field `messageType`. The type of the message. `messageType` can be only one of the following: |                                                                                                                                                                                   |
| `setupComplete`                                                                                     | `https://ai.google.dev/api/live_music#BidiGenerateMusicSetupComplete` Output only. Sent in response to a `BidiGenerateMusicSetup` message from the client when setup is complete. |
| `serverContent`                                                                                     | `https://ai.google.dev/api/live_music#BidiGenerateMusicServerContent` Output only. Content generated by the model in response to client messages.                                 |
| `filteredPrompt`                                                                                    | `https://ai.google.dev/api/live_music#BidiGenerateMusicFilteredPrompt` Output only. Filtered prompt with reason.                                                                  |
| `warning`                                                                                           | `string` Output only. The warning message from the server. Warnings won't terminate the stream.                                                                                   |

### BidiGenerateMusicSetup

Message to be sent in the first (and only in the first)
`BidiGenerateMusicClientMessage`.

Clients should wait for a `BidiGenerateMusicSetupComplete` message before sending
any additional messages.

| Fields  |                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| `model` | `string` Required. The model's resource name. This serves as an ID for the model to use. Format: `models/{model}` |

### BidiGenerateMusicSetupComplete

This type has no fields.
Sent in response to a `BidiGenerateMusicSetup` message from the client.

### WeightedPrompt

Weighted prompt as the model input.

| Fields                                                           |                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weight`                                                         | `float` Required. Weight of the prompt. The weight is used to control the relative importance of the prompt. Higher weights are more important than lower weights. Weights of all weighted_prompts in this BidiGenerateMusicClientContent must not be all 0. Weights of all weighted_prompts in this BidiGenerateMusicClientContent message will be normalized. |
| Union field `prompt`. `prompt` can be only one of the following: |                                                                                                                                                                                                                                                                                                                                                                 |
| `text`                                                           | `string` Text prompt.                                                                                                                                                                                                                                                                                                                                           |

## More information on types

For more information on the types used by the API, see the
[Python SDK](https://github.com/googleapis/python-genai/blob/main/google/genai/types.py).
