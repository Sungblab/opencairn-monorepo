"use client";

// Plan 2C Task 9 — ShareDialog (Invite people + Share to web).
//
// Two stacked sections in a controlled shadcn Dialog:
//
//   1. **Invite people** — workspace member search → grant page-level access
//      (viewer/commenter/editor). Backed by Task 4's
//      `/notes/:id/permissions` and `/workspaces/:wsId/members/search`. Each
//      granted row gets an inline role-select + revoke button.
//
//   2. **Share to web** — single active public link toggle. Off→on creates a
//      viewer-role link (read-only by default; the public viewer in Task 8
//      doesn't render comments/edit yet). Role can be flipped between
//      viewer/commenter via revoke→create chain. Backed by Task 3's
//      `/notes/:id/share` + `/share/:shareId`.
//
// Authorisation is enforced at the route level (canWrite gate). The dialog
// only appears in the editor header when the caller's `readOnly` is false,
// so a viewer never sees the trigger.
//
// We use the project's shadcn `Dialog` (from `@/components/ui/dialog`) instead
// of a raw fixed-position modal. shadcn handles focus trap, escape, click-
// outside, and accessibility labelling for free — matches AuthModal /
// VisualizeDialog / ByokKeyCard.

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  shareApi,
  notePermissionsApi,
  workspaceMembersApi,
  type ShareLinkRow,
} from "@/lib/api-client";

// `editor` is only valid on per-note permissions — public links are
// constrained to viewer or commenter (the public viewer can't safely host
// arbitrary editor sessions without an auth identity).
const ROLES_PAGE = ["viewer", "commenter", "editor"] as const;
type Role = (typeof ROLES_PAGE)[number];

