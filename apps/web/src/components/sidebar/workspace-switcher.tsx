"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type WorkspaceRole = "owner" | "admin" | "member" | "guest";

interface MyWorkspace {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
}

interface MyInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  expiresAt: string;
}

interface MyResponse {
  workspaces: MyWorkspace[];
  invites: MyInvite[];
}

export function WorkspaceSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug?: string }>();
  const t = useTranslations("sidebar");

  const { data, isLoading } = useQuery({
    queryKey: ["workspaces", "me"],
    queryFn: async (): Promise<MyResponse> => {
      const res = await fetch("/api/workspaces/me", { credentials: "include" });
      if (!res.ok) throw new Error(`workspaces/me ${res.status}`);
      return (await res.json()) as MyResponse;
    },
    staleTime: 30_000,
  });

  const current =
    data?.workspaces.find((w) => w.slug === params?.wsSlug) ??
    data?.workspaces[0];
  const initial = (current?.name ?? "").trim().charAt(0).toUpperCase() || "·";
  const triggerLabel = current?.name ?? t("switcher.placeholder");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("switcher.trigger_aria")}
        className="app-hover mx-3 mb-2 mt-3 flex items-center gap-2 rounded border-[1.5px] border-muted-foreground/40 bg-background px-2.5 py-1.5 text-left transition-colors hover:border-foreground focus-visible:border-foreground focus-visible:outline-none"
      >
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground text-[10px] font-semibold text-background"
        >
          {initial}
        </span>
        <span className="flex-1 truncate text-[12.5px] font-medium">
          {isLoading ? t("switcher.placeholder") : triggerLabel}
        </span>
        <ChevronDown
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("switcher.label")}</DropdownMenuLabel>
          {data?.workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() => router.push(`/${locale}/app/w/${w.slug}`)}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{w.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t(`role.${w.role}`)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {data?.invites.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t("switcher.invites_label")}
              </DropdownMenuLabel>
              {data.invites.map((invite) => (
                <DropdownMenuItem
                  key={invite.id}
                  onClick={() => router.push(`/${locale}/onboarding`)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{invite.workspaceName}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`role.${invite.role}`)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push(`/${locale}/onboarding`)}
        >
          {t("switcher.new_workspace")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
