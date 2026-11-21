import { describe, expect, it } from "vitest";
import {
  FeedbackSupportService,
  sanitizeFeedbackText,
  type FeedbackRepository,
} from "./index.js";

const tail = "SYNTHETIC_PRIVATE_TAIL";
const cases = ["424242", "-12.5e3", "true", "false", "null"].flatMap((scalar) =>
  ['"password"', "'api key'", '"access\\u005ftoken"', '"api\u2060key"'].flatMap(
    (key) =>
      ["\n", "\r", "\r\n"].flatMap((line) => {
        const text = `diagnostic {${key}\u2060:${scalar}${line}${tail}}`;
        return [
          text,
          '{"id":9007199254740993,"detail":' +
            JSON.stringify(text) +
            ',"name":"Рабочий جهاز🙂"}',
        ];
      }),
  ),
);

describe("unframed typed credential tails", () => {
  it.each(cases)("redacts the entire ambiguous value in %s", (text) => {
    const actual = sanitizeFeedbackText(text);
    expect(actual).not.toContain(tail);
    expect(actual).toContain("[REDACTED_SECRET]");
    if (text.startsWith('{"id"')) {
      expect(actual).toContain('"id":9007199254740993');
      expect(actual).toContain('"name":"Рабочий جهاز🙂"');
    }
  });
  it.each(cases)(
    "keeps the private tail out of all four persistence copies: %s",
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
        expect(value).not.toContain(tail);
        expect(value).toContain("[REDACTED_SECRET]");
      }
    },
  );
  it.each([
    '{"password":424242,\n"trace":"safe","id":9007199254740993}',
    '{"password"\u2060:true,\r\n"trace":"safe","id":9007199254740993}',
    "{'password':null,\r'name':'Рабочий جهاز🙂','count':1e+30}",
  ])(
    "retains proved scalar siblings and their original number lexemes: %s",
    (text) => {
      const actual = sanitizeFeedbackText(text);
      expect(actual).toContain("[REDACTED_SECRET]");
      expect(actual).toContain(
        text.includes("trace") ? "safe" : "Рабочий جهاز🙂",
      );
      expect(actual).toContain(
        text.includes("9007199254740993") ? "9007199254740993" : "1e+30",
      );
    },
  );
});
