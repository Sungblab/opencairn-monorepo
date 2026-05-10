import { SocraticSessionLoader } from "@/components/learn/SocraticSessionLoader";

function stringParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SocraticPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ concept?: string | string[]; note?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);

  return (
    <SocraticSessionLoader
      projectId={projectId}
      initialConcept={stringParam(query.concept)}
      initialNoteContext={stringParam(query.note)}
    />
  );
}
