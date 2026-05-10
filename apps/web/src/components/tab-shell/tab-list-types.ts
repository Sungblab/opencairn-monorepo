import type { Tab } from "@/stores/tabs-store";

export interface TabListProps {
  tabs: Tab[];
  activeId: string | null;
  wsSlug: string;
}
