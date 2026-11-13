import nativeActions from '../native/actions.cjs';

export async function dispatchAction(channel, converter, request) {
  let response;
  try {
    const action = nativeActions.validateAction(request);
    response = await channel.request(request);
    if (!response || !['ok', 'failed'].includes(response.status) || !Number.isSafeInteger(response.retcode)) throw new Error('原生动作回执无效');
    if (response.status === 'ok' && response.retcode !== 0) throw new Error('原生动作回执状态不一致');
    if (response.status === 'ok' && action.kind === 'send') {
      response = { status: 'ok', retcode: 0, data: { message_id: converter.messageId(response.data.self, response.data.message) } };
    }
  } catch (error) {
    response = { status: 'failed', retcode: error.retcode ?? 1500, data: null, message: error.message };
  }
  return { ...response, ...(request && Object.hasOwn(request, 'echo') ? { echo: request.echo } : {}) };
}
