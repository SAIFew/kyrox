export interface SecretScanFinding {
  readonly scope: "HEAD" | "history";
  readonly commit: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly rule: string;
  readonly fingerprint: string;
}

export const PUBLIC_CHAIN_CONSTANTS: ReadonlySet<string>;
export const HISTORICAL_WEB3_DOC_EXAMPLE_SHA256: string;
export const HISTORICAL_TEST_PEM_HEADER_SHA256: string;
export const HISTORICAL_TEST_SK_PREFIX_SHA256: string;
export const HISTORICAL_COMMIT_PATH_ALLOWLIST: ReadonlyMap<
  string,
  ReadonlyMap<string, ReadonlySet<string>>
>;

export function sha256Hex(value: string): string;
export function fingerprint(value: string): string;
export function isAllowedHistoricalFixture(params: {
  readonly scope: "HEAD" | "history";
  readonly commit: string;
  readonly filePath: string;
  readonly digest: string;
}): boolean;
export function scanFileContent(params: {
  readonly filePath: string;
  readonly content: string;
  readonly scope?: "HEAD" | "history";
  readonly commit?: string;
  readonly findings?: SecretScanFinding[];
}): SecretScanFinding[];
export function scanPatchContent(params: {
  readonly commit: string;
  readonly patch: string;
  readonly scope?: "HEAD" | "history";
  readonly findings?: SecretScanFinding[];
}): SecretScanFinding[];
export function runFullRepositoryScan(params?: { readonly cwd?: string }): {
  readonly trackedFileCount: number;
  readonly commitCount: number;
  readonly findings: readonly SecretScanFinding[];
};
