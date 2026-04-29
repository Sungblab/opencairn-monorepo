// react-email renders outside the next-intl provider tree, so notification
// email body strings live as a POJO map instead of next-intl namespaces.
// Adding a new kind requires a matching entry in both ko + en blocks
// AND a new template branch.

export type EmailLocale = "ko" | "en";

export type EmailNotificationKind =
  | "mention"
  | "comment_reply"
  | "share_invite"
  | "research_complete"
  | "system";

export interface KindCopy {
  // Subject line + heading text are usually identical for short kinds —
  // separated to keep digest subjects ("3 mentions today") clean.
  subject: (params: KindCopyParams) => string;
  heading: (params: KindCopyParams) => string;
  body: (params: KindCopyParams) => string;
  cta: string;
}

export interface KindCopyParams {
  /** Display name of the originating user (mention / comment_reply / share_invite). */
  fromName?: string;
  /** Title of the note / workspace / research run referenced in the payload. */
  subjectTitle?: string;
  /** Optional human-readable secondary phrase (e.g., role for share_invite). */
  detail?: string;
  /** Total in a digest grouping. Used by digest subjects only. */
  count?: number;
}

export interface DigestCopy {
  subject: (params: { kind: EmailNotificationKind; count: number }) => string;
  heading: (params: { kind: EmailNotificationKind; count: number }) => string;
  intro: (params: { kind: EmailNotificationKind; count: number }) => string;
  itemSeparator: string;
  cta: string;
}

export interface EmailCopy {
  brand: string;
  kindLabels: Record<EmailNotificationKind, string>;
  kinds: Record<EmailNotificationKind, KindCopy>;
  digest: DigestCopy;
}

