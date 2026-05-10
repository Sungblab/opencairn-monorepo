import { FlashcardReviewRouteLoader } from "@/components/learn/FlashcardReviewRouteLoader";
import { getFlashcardReviewLabels } from "@/components/learn/get-flashcard-review-labels";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string; projectId: string }>;
}) {
  const { locale, wsSlug, projectId } = await params;
  const reviewLabels = await getFlashcardReviewLabels();

  return (
    <FlashcardReviewRouteLoader
      locale={locale}
      wsSlug={wsSlug}
      projectId={projectId}
      reviewLabels={reviewLabels}
    />
  );
}
