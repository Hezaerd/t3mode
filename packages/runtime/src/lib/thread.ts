// The thread on screen, as T3 Code keys it: `<environmentId>:<threadId>`.
// Routes look like `#/<environmentId>/<threadId>` (thread id URL-encoded) or `#/draft/<draftId>`.

const NON_THREAD_ROUTES = new Set(["settings", "welcome", "usage", "pull-requests", "archive"]);

export const currentThreadKey = (hash: string = location.hash): string | null => {
  const parts = hash.replace(/^#\/?/, "").split(/[/?]/);
  const [first, second] = parts;
  if (!first || !second || NON_THREAD_ROUTES.has(first)) return null;
  try {
    return first === "draft"
      ? `draft:${decodeURIComponent(second)}`
      : `${decodeURIComponent(first)}:${decodeURIComponent(second)}`;
  } catch {
    return null;
  }
};
