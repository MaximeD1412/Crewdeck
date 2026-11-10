/** The DTCG document of `design/tokens.json`. */
export type DesignTokens = Record<string, unknown>;

export declare const tokenNames: (tokens: DesignTokens) => string[];
export declare const renderTokensCss: (tokens: DesignTokens) => string;
