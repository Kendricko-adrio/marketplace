import { describe, it, expect, vi, beforeEach } from "vitest";

const { limitMock, notFoundMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const requestMemo = new Map<string, Promise<unknown>>();
  return {
    ...actual,
    cache: <T extends (...args: string[]) => Promise<unknown>>(fn: T) => {
      return ((...args: string[]) => {
        const key = args[0] ?? "";
        if (!requestMemo.has(key)) {
          requestMemo.set(key, fn(...args));
        }
        return requestMemo.get(key);
      }) as T;
    },
  };
});

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: limitMock,
        }),
      }),
    }),
  },
  staticPages: {
    id: "id",
    slug: "slug",
    title: "title",
    content: "content",
    isPublished: "isPublished",
    displayOrder: "displayOrder",
  },
}));

vi.mock("@marketplace/ui", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => content,
}));

vi.mock("@/lib/logger", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import StaticPage, { generateMetadata } from "./page";

describe("StaticPage (/pages/[slug])", () => {
  beforeEach(() => {
    limitMock.mockReset();
    notFoundMock.mockClear();
  });

  it("deduplicates DB query between generateMetadata and StaticPage via React.cache", async () => {
    limitMock.mockResolvedValueOnce([
      {
        id: "page-1",
        slug: "about",
        title: "Tentang Kami",
        content: "# Tentang Kami\nKonten.",
        isPublished: true,
        displayOrder: 1,
      },
    ]);

    const params = Promise.resolve({ slug: "about" });
    const meta = await generateMetadata({ params });
    const element = await StaticPage({ params });

    expect(meta).toEqual({
      title: "Tentang Kami",
      description: "Tentang Kami",
    });
    expect(element).toBeTruthy();
    expect(limitMock).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() and returns fallback metadata when page does not exist", async () => {
    limitMock.mockResolvedValueOnce([]);

    const params = Promise.resolve({ slug: "missing-slug" });
    const meta = await generateMetadata({ params });

    expect(meta).toEqual({ title: "Halaman tidak ditemukan" });
    await expect(StaticPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
