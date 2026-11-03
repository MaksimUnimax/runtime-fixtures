import { describe, expect, it } from "vitest";
import {
  FeedbackSupportService,
  sanitizeFeedbackText,
  type FeedbackRepository,
} from "./index.js";

const head = "SYNTHETIC_GRAMMAR_PRIVATE_HEAD";
const tail = "SYNTHETIC_GRAMMAR_PRIVATE_TAIL";
const metadata = "Рабочий جهاز🙂";
function quoted(value: string, quote: string): string {
  const encoded = JSON.stringify(value);
  return quote === '"'
    ? encoded
    : "'" + encoded.slice(1, -1).replace(/'/gu, "\\'") + "'";
}
const forms = [
  { name: "strict", key: '"', value: '"' },
  { name: "pseudo", key: "'", value: "'" },
  { name: "mixed-value", key: '"', value: "'" },
  { name: "mixed-key", key: "'", value: '"' },
];
const gaps = ["", " ", "\u2060", "\u00a0", "\ufeff", "\u0085"];
const cases = forms.flatMap((form) =>
  gaps.flatMap((gap, gapIndex) =>
    ["password", "token", "api-key"].flatMap((key) => {
      const doc =
        "{" +
        quoted("detail", form.key) +
        gap +
        ":" +
        gap +
        quoted(key + "=" + head + " " + tail, form.value) +
        "," +
        gap +
        quoted("id", form.key) +
        ":9007199254740993," +
        quoted("trace", form.key) +
        ":" +
        quoted(metadata, form.value) +
        "," +
        quoted("count", form.key) +
        ":1.2300e+30}";
      return [
        { name: form.name + "/" + gapIndex + "/" + key + "/direct", text: doc },
        {
          name: form.name + "/" + gapIndex + "/" + key + "/prose",
          text: "diagnostic " + doc,
        },
        {
          name: form.name + "/" + gapIndex + "/" + key + "/severity",
          text: "[INFO] " + doc,
        },
        {
          name: form.name + "/" + gapIndex + "/" + key + "/nested",
          text:
            '{"detail":' + JSON.stringify(doc) + ',"outerId":9007199254740995}',
        },
      ];
    }),
  ),
);
async function capturedCopies(text: string): Promise<string[]> {
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
  return writes;
}
const unsupported = [
  '{detail:"password=' + head + " " + tail + '"}',
  '{"detail"="token=' + head + " " + tail + '"}',
  '{"detail"："api-key=' + head + " " + tail + '"}',
  '{"detail":("password=' + head + " " + tail + '")}',
  '{"detail":"password\\q=' + head + " " + tail + '","trace":"safe"}',
  '{"trace":"safe","detail":"pass\\u0077ord=' + head + " " + tail,
  "{'trace':'safe','detail':'pass\\u0077ord=" + head + " " + tail,
  '{"detail":"password=' + head + " " + tail + '","broken":}',
  '{"detail":"password=' + head + " " + tail + '","broken":[}',
];
describe("one envelope grammar for framing, decoded string cleanup and fallback", () => {
  it.each(cases)(
    "cleans every framed diagnostic string without losing metadata: $name",
    ({ text }) => {
      const actual = sanitizeFeedbackText(text);
      expect(actual).not.toContain(head);
      expect(actual).not.toContain(tail);
      expect(actual).toContain("[REDACTED_SECRET]");
      expect(actual).toContain("9007199254740993");
      expect(actual).toContain("1.2300e+30");
      expect(actual).toContain(metadata);
      if (text.startsWith("[INFO]")) expect(actual).toContain("[INFO] ");
    },
  );
  it.each(cases)(
    "keeps both private markers out of all four persistence copies: $name",
    async ({ text }) => {
      for (const value of await capturedCopies(text)) {
        expect(value).not.toContain(head);
        expect(value).not.toContain(tail);
        expect(value).toContain("[REDACTED_SECRET]");
        expect(value).toContain("9007199254740993");
        expect(value).toContain(metadata);
      }
    },
  );
  it.each(unsupported)(
    "does not retain a private suffix in an unsupported or incomplete form: %s",
    async (text) => {
      for (const value of [
        sanitizeFeedbackText(text),
        ...(await capturedCopies(text)),
      ]) {
        expect(value).not.toContain(head);
        expect(value).not.toContain(tail);
        expect(value).toContain("[REDACTED_SECRET]");
      }
    },
  );
  it.each([
    '{"password=' + head + " " + tail + '":"ordinary","trace":"safe"}',
    "{'password=" + head + " " + tail + "':'ordinary','trace':'safe'}",
    '{"password\\q=' + head + " " + tail + '":"ordinary","trace":"safe"}',
    '{"pass\\u0077ord\\u003d' +
      head +
      "\\u0020" +
      tail +
      '\\q":"ordinary","trace":"safe"}',
  ])(
    "does not treat a diagnostic key containing private text as a safe identifier: %s",
    async (text) => {
      for (const value of [
        sanitizeFeedbackText(text),
        ...(await capturedCopies(text)),
      ]) {
        expect(value).not.toContain(head);
        expect(value).not.toContain(tail);
        expect(value).toContain("[REDACTED_SECRET]");
        expect(value).toContain("safe");
      }
    },
  );
  it.each([
    '{"id":9007199254740993,"amount":1.2300e+30,"label":"Рабочий جهاز🙂","ready":true,"none":null}',
    "{'id':9007199254740993,'amount':1.2300e+30,'label':'Рабочий جهاز🙂','ready':true,'none':null}",
    "{'de\\u0074ail':'Рабочий جهاز🙂','id':9007199254740993}",
    '{"label"\u2060:"Рабочий جهاز🙂","id":9007199254740993}',
    '{"requestId":"safe-truncated-metadata',
    "{'requestId':'safe-truncated-metadata",
    "Ошибка при чтении файла\nСледующая строка",
  ])(
    "retains benign supported and safely truncated metadata exactly: %s",
    (text) => {
      expect(sanitizeFeedbackText(text)).toBe(text);
    },
  );
  it("handles nested encoded grammar boundaries without rounding surrounding numbers", async () => {
    let value = "{'detail'\u2060:'password=" + head + " " + tail + "'}";
    for (let layer = 0; layer < 4; layer++)
      value = '{"id":9007199254740993,"detail":' + JSON.stringify(value) + "}";
    for (const output of [
      sanitizeFeedbackText(value),
      ...(await capturedCopies(value)),
    ]) {
      expect(output).not.toContain(head);
      expect(output).not.toContain(tail);
      expect(output).toContain("9007199254740993");
    }
  });
  it("cleans repeated diagnostic encoding and preserves deeply nested safe containers", () => {
    const safe =
      "[".repeat(100) +
      '{"label":"Рабочий جهاز🙂","id":9007199254740993}' +
      "]".repeat(100);
    expect(sanitizeFeedbackText(safe)).toBe(safe);
    let value = "password=" + head + " " + tail;
    for (let layer = 0; layer < 8; layer++) value = JSON.stringify(value);
    expect(sanitizeFeedbackText(value)).not.toContain(tail);
  });
});
