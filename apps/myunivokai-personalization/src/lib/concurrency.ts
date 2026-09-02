/**
 * Maps items through an async function with at most `concurrencyLimit` calls in
 * flight, preserving input order in the result array. Used instead of a raw
 * Promise.all fan-out so page loads stay under the backend's per-IP rate-limit
 * burst. Rejections propagate exactly like Promise.all: callers that want
 * per-item error entries catch inside `mapItem` (as the gallery does).
 */
export async function mapWithBoundedConcurrency<InputType, OutputType>(
  items: readonly InputType[],
  concurrencyLimit: number,
  mapItem: (item: InputType, index: number) => Promise<OutputType>
): Promise<OutputType[]> {
  const results = new Array<OutputType>(items.length);
  const workerCount = Math.max(1, Math.min(concurrencyLimit, items.length));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapItem(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}
