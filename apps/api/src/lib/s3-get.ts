import { getS3Client, getBucket } from "./s3";
import type { Readable } from "node:stream";

export interface StreamedObject {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  totalLength: number;
}

export interface ObjectByteRange {
  start: number;
  end: number;
}

export interface StoredObjectInfo {
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
export async function streamObject(
  key: string,
  range?: ObjectByteRange,
): Promise<StreamedObject> {
  const client = getS3Client();
  const bucket = getBucket();
  const info = await statObject(key);
  const contentLength = range ? range.end - range.start + 1 : info.contentLength;
  const nodeStream = (range
    ? await client.getPartialObject(bucket, key, range.start, contentLength)
    : await client.getObject(bucket, key)) as Readable;
  return {
    stream: nodeStreamToWebStream(nodeStream),
    contentType: info.contentType,
    contentLength,
    totalLength: info.contentLength,
  };
}

export async function statObject(key: string): Promise<StoredObjectInfo> {
  const client = getS3Client();
  const bucket = getBucket();
  const stat = await client.statObject(bucket, key);
  return {
    contentType: stat.metaData?.["content-type"] ?? "application/octet-stream",
    contentLength: stat.size,
  };
}

function nodeStreamToWebStream(node: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        // Pause the Node stream once the Web stream's queue is full. `pull`
        // below resumes when the consumer has drained.
        if ((controller.desiredSize ?? 0) <= 0) node.pause();
      });
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    pull() {
      // Consumer asked for more — unblock the Node stream. Safe to call
      // resume() even when the stream isn't paused; it's a no-op.
      node.resume();
    },
    cancel() {
      // Client aborted. Destroying the Node stream frees the underlying
      // MinIO socket so the bucket connection isn't held open.
      node.destroy();
    },
  });
}
