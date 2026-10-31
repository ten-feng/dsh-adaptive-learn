function localReady(input) {
    if (input.localEnabled === false)
        return false;
    if (!input.capability)
        return false;
    return input.kind === 'image' ? input.capability.localOcrReady : input.capability.localAsrReady;
}
function engineFor(input) {
    if (input.kind === 'image') {
        const preferred = input.localOcrEngine ?? 'auto';
        return preferred === 'paddleocr' ? 'paddleocr' : 'hunyuanocr';
    }
    return 'faster-whisper';
}
export function routeTask(input) {
    const policy = input.policy ?? 'auto';
    const ready = localReady(input);
    const engine = engineFor(input);
    if (policy === 'cloud-first') {
        return { route: 'cloud', reason: 'cloud-first policy' };
    }
    if (policy === 'local-first') {
        if (input.tier === 'light' && ready) {
            return { route: 'local', engine, reason: `local-first: ${input.tier} task on ready local engine` };
        }
        return {
            route: 'cloud',
            reason: input.tier === 'heavy' ? 'local-first: heavy task stays on cloud' : 'local-first: local engine not ready',
        };
    }
    // auto
    if (input.tier === 'heavy') {
        return { route: 'cloud', reason: 'auto: heavy task requires cloud' };
    }
    if (ready) {
        return { route: 'local', engine, reason: `auto: light task on ready local ${engine}` };
    }
    if (input.hasCloudKey) {
        return { route: 'cloud', reason: 'auto: light task but local engine not ready' };
    }
    const kindLabel = input.kind === 'image' ? '图像' : '音频';
    return {
        route: 'unavailable',
        reason: `auto: local ${kindLabel} engine not ready and no cloud key configured`,
        userActionRequired: `没有可用的${kindLabel}处理路径：本机显存不足或未安装本地模型，且未配置云端密钥。` +
            `请在插件设置中填写密钥，或换一台有 GPU 的机器。`,
    };
}
/** Decide whether a failed local run may silently fall back to the cloud. */
export function shouldFallbackToCloud(input, reason) {
    if (input.policy === 'local-first')
        return input.tier === 'light' && input.hasCloudKey;
    return input.hasCloudKey || reason === 'model_downloading';
}
