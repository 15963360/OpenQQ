'use strict';

let observer;
let registration;
let addon;

function instrument(runtime, config) {
  const normalize = path => path.replaceAll('\\', '/').toLowerCase();
  const expectedWrapper = normalize(config.wrapper);
  const api = (name, args) => new NativeFunction(runtime.getExportByName(name), 'int', args, { exceptions: 'propagate' });
  const getGlobal = api('napi_get_global', ['pointer', 'pointer']);
  const setProperty = api('napi_set_named_property', ['pointer', 'pointer', 'pointer', 'pointer']);
  const makeString = api('napi_create_string_utf8', ['pointer', 'pointer', 'uint64', 'pointer']);
  const runScript = api('napi_run_script', ['pointer', 'pointer', 'pointer']);
  const openScope = api('napi_open_escapable_handle_scope', ['pointer', 'pointer']);
  const closeScope = api('napi_close_escapable_handle_scope', ['pointer', 'pointer']);
  const escape = api('napi_escape_handle', ['pointer', 'pointer', 'pointer', 'pointer']);
  const isPending = api('napi_is_exception_pending', ['pointer', 'pointer']);
  const clearException = api('napi_get_and_clear_last_exception', ['pointer', 'pointer']);
  const check = result => { if (result !== 0) throw new Error(`N-API 返回 ${result}`); };
  send({ stage: 'runtime_found', name: runtime.name, pid: Process.id });

  registration = Interceptor.attach(runtime.getExportByName('qq_magic_napi_register'), {
    onEnter(args) {
      try {
        // napi_module x64: version/flags, filename, register callback, module name.
        const module = args[0];
        if (module.isNull()) return;
        const namePtr = module.add(24).readPointer();
        const name = namePtr.isNull() ? '' : namePtr.readUtf8String();
        const callback = module.add(16).readPointer();
        const owner = callback.isNull() ? null : Process.findModuleByAddress(callback);
        const target = owner !== null && normalize(owner.path) === expectedWrapper;
        send({ stage: 'addon_register', name, owner: owner?.name ?? null, target });
        if (!target || addon) return;
        addon = Interceptor.attach(callback, {
          onEnter(values) { this.env = values[0]; this.exports = values[1]; },
          onLeave(returned) {
            const env = this.env;
            const pending = Memory.alloc(1);
            let scope;
            let introducedException = false;
            try {
              check(isPending(env, pending));
              if (pending.readU8()) throw new Error('wrapper 原始初始化已抛出异常');
              introducedException = true;
              const scopeOut = Memory.alloc(Process.pointerSize);
              check(openScope(env, scopeOut));
              scope = scopeOut.readPointer();
              const globalOut = Memory.alloc(Process.pointerSize);
              check(getGlobal(env, globalOut));
              const global = globalOut.readPointer();
              check(setProperty(env, global, Memory.allocUtf8String('__openqq_exports'), returned.isNull() ? this.exports : returned));
              const source = `(() => { const load = typeof require === 'function' ? require : process.getBuiltinModule?.('module')?.createRequire(process.execPath) ?? process.mainModule?.require.bind(process.mainModule); if (!load) throw new Error('QQ 没有可用 CommonJS 入口'); try { return load(${JSON.stringify(config.payload)}).startNative(${JSON.stringify({ pipe: config.pipe, token: config.token })}, globalThis.__openqq_exports); } finally { delete globalThis.__openqq_exports; } })()`;
              const sourceOut = Memory.alloc(Process.pointerSize);
              check(makeString(env, Memory.allocUtf8String(source), uint64('0xffffffffffffffff'), sourceOut));
              const resultOut = Memory.alloc(Process.pointerSize);
              check(runScript(env, sourceOut.readPointer(), resultOut));
              const escapedOut = Memory.alloc(Process.pointerSize);
              check(escape(env, scope, resultOut.readPointer(), escapedOut));
              returned.replace(escapedOut.readPointer());
              send({ stage: 'bootstrapped', pid: Process.id });
            } catch (error) {
              // Clear only exceptions introduced by our script, preserving QQ's own failure.
              if (introducedException) {
                try { check(isPending(env, pending)); if (pending.readU8()) clearException(env, Memory.alloc(Process.pointerSize)); } catch {}
              }
              send({ stage: 'error', error: String(error) });
            } finally {
              if (scope) closeScope(env, scope);
              addon?.detach();
              registration?.detach();
            }
          },
        });
      } catch (error) { send({ stage: 'error', error: String(error) }); }
    },
  });
}

rpc.exports = {
  watch(config) {
    if (Process.pointerSize !== 8) throw new Error('仅支持 x64 QQ');
    if (typeof config.wrapper !== 'string' || !config.wrapper) throw new Error('缺少目标 wrapper.node 路径');
    let found = false;
    observer = Process.attachModuleObserver({
      onAdded(module) {
        if (module.name.toLowerCase() !== 'qqnt.dll' || found) return;
        found = true;
        observer?.detach();
        observer = null;
        try { instrument(module, config); }
        catch (error) { send({ stage: 'error', error: String(error) }); }
      },
    });
    return { watching: true };
  },
};
