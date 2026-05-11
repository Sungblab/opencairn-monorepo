import { FirstSourceIntakeLoader } from "./FirstSourceIntakeLoader";

export function ImportTabs({ wsSlug }: { wsSlug: string }) {
  return (
    <div className="mt-6 max-w-4xl">
      <FirstSourceIntakeLoader
        wsSlug={wsSlug}
        initialMode="file"
        showModeTabs={false}
      />
    </div>
  );
}
