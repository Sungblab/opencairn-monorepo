"use client";

import { useParams, useSearchParams } from "next/navigation";
import { SocraticSession } from "@/components/learn/SocraticSession";

export default function SocraticPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const initialConcept = searchParams.get("concept") ?? "";
  const initialNoteContext = searchParams.get("note") ?? "";

  return (
    <SocraticSession
      projectId={projectId}
      initialConcept={initialConcept}
      initialNoteContext={initialNoteContext}
    />
  );
}
