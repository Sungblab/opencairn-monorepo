import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

function pickMessages(
  messages: Awaited<ReturnType<typeof getMessages>>,
  namespaces: readonly string[] | undefined,
) {
  if (!namespaces) return messages;

  return Object.fromEntries(
    namespaces
      .map((namespace) => [namespace, messages[namespace]])
      .filter((entry): entry is [string, unknown] => Boolean(entry[1])),
  ) as Awaited<ReturnType<typeof getMessages>>;
}

export async function IntlClientProvider({
  children,
  namespaces,
}: {
  children: React.ReactNode;
  namespaces?: readonly string[];
}) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={pickMessages(messages, namespaces)}>
      {children}
    </NextIntlClientProvider>
  );
}
