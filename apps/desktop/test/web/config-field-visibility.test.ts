import { describe, expect, it } from "vitest";

import type { IntegrationPluginManifest } from "../../src/web/api/types.js";
import {
  isConfigFieldVisible,
  withConditionalConfigDefaults,
} from "../../src/web/projects/config-field-visibility.js";

const fields: IntegrationPluginManifest["configFields"] = [
  {
    key: "conversationFilterEnabled",
    type: "boolean",
    label: "群聊过滤",
    required: false,
    defaultValue: false,
  },
  {
    key: "conversationIds",
    type: "string[]",
    label: "群聊 ID",
    required: true,
    visibleWhen: { key: "conversationFilterEnabled", equals: true },
  },
];

const conversationIds = fields[1]!;

describe("integration config field visibility", () => {
  it("uses the controlling field value to show dependent fields", () => {
    expect(isConfigFieldVisible(conversationIds, fields, {
      conversationFilterEnabled: false,
    })).toBe(false);
    expect(isConfigFieldVisible(conversationIds, fields, {
      conversationFilterEnabled: true,
    })).toBe(true);
  });

  it("hydrates defaults and preserves populated legacy dependent fields", () => {
    expect(withConditionalConfigDefaults(fields, {
      conversationIds: ["legacy-group"],
    })).toEqual({
      conversationFilterEnabled: true,
      conversationIds: ["legacy-group"],
    });
    expect(withConditionalConfigDefaults(fields, {})).toEqual({
      conversationFilterEnabled: false,
    });
  });
});
