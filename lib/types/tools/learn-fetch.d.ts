import { type LearnTool, type ToolDeps } from './base.js';
/** 私有/保留地址判定：只做字面量检查，够挡住误用与诱导访问。 */
export declare function isPrivateAddress(hostname: string): boolean;
export declare function createFetchTool(deps: ToolDeps): LearnTool;
