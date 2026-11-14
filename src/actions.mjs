import nativeActions from '../native/actions.cjs';

const fail = (message, retcode = 1400) => Object.assign(new Error(message), { retcode });

// OneBot ids are local to this process; translate them into the native references QQ needs before validation.
function resolveReferences(converter, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return request;
  const params = request.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return request;
  if (request.action === 'get_forward_msg') {
    const ref = converter.resolve(params.id ?? params.message_id);
    if (!ref) throw fail('合并转发 id 不存在或已过期（仅支持本次运行期间收到的消息）', 1404);
    // A message id also works: QQ keys a top-level forward by the message that carries it.
    const forward = ref.kind === 'forward' ? ref : { chatType: ref.chatType, peerUid: ref.peerUid, root: ref.msgId, parent: ref.msgId };
    return { ...request, params: { ...params, openqq_ref: { chatType: forward.chatType, peerUid: forward.peerUid, root: forward.root, parent: forward.parent } } };
  }
  if (!['send_private_msg', 'send_group_msg', 'send_msg'].includes(request.action) || !Array.isArray(params.message)) return request;
  const message = params.message.map(segment => {
    if (segment?.type !== 'reply') return segment;
    const ref = converter.resolve(segment.data?.id);
    if (ref?.kind !== 'message') throw fail('引用的消息不存在或已过期（仅支持本次运行期间收发过的消息）', 1404);
    return { type: 'reply', data: { id: String(segment.data.id), openqq_ref: { chatType: ref.chatType, peerUid: ref.peerUid, msgId: ref.msgId } } };
  });
  return { ...request, params: { ...params, message } };
}

export async function dispatchAction(channel, converter, request) {
  let response;
  try {
    const prepared = resolveReferences(converter, request);
    const action = nativeActions.validateAction(prepared);
    response = await channel.request(prepared);
    if (!response || !['ok', 'failed'].includes(response.status) || !Number.isSafeInteger(response.retcode)) throw new Error('原生动作回执无效');
    if (response.status === 'ok' && response.retcode !== 0) throw new Error('原生动作回执状态不一致');
    if (response.status === 'ok' && action.kind === 'send') {
      response = { status: 'ok', retcode: 0, data: { message_id: converter.messageId(response.data.self, response.data.message) } };
    }
    if (response.status === 'ok' && action.kind === 'forward') {
      response = { status: 'ok', retcode: 0, data: converter.forwardResult(response.data.self, response.data.forward) };
    }
  } catch (error) {
    response = { status: 'failed', retcode: error.retcode ?? 1500, data: null, message: error.message };
  }
  return { ...response, ...(request && Object.hasOwn(request, 'echo') ? { echo: request.echo } : {}) };
}
