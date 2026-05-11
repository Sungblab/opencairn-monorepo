import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Reset module registry between tests so the EMAIL_PROVIDER env is read fresh
// each time. lib/email.ts captures the provider at module load.
async function loadEmail(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return await import("../src/lib/email.js");
}

function stringifyConsoleCalls(calls: unknown[][]): string {
  return calls
    .map((call) =>
      call
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" "),
    )
    .join("\n");
}

describe("lib/email transport selection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("falls back to console when nothing is configured", async () => {
    const { getEmailProvider } = await loadEmail({});
    expect(getEmailProvider()).toBe("console");
  });

  it("fails closed in production when nothing is configured", async () => {
    const { getEmailProvider, sendVerificationEmail } = await loadEmail({
      NODE_ENV: "production",
      EMAIL_PROVIDER: undefined,
      RESEND_API_KEY: undefined,
      SMTP_HOST: undefined,
    });
    expect(getEmailProvider()).toBe("unconfigured");
    await expect(
      sendVerificationEmail("test@example.com", {
        verifyUrl: "https://opencairn.example/verify?t=abc123",
      }),
    ).rejects.toThrow(/Email transport is not configured in production/);
  });

  it("auto-detects resend from RESEND_API_KEY", async () => {
    const { getEmailProvider } = await loadEmail({
      RESEND_API_KEY: "re_test_dummy",
    });
    expect(getEmailProvider()).toBe("resend");
  });

  it("auto-detects smtp from SMTP_HOST when no Resend key", async () => {
    const { getEmailProvider } = await loadEmail({
      SMTP_HOST: "smtp.example.com",
    });
    expect(getEmailProvider()).toBe("smtp");
  });

  it("explicit EMAIL_PROVIDER=console wins over RESEND_API_KEY", async () => {
    const { getEmailProvider } = await loadEmail({
      EMAIL_PROVIDER: "console",
      RESEND_API_KEY: "re_test_dummy",
    });
    expect(getEmailProvider()).toBe("console");
  });
});

describe("lib/email console rendering", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("sendVerificationEmail prints the verification URL in console mode", async () => {
    const { sendVerificationEmail } = await loadEmail({ EMAIL_PROVIDER: "console" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendVerificationEmail("test@example.com", {
      verifyUrl: "https://opencairn.example/verify?t=abc123",
    });
    const messages = stringifyConsoleCalls(logSpy.mock.calls);
    expect(messages).toContain("test@example.com");
    expect(messages).toContain("https://opencairn.example/verify?t=abc123");
    expect(messages).toContain("이메일 인증");
  });

  it("sendResetPasswordEmail prints the reset URL in console mode", async () => {
    const { sendResetPasswordEmail } = await loadEmail({ EMAIL_PROVIDER: "console" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendResetPasswordEmail("test@example.com", {
      resetUrl: "https://opencairn.example/reset?t=def456",
    });
    const messages = stringifyConsoleCalls(logSpy.mock.calls);
    expect(messages).toContain("test@example.com");
    expect(messages).toContain("https://opencairn.example/reset?t=def456");
    expect(messages).toContain("비밀번호 재설정");
  });

  it("sendInviteEmail prints the signup URL with token in console mode", async () => {
    const { sendInviteEmail } = await loadEmail({
      EMAIL_PROVIDER: "console",
      WEB_BASE_URL: "https://opencairn.example",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendInviteEmail("invitee@example.com", {
      token: "tok_abc",
      workspaceId: "ws_123",
      invitedByName: "Sungbin",
    });
    const messages = stringifyConsoleCalls(logSpy.mock.calls);
    expect(messages).toContain("invitee@example.com");
    expect(messages).toContain("invite=tok_abc");
    expect(messages).toContain("Sungbin");
  });
});

describe("lib/email resend mode failure surface", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("EMAIL_PROVIDER=resend without RESEND_API_KEY throws on send (fails closed)", async () => {
    // Setting provider explicitly to resend without supplying the key is a
    // misconfiguration we want to surface loudly — the original stub would
    // have console.log'd silently.
    const { sendVerificationEmail } = await loadEmail({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: undefined,
    });
    await expect(
      sendVerificationEmail("x@y.z", { verifyUrl: "https://x.y/z" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });
});
