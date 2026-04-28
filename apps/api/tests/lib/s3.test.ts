import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock } = vi.hoisted(() => ({
  clientMock: vi.fn(),
}));

vi.mock("minio", () => ({
  Client: clientMock,
}));

function clearS3Env() {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_ACCESS_KEY;
  delete process.env.S3_SECRET_KEY;
  delete process.env.S3_USE_SSL;
}

describe("s3 client", () => {
  beforeEach(() => {
    vi.resetModules();
    clientMock.mockClear();
    clearS3Env();
  });

  it("requires an explicit access key", async () => {
    process.env.S3_SECRET_KEY = "dev-secret";
    const { getS3Client } = await import("../../src/lib/s3.js");

    expect(() => getS3Client()).toThrow(/S3_ACCESS_KEY/);
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("requires an explicit secret key", async () => {
    process.env.S3_ACCESS_KEY = "dev-access";
    const { getS3Client } = await import("../../src/lib/s3.js");

    expect(() => getS3Client()).toThrow(/S3_SECRET_KEY/);
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("uses the configured credentials and endpoint", async () => {
    process.env.S3_ENDPOINT = "https://minio.example.com:9443/uploads";
    process.env.S3_ACCESS_KEY = "dev-access";
    process.env.S3_SECRET_KEY = "dev-secret";
    process.env.S3_USE_SSL = "false";
    const { getS3Client } = await import("../../src/lib/s3.js");

    getS3Client();

    expect(clientMock).toHaveBeenCalledWith({
      endPoint: "minio.example.com",
      port: 9443,
      useSSL: true,
      accessKey: "dev-access",
      secretKey: "dev-secret",
    });
  });
});
