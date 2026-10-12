import type { AppearanceApi } from "../../hooks/useAppearance";
import { FONT_SCALES } from "../../lib/configBridge";
import { Card, CardBody, CardHeader, Field, FieldGroup, SegmentedControl } from "../ui/kit";

/**
 * Appearance settings. Everything here is pure CSS, so it applies live — the
 * engine is never restarted and nothing is written to pi's own config.
 */
export function AppearanceTab({ appearance }: { appearance: AppearanceApi }) {
  const { prefs, update } = appearance;

  return (
    <>
      <Card>
        <CardHeader
          title="主题"
          description="只影响 APIX 界面；pi 自己的终端主题在「通用」里单独设置。"
        />
        <CardBody>
          <FieldGroup>
            <Field
              label="主题"
              hint="选「跟随系统」时，APIX 会随 Windows 的浅色/深色设置自动切换，并在系统切换时立刻跟随。"
            >
              <SegmentedControl
                label="主题"
                value={prefs.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { value: "system", label: "跟随系统" },
                  { value: "light", label: "浅色" },
                  { value: "dark", label: "深色" },
                ]}
              />
            </Field>
          </FieldGroup>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="字体"
          description="字号缩放的是整个界面——正文、侧栏、设置页、工具输出和代码块一起变，行高会跟着一起缩放，所以放大后不会挤在一起。"
        />
        <CardBody>
          <FieldGroup>
            <Field label="字号" hint="间距、圆角和边框粗细保持原样，只放大文字。">
              <SegmentedControl
                label="字号"
                value={String(prefs.fontScale)}
                onChange={(value) => update({ fontScale: Number(value) })}
                options={FONT_SCALES.map((scale) => ({
                  value: String(scale.value),
                  label: scale.label,
                }))}
              />
            </Field>
          </FieldGroup>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="动效" description="动画和过渡的开关。" />
        <CardBody>
          <FieldGroup>
            <Field
              label="减少动效"
              hint="关掉后，面板滑入、光标闪烁、背景动画这类装饰性动效会被禁用；状态切换依然即时反映。"
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={prefs.reduceMotion}
                  onChange={(event) => update({ reduceMotion: event.target.checked })}
                />
                <span>减少动效</span>
              </label>
            </Field>
          </FieldGroup>
        </CardBody>
      </Card>
    </>
  );
}
