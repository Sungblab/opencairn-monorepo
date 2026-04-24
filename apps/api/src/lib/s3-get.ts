import { getS3Client, getBucket } from "./s3";
import type { Readable } from "node:stream";

export interface StreamedObject {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
}

/**
 * Pull an object from MinIO and adapt the Node Readable into a Web
 * ReadableStream so Hono can forward it straight into `c.body(stream, ...)`.
 * Content-Type / Length come from `statObject` so the browser gets accurate
 * headers without us having to store them in Postgres twice.
 *
 * `statObject.metaData` keys are lowercased by the minio client, so we look
 * up `content-type` rather than `Content-Type`.
 */
export async function streamObject(key: string): Promise<StreamedObject> {
  const client = getS3Client();
  const bucket = getBucket();
  const stat = await client.statObject(bucket, key);
  const nodeStream = (await client.getObject(bucket, key)) as Readable;
  return {
    stream: nodeStreamToWebStream(nodeStream),
    contentType: stat.metaData?.["content-type"] ?? "application/octet-stream",
    contentLength: stat.size,
  };
}

function nodeStreamToWebStream(node: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk)),
      );
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      node.destroy();
    },
  });
}
