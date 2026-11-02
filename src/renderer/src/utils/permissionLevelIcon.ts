/**
 *
 * 但都存在「最严格 / 中间 / 最宽松 / 未知」四个保护强度。图标只表达
 * 保护强度，不表达后端差异，跨后端切换时同一图标含义保持一致：
 *
 * - Shield       未知/自定义
 *
 * 新增后端的权限控制位（SecurityControl 注册）必须复用本映射。
 */
import { Shield, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";

export type PermissionStrength = "strict" | "standard" | "relaxed" | "unknown";

export function permissionStrengthIcon(strength: PermissionStrength) {
	if (strength === "strict") return ShieldAlert;
	if (strength === "standard") return ShieldCheck;
	if (strength === "relaxed") return ShieldOff;
	return Shield;
}