// SSR safety: `window` is undefined during SSR/RSC. The viewer URL is only
// surfaced in the dialog body which is client-rendered, but keeping a fallback
// avoids a crash if the helper ever gets called from a server boundary.
function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/s/${token}`;
  return `${window.location.origin}/s/${token}`;
}

export interface ShareDialogProps {
  noteId: string;
  workspaceId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function ShareDialog({
  noteId,
  workspaceId,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const t = useTranslations("shareDialog");
  const qc = useQueryClient();

  // ── Public share link ────────────────────────────────────────────────
  // The server enforces "at most one active link per note", so we treat
  // the first row as the canonical active link. Gating `enabled: open`
  // means closing the dialog drops the polling cost without dropping the
  // cache (TanStack keeps it for the default `gcTime`).
  const linksQuery = useQuery({
    queryKey: ["share-links", noteId],
    queryFn: () => shareApi.list(noteId),
    enabled: open,
  });
  const activeLink: ShareLinkRow | undefined = linksQuery.data?.links[0];

  const createLink = useMutation({
    mutationFn: (role: "viewer" | "commenter") =>
      shareApi.create(noteId, role),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["share-links", noteId] }),
  });
  const revokeLink = useMutation({
    mutationFn: (id: string) => shareApi.revoke(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["share-links", noteId] }),
  });

  // ── Per-note permissions ─────────────────────────────────────────────
  const permsQuery = useQuery({
    queryKey: ["note-permissions", noteId],
    queryFn: () => notePermissionsApi.list(noteId),
    enabled: open,
  });
  const grantPerm = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      notePermissionsApi.grant(noteId, userId, role),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["note-permissions", noteId] }),
  });
  const updatePerm = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      notePermissionsApi.update(noteId, userId, role),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["note-permissions", noteId] }),
  });
  const revokePerm = useMutation({
    mutationFn: (userId: string) => notePermissionsApi.revoke(noteId, userId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["note-permissions", noteId] }),
  });

  // ── Member search ─────────────────────────────────────────────────────
  // No explicit debounce — TanStack Query's `enabled: q.length >= 1` plus
  // its built-in cache de-dupe keeps key-by-key typing cheap enough. If we
  // ever feel the network chatter we can layer a setTimeout debounce, but
  // the workspace member list is small and the server caps results at 10.
  const [memberQuery, setMemberQuery] = useState("");
  const [chosenMemberId, setChosenMemberId] = useState<string | null>(null);
  const [chosenRole, setChosenRole] = useState<Role>("viewer");
  const memberSearch = useQuery({
    queryKey: ["ws-members-search", workspaceId, memberQuery],
    queryFn: () => workspaceMembersApi.search(workspaceId, memberQuery),
    enabled: open && memberQuery.length >= 1,
  });

  // 1.5s "Copied" indicator. Resets via setTimeout — if the user closes the
  // dialog mid-timeout we accept the harmless setState-on-unmount warning
  // (shadcn keeps the component mounted while animating out).
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const handleCopy = async () => {
    if (!activeLink) return;
    await navigator.clipboard.writeText(shareUrl(activeLink.token));
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {/* === Invite people === */}
        <section className="mt-2">
          <h3 className="mb-2 text-sm font-semibold">{t("invitePeople")}</h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t("inviteSearchPlaceholder")}
              value={memberQuery}
              onChange={(e) => {
                setMemberQuery(e.target.value);
                setChosenMemberId(null);
              }}
              className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm"
            />
            <select
              aria-label={t("invitePeople")}
              value={chosenRole}
              onChange={(e) => setChosenRole(e.target.value as Role)}
              className="rounded border border-border bg-transparent px-2 py-1 text-sm"
            >
              {ROLES_PAGE.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!chosenMemberId || grantPerm.isPending}
              onClick={() =>
                chosenMemberId &&
                grantPerm.mutate(
                  { userId: chosenMemberId, role: chosenRole },
                  {
                    onSuccess: () => {
                      setMemberQuery("");
                      setChosenMemberId(null);
                    },
                  },
                )
              }
              className="app-btn-primary rounded px-3 py-1 text-sm"
            >
              {t("addButton")}
            </button>
          </div>
          {/* Member search dropdown — visible only while the user is typing
              and we have at least one result. We dim already-granted users
              instead of hiding so the user knows the lookup worked. */}
          {memberSearch.data?.members.length ? (
            <ul className="mt-2 max-h-32 overflow-y-auto rounded border border-border text-sm">
              {memberSearch.data.members.map((m) => {
                const alreadyGranted = permsQuery.data?.permissions.some(
                  (p) => p.userId === m.userId,
                );
                return (
                  <li
                    key={m.userId}
                    className={`flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-accent ${
                      chosenMemberId === m.userId ? "bg-accent" : ""
                    } ${alreadyGranted ? "opacity-50" : ""}`}
                    onClick={() =>
                      !alreadyGranted && setChosenMemberId(m.userId)
                    }
                  >
                    <span>{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {/* Granted permissions list — inline role-select + revoke. */}
          {(permsQuery.data?.permissions ?? []).length > 0 ? (
            <ul className="mt-3 divide-y divide-border rounded border border-border">
              {(permsQuery.data?.permissions ?? []).map((p) => (
                <li
                  key={p.userId}
                  className="flex items-center gap-2 p-2 text-sm"
                >
                  <span className="flex-1 truncate">
                    {p.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({p.email})
                    </span>
                  </span>
                  <select
                    aria-label={`role for ${p.email}`}
                    value={p.role}
                    onChange={(e) =>
                      updatePerm.mutate({
                        userId: p.userId,
                        role: e.target.value as Role,
                      })
                    }
                    className="rounded border border-border bg-transparent px-2 py-0.5 text-xs"
                  >
                    {ROLES_PAGE.map((r) => (
                      <option key={r} value={r}>
                        {t(`role.${r}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={t("removeMember")}
                    onClick={() => revokePerm.mutate(p.userId)}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* === Share to web === */}
        <section className="mt-6 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("webShareToggle")}</h3>
            <button
              role="switch"
              aria-checked={!!activeLink}
              aria-label={t("webShareToggle")}
              onClick={() =>
                activeLink
                  ? revokeLink.mutate(activeLink.id)
                  : createLink.mutate("viewer")
              }
              className={`relative h-5 w-10 rounded-full transition-colors ${
                activeLink ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-background transition-transform ${
                  activeLink ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {activeLink ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl(activeLink.token)}
                  className="flex-1 rounded border border-border bg-transparent px-2 py-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  {copyState === "copied"
                    ? t("webShareCopied")
                    : t("webShareCopy")}
                </button>
              </div>
              {/* Role flip uses revoke→create because the server keeps role
                  immutable on an active link (Notion model: token === role).
                  The chained `onSuccess` ensures we never end up with two
                  active rows. */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="public-role"
                    checked={activeLink.role === "viewer"}
                    onChange={() =>
                      revokeLink.mutate(activeLink.id, {
                        onSuccess: () => createLink.mutate("viewer"),
                      })
                    }
                  />
                  {t("role.viewer")}
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="public-role"
                    checked={activeLink.role === "commenter"}
                    onChange={() =>
                      revokeLink.mutate(activeLink.id, {
                        onSuccess: () => createLink.mutate("commenter"),
                      })
                    }
                  />
                  {t("role.commenter")}
                </label>
                <span className="ml-auto">
                  {t("webShareCreatedBy", {
                    name: activeLink.createdBy.name,
                    date: new Date(activeLink.createdAt).toLocaleDateString(),
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => revokeLink.mutate(activeLink.id)}
                className="text-xs text-destructive hover:underline"
              >
                {t("webShareRevoke")}
              </button>
            </div>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
