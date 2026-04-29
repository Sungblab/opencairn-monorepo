import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { NotificationsView } from "./notifications-view";
import koAccountNotifications from "../../../../messages/ko/account-notifications.json";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>(
    "@/lib/api-client",
  );
  return {
    ...actual,
    notificationPreferencesApi: {
      list: vi.fn(),
      upsert: vi.fn(),
      profile: vi.fn(),
      updateProfile: vi.fn(),
    },
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { notificationPreferencesApi } from "@/lib/api-client";

const listMock = notificationPreferencesApi.list as unknown as ReturnType<typeof vi.fn>;
const upsertMock = notificationPreferencesApi.upsert as unknown as ReturnType<typeof vi.fn>;
const profileMock = notificationPreferencesApi.profile as unknown as ReturnType<typeof vi.fn>;
const updateProfileMock = notificationPreferencesApi.updateProfile as unknown as ReturnType<typeof vi.fn>;

const defaultRows = [
  { kind: "mention", emailEnabled: true, frequency: "instant" },
  { kind: "comment_reply", emailEnabled: true, frequency: "instant" },
  { kind: "share_invite", emailEnabled: true, frequency: "instant" },
  { kind: "research_complete", emailEnabled: true, frequency: "instant" },
  { kind: "system", emailEnabled: true, frequency: "digest_daily" },
] as const;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{ accountNotifications: koAccountNotifications }}
    >
      <QueryClientProvider client={qc}>
        <NotificationsView />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockResolvedValue({ preferences: defaultRows });
  profileMock.mockResolvedValue({ locale: "ko", timezone: "Asia/Seoul" });
  upsertMock.mockResolvedValue(defaultRows[0]);
  updateProfileMock.mockResolvedValue({ locale: "ko", timezone: "UTC" });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("NotificationsView", () => {
  it("renders 5 rows from API and shows kind labels", async () => {
    setup();
    await waitFor(() => screen.getByText("멘션"));
    expect(screen.getByText("코멘트 답글")).toBeInTheDocument();
    expect(screen.getByText("공유 초대")).toBeInTheDocument();
    expect(screen.getByText("딥리서치 완료")).toBeInTheDocument();
    expect(screen.getByText("시스템 알림")).toBeInTheDocument();
  });

  it("toggling email checkbox calls upsert with both fields", async () => {
    setup();
    await waitFor(() => screen.getByText("멘션"));
    const mentionRow = screen.getByText("멘션").closest("tr");
    if (!mentionRow) throw new Error("row not found");
    const checkbox = mentionRow.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(upsertMock).toHaveBeenCalledWith("mention", {
      emailEnabled: false,
      frequency: "instant",
    });
  });

  it("changing frequency calls upsert with new frequency", async () => {
    setup();
    await waitFor(() => screen.getByText("시스템 알림"));
    const sysRow = screen.getByText("시스템 알림").closest("tr");
    if (!sysRow) throw new Error("row not found");
    const select = sysRow.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "instant" } });
    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(upsertMock).toHaveBeenCalledWith("system", {
      emailEnabled: true,
      frequency: "instant",
    });
  });

  it("changing timezone calls updateProfile", async () => {
    setup();
    await waitFor(() => screen.getByText("표준 시간대"));
    const tzSelect = screen.getByLabelText("표준 시간대") as HTMLSelectElement;
    fireEvent.change(tzSelect, { target: { value: "UTC" } });
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1));
    expect(updateProfileMock).toHaveBeenCalledWith({ timezone: "UTC" });
  });
});