export const EMAIL_COPY: Record<EmailLocale, EmailCopy> = {
  ko: {
    brand: "OpenCairn",
    kindLabels: {
      mention: "멘션",
      comment_reply: "코멘트 답글",
      share_invite: "공유 초대",
      research_complete: "리서치 완료",
      system: "시스템 알림",
    },
    kinds: {
      mention: {
        subject: ({ fromName, subjectTitle }) =>
          `${fromName ?? "회원"}님이 「${subjectTitle ?? "노트"}」에서 회원님을 멘션했어요`,
        heading: ({ fromName }) => `${fromName ?? "회원"}님이 회원님을 멘션했어요`,
        body: ({ subjectTitle }) =>
          `「${subjectTitle ?? "노트"}」에서 회원님이 언급되었습니다. 노트로 이동해 답글을 남기거나 컨텍스트를 확인해 보세요.`,
        cta: "노트 열기",
      },
      comment_reply: {
        subject: ({ fromName, subjectTitle }) =>
          `${fromName ?? "회원"}님이 「${subjectTitle ?? "노트"}」 코멘트에 답글을 남겼어요`,
        heading: ({ fromName }) => `${fromName ?? "회원"}님의 답글이 도착했어요`,
        body: ({ subjectTitle }) =>
          `「${subjectTitle ?? "노트"}」의 코멘트 스레드에 답글이 달렸습니다.`,
        cta: "코멘트 보기",
      },
      share_invite: {
        subject: ({ fromName, subjectTitle, detail }) =>
          `${fromName ?? "회원"}님이 「${subjectTitle ?? "노트"}」를 ${detail ?? "공유"} 권한으로 공유했어요`,
        heading: ({ fromName }) => `${fromName ?? "회원"}님이 노트를 공유했어요`,
        body: ({ subjectTitle, detail }) =>
          `「${subjectTitle ?? "노트"}」가 ${detail ?? "공유"} 권한으로 공유되었습니다. 워크스페이스에 로그인해 노트를 확인해 보세요.`,
        cta: "공유받은 노트 열기",
      },
      research_complete: {
        subject: ({ subjectTitle }) =>
          `「${subjectTitle ?? "리서치"}」 딥리서치가 완료됐어요`,
        heading: () => "딥리서치가 완료됐어요",
        body: ({ subjectTitle }) =>
          `「${subjectTitle ?? "리서치"}」 작업이 끝났습니다. 결과 보고서를 확인해 보세요.`,
        cta: "리서치 결과 보기",
      },
      system: {
        subject: ({ subjectTitle }) => subjectTitle ?? "OpenCairn 알림",
        heading: ({ subjectTitle }) => subjectTitle ?? "OpenCairn 알림",
        body: ({ detail }) => detail ?? "새 알림이 도착했습니다.",
        cta: "OpenCairn 열기",
      },
    },
    digest: {
      subject: ({ kind, count }) => {
        const labels: Record<EmailNotificationKind, string> = {
          mention: "멘션",
          comment_reply: "답글",
          share_invite: "공유 초대",
          research_complete: "리서치 완료",
          system: "시스템 알림",
        };
        return `최근 ${count}건의 ${labels[kind]} 알림 요약`;
      },
      heading: ({ count }) => `${count}건의 새 알림`,
      intro: ({ count }) =>
        `회원님이 받은 알림을 한 번에 정리해서 보내드려요. 모두 ${count}건이에요.`,
      itemSeparator: "•",
      cta: "OpenCairn 에서 모두 보기",
    },
  },
  en: {
    brand: "OpenCairn",
    kindLabels: {
      mention: "Mention",
      comment_reply: "Comment reply",
      share_invite: "Share invite",
      research_complete: "Research complete",
      system: "System alert",
    },
    kinds: {
      mention: {
        subject: ({ fromName, subjectTitle }) =>
          `${fromName ?? "Someone"} mentioned you in “${subjectTitle ?? "a note"}”`,
        heading: ({ fromName }) => `${fromName ?? "Someone"} mentioned you`,
        body: ({ subjectTitle }) =>
          `You were mentioned in “${subjectTitle ?? "a note"}”. Open the note to reply or read the context.`,
        cta: "Open note",
      },
      comment_reply: {
        subject: ({ fromName, subjectTitle }) =>
          `${fromName ?? "Someone"} replied to your comment in “${subjectTitle ?? "a note"}”`,
        heading: ({ fromName }) => `${fromName ?? "Someone"} replied to you`,
        body: ({ subjectTitle }) =>
          `A new reply landed in the comment thread on “${subjectTitle ?? "a note"}”.`,
        cta: "View comment",
      },
      share_invite: {
        subject: ({ fromName, subjectTitle, detail }) =>
          `${fromName ?? "Someone"} shared “${subjectTitle ?? "a note"}” with you (${detail ?? "viewer"})`,
        heading: ({ fromName }) => `${fromName ?? "Someone"} shared a note with you`,
        body: ({ subjectTitle, detail }) =>
          `“${subjectTitle ?? "A note"}” is now available to you with ${detail ?? "viewer"} access.`,
        cta: "Open shared note",
      },
      research_complete: {
        subject: ({ subjectTitle }) =>
          `Deep research on “${subjectTitle ?? "your topic"}” is ready`,
        heading: () => "Your deep research is ready",
        body: ({ subjectTitle }) =>
          `“${subjectTitle ?? "Your research run"}” has finished. The full report is waiting for you.`,
        cta: "View research",
      },
      system: {
        subject: ({ subjectTitle }) => subjectTitle ?? "OpenCairn notification",
        heading: ({ subjectTitle }) => subjectTitle ?? "OpenCairn notification",
        body: ({ detail }) => detail ?? "You have a new notification.",
        cta: "Open OpenCairn",
      },
    },
    digest: {
      subject: ({ kind, count }) => {
        const labels: Record<EmailNotificationKind, string> = {
          mention: "mentions",
          comment_reply: "replies",
          share_invite: "share invites",
          research_complete: "research updates",
          system: "system alerts",
        };
        return `${count} ${labels[kind]} from OpenCairn`;
      },
      heading: ({ count }) => `${count} new notifications`,
      intro: ({ count }) =>
        `Here is a quick summary of your recent activity — ${count} items in total.`,
      itemSeparator: "•",
      cta: "Open OpenCairn",
    },
  },
};
