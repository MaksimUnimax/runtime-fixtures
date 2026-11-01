import { describe, expect, it } from "vitest";
import {
  FeedbackSupportService,
  sanitizeFeedbackText,
  type FeedbackRepository,
} from "./index.js";
const head = "SYNTHETIC_PRIVATE_HEAD",
  tail = "SYNTHETIC_PRIVATE_TAIL";
const raw = [
  ...[
    "password＝",
    "ｐａｓｓｗｏｒｄ=",
    "password：",
    "private_key=",
    "api key=",
  ].map((key) => `${key}${head} ${tail}`),
  ...[
    "password",
    "access_token",
    "clientSecret",
    "api_key",
    "ozon_api_key",
  ].map((key) => `${key}=${head} ${tail}`),
  ...[" ", "\t", "\n", "\r\n", ",", ";"].map(
    (gap) => `password=${head}${gap}${tail}`,
  ),
  ...["api\nkey", "api\rkey", "api key", "api\u00a0key", "api\u200bkey"].map(
    (key) => `diagnostic {"${key}":"${head} ${tail}","requestId":"safe-trace"}`,
  ),
  '{"api\\nkey":"' + head + " " + tail + '","id":9007199254740993}',
  'diagnostic {"api\nkey":["' +
    head +
    '","' +
    tail +
    '"],"id":9007199254740993}',
];
describe("whole F03 ambiguous values and obscured keys", () => {
  it.each(raw)("removes the complete secret in %s", (text) => {
    const actual = sanitizeFeedbackText(text);
    expect(actual).not.toContain(head);
    expect(actual).not.toContain(tail);
    expect(actual).toContain("[REDACTED_SECRET]");
  });
  it.each(raw)(
    "uses the same complete sanitizer at every repository sink for %s",
    async (text) => {
      const writes: string[] = [];
      const repository = {
        createCase: async (
          input: Parameters<FeedbackRepository["createCase"]>[0],
        ) => {
          writes.push(input.description, input.body.description);
          throw new Error("SYNTHETIC_CAPTURE");
        },
        getOwnCase: async () => ({}),
        addFollowup: async (input: { body: string }) => {
          writes.push(input.body);
          throw new Error("SYNTHETIC_CAPTURE");
        },
      } as unknown as FeedbackRepository;
      const service = new FeedbackSupportService(repository);
      const id = "00000000-0000-4000-8000-000000000001";
      await expect(
        service.createCase(id, {
          accountId: id,
          category: "OTHER",
          description: text,
        }),
      ).rejects.toThrow("SYNTHETIC_CAPTURE");
      await expect(
        service.addUserFollowup(id, id, { description: text }),
      ).rejects.toThrow("SYNTHETIC_CAPTURE");
      await expect(
        service.addAdminFollowup("SUPPORT", id, id, { description: text }),
      ).rejects.toThrow("SYNTHETIC_CAPTURE");
      expect(writes).toHaveLength(4);
      for (const value of writes) {
        expect(value).toBe(sanitizeFeedbackText(text));
        expect(value).not.toContain(head);
        expect(value).not.toContain(tail);
      }
    },
  );
  it("keeps complete safe JSON metadata and large number lexemes around a secret in a nested text value", () => {
    const text =
      '{"id":9007199254740993,"detail":' +
      JSON.stringify(`password=${head} ${tail}`) +
      ',"name":"Рабочий جهاز🙂","count":1e+30}';
    const actual = sanitizeFeedbackText(text);
    expect(() => JSON.parse(actual)).not.toThrow();
    expect(actual).toContain('"id":9007199254740993');
    expect(actual).toContain('"count":1e+30');
    expect(actual).toContain('"name":"Рабочий جهاز🙂"');
    expect(actual).not.toContain(tail);
  });
  it("preserves Unicode prose, harmless multiword values and complete nonsecret JSON", () => {
    for (const text of [
      "Ошибка при чтении файла\nСледующая строка",
      "message=some useful ordinary text",
      '{"api version":"safe metadata","count":9007199254740993}',
    ])
      expect(sanitizeFeedbackText(text)).toBe(text);
  });
});
