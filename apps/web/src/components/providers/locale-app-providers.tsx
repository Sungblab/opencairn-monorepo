"use client";

import { CommandPaletteLoader } from "@/components/palette/command-palette-loader";
import { ToasterLoader } from "@/components/ui/toaster-loader";
import { ReactQueryProvider } from "@/lib/react-query";

export function LocaleAppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReactQueryProvider>
      {children}
      <ToasterLoader />
      <CommandPaletteLoader />
    </ReactQueryProvider>
  );
}
