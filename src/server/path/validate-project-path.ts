import { parseVaultPath } from "./vault-path";

export type ValidationFailCode =
  | "invalid_layout"
  | "missing_fields"
  | "path_frontmatter_mismatch";

export interface ValidationResult {
  ok: boolean;
  code?: ValidationFailCode;
  message?: string;
}

export function validateProjectPath(
  path: string,
  fm: Record<string, unknown>,
  opts: { allowNonstandardPath?: boolean } = {},
): ValidationResult {
  const parsed = parseVaultPath(path);
  if (!parsed) {
    if (opts.allowNonstandardPath) return { ok: true };
    return {
      ok: false,
      code: "invalid_layout",
      message: `path must match projects/<project>/<doc_type>/<slug>.md; got: ${path}`,
    };
  }

  const {
    project: fmProject,
    doc_type: fmDocType,
    slug: fmSlug,
  } = fm as {
    project?: unknown;
    doc_type?: unknown;
    slug?: unknown;
  };

  if (
    typeof fmProject !== "string" ||
    typeof fmDocType !== "string" ||
    typeof fmSlug !== "string"
  ) {
    return {
      ok: false,
      code: "missing_fields",
      message: "frontmatter must include string fields: project, doc_type, slug",
    };
  }

  if (
    fmProject !== parsed.project ||
    fmDocType !== parsed.docType ||
    fmSlug !== parsed.slug
  ) {
    return {
      ok: false,
      code: "path_frontmatter_mismatch",
      message: `frontmatter (${fmProject}/${fmDocType}/${fmSlug}) does not match path segments (${parsed.project}/${parsed.docType}/${parsed.slug})`,
    };
  }

  return { ok: true };
}
