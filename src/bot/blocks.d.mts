// 给 WebUI 的 TypeScript 用：积木定义是 Blockly 的 JSON 格式，这里只声明用到的形状。
export interface BlockArg { type: string; name: string; [key: string]: unknown }
export interface BlockDefinition { type: string; message0: string; args0?: BlockArg[]; style?: string; output?: string | null; previousStatement?: null; nextStatement?: null; tooltip?: string; inputsInline?: boolean }
export const blockDefinitions: BlockDefinition[];
export const blockTypes: Map<string, BlockDefinition>;
export const eventInfo: [string, string][];
export const eventFlags: [string, string][];
export const timeParts: [string, string][];
export function blockKind(definition: BlockDefinition): 'hat' | 'statement' | 'value';
