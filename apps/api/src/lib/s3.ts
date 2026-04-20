import { Client } from "minio";

// S3_ENDPOINT can be provided with or without protocol/port, e.g.
//   "localhost:9000", "http://localhost:9000", "https://minio.example.com".
function parseEndpoint(raw: string | undefined): { host: string; port: number; useSSL: boolean } {
  const fallback = { host: "localhost", port: 9000, useSSL: false };
  if (!raw) return fallback;

  let endpoint = raw.trim();
  let useSSL = process.env.S3_USE_SSL === "true";

  if (endpoint.startsWith("https://")) {
    endpoint = endpoint.slice("https://".length);
    useSSL = true;
  } else if (endpoint.startsWith("http://")) {
    endpoint = endpoint.slice("http://".length);
    useSSL = false;
  }

  // strip any trailing path
  endpoint = endpoint.split("/")[0] ?? endpoint;

  const [host, portStr] = endpoint.split(":");
  const port = Number(portStr ?? (useSSL ? 443 : 9000));
  return { host: host || "localhost", port: Number.isFinite(port) ? port : 9000, useSSL };
}

let _client: Client | null = null;

export function getS3Client(): Client {
  if (_client) return _client;
  const { host, port, useSSL } = parseEndpoint(process.env.S3_ENDPOINT);
  _client = new Client({
    endPoint: host,
    port,
    useSSL,
    accessKey: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  });
  return _client;
}

const BUCKET = process.env.S3_BUCKET ?? "opencairn-uploads";

export function getBucket(): string {
  return BUCKET;
}

export async function ensureBucket(): Promise<void> {
  const client = getS3Client();
  const exists = await client.bucketExists(BUCKET);
  if (!exists) await client.makeBucket(BUCKET, "us-east-1");
}

export async function uploadObject(
  key: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const client = getS3Client();
  await client.putObject(BUCKET, key, data, data.length, {
    "Content-Type": contentType,
  });
  return key;
}
