/**
 * `compat` editor, shared by the provider drawer and the model drawer.
 *
 * pi types `compat` as a union of three API-family shapes, so the flags are
 * grouped the way the schema groups them and each group is collapsed by
 * default — an untouched `compat` should stay invisible.
 */

import {
  COMPAT_FAMILIES,
  COMPAT_JSON_KEYS,
  pruneBlank,
  type ProviderCompat,
} from "../../lib/configBridge";
import { Field } from "../ui/kit";
import { Collapsible, JsonField, NumberInput, Select, SwitchRow } from "../ui/form";

export function CompatEditor({
  compat,
  onChange,
}: {
  compat: ProviderCompat | undefined;
  onChange: (next: ProviderCompat | undefined) => void;
}) {
  const current = compat ?? {};

  const patch = (keys: Partial<ProviderCompat>) =>
    onChange(pruneBlank({ ...current, ...keys }) as ProviderCompat);

  return (
    <div className="compat">
      {COMPAT_FAMILIES.map((family) => (
        <Collapsible
          key={family.id}
          title={family.label}
          hint={family.hint}
          count={family.fields.filter((item) => current[item.key] !== undefined).length}
        >
          <div className="compat-list">
            {family.fields.map((item) =>
              item.kind === "bool" ? (
                <SwitchRow
                  key={item.key}
                  label={item.label}
                  hint={item.hint}
                  checked={current[item.key] === true}
                  onChange={(next) => patch({ [item.key]: next ? true : undefined })}
                />
              ) : (
                <Field key={item.key} label={item.label} hint={item.hint}>
                  {item.kind === "number" ? (
                    <NumberInput
                      value={typeof current[item.key] === "number" ? (current[item.key] as number) : undefined}
                      onChange={(next) => patch({ [item.key]: next })}
                    />
                  ) : (
                    <Select
                      className="input"
                      value={typeof current[item.key] === "string" ? (current[item.key] as string) : ""}
                      onChange={(next) => patch({ [item.key]: next || undefined })}
                      options={(item.options ?? []).map((option) => ({ value: option, label: option }))}
                    />
                  )}
                </Field>
              ),
            )}
          </div>
        </Collapsible>
      ))}

      <Field
        label="对象型 compat"
        hint={`这几个键的值是对象或数组，用 JSON 填：${COMPAT_JSON_KEYS.join(" / ")}。`}
      >
        <JsonField
          value={pickJsonKeys(current)}
          onChange={(next) => {
            const rest = { ...current };
            for (const key of COMPAT_JSON_KEYS) delete rest[key];
            onChange(
              pruneBlank({ ...rest, ...((next ?? {}) as Record<string, unknown>) }) as ProviderCompat,
            );
          }}
          rows={4}
          placeholder={'{\n  "openRouterRouting": { "allow_fallbacks": false }\n}'}
        />
      </Field>
    </div>
  );
}

function pickJsonKeys(compat: ProviderCompat): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of COMPAT_JSON_KEYS) {
    if (compat[key] !== undefined) out[key] = compat[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
