import { useTranslations } from "next-intl";
import { NoteWithBacklinks } from "@/components/notes/NoteWithBacklinks";

export default async function NotePlaceholder({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  return (
    <NoteWithBacklinks noteId={noteId}>
      <NoteBody noteId={noteId} />
    </NoteWithBacklinks>
  );
}

function NoteBody({ noteId }: { noteId: string }) {
  const t = useTranslations("appShell.routes.note");
  return (
    <div data-testid="route-note" className="p-6">
      <h1 className="text-2xl font-semibold">
        {t("heading", { id: noteId })}
      </h1>
      <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
    </div>
  );
}
