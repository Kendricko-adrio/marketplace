export function parsePagination(
  pageValue: string | null | undefined,
  limitValue: string | null | undefined,
  defaultLimit = 20,
  maxLimit = 100
) {
  const parsedPage = Number.parseInt(pageValue ?? "", 10);
  const parsedLimit = Number.parseInt(limitValue ?? "", 10);
  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    limit:
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, maxLimit)
        : defaultLimit,
  };
}
