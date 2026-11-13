#include <windows.h>
#include <fstream>
#include <string>
#include <cstdint>
#include <cstring>

using callback = void* (*)(void*, void*);
struct napi_module {
    int version; unsigned flags; const char* filename; callback init;
    const char* name; void* priv; void* reserved[4];
};
static_assert(offsetof(napi_module, init) == 16);
static_assert(offsetof(napi_module, name) == 24);

#ifdef FIXTURE_HOST
__declspec(noinline) static void* decoy_init(void*, void* exports) { Sleep(1); return exports; }
int main(int argc, char**) {
    if (argc != 1) return 9;
    auto module = LoadLibraryW(L"QQNT.dll");
    if (!module) return 2;
    auto run = reinterpret_cast<void (*)(callback)>(GetProcAddress(module, "RunFixture"));
    if (!run) return 3;
    run(decoy_init);
    Sleep(15000);
    return 0;
}
#else
#define API extern "C" __declspec(dllexport)
static int global_object;
static int facade_object;
static bool scope_closed;
static std::string script_source;
API int napi_get_global(void*, void** out) { *out = &global_object; return 0; }
API int napi_set_named_property(void*, void*, const char*, void*) { return 0; }
API int napi_create_string_utf8(void*, const char* data, uint64_t size, void** out) {
    script_source.assign(data, size == UINT64_MAX ? strlen(data) : size);
    *out = &script_source; return 0;
}
API int napi_run_script(void*, void*, void** out) {
    if (global_object != 2) return 1;
    char path[32768];
    if (!GetEnvironmentVariableA("OPENQQ_FIXTURE_OUTPUT", path, sizeof(path))) return 1;
    std::ofstream(path) << script_source;
    *out = &facade_object;
    return 0;
}
API int napi_open_escapable_handle_scope(void*, void** out) { *out = &global_object; return 0; }
API int napi_close_escapable_handle_scope(void*, void*) { scope_closed = true; return 0; }
API int napi_escape_handle(void*, void*, void* value, void** out) { *out = value; return 0; }
API int napi_is_exception_pending(void*, bool* out) { *out = false; return 0; }
API int napi_get_and_clear_last_exception(void*, void** out) { *out = nullptr; return 0; }
API void qq_magic_napi_register(napi_module* module) { global_object += module->version; }
__declspec(noinline) static void* initialize(void*, void* exports) { global_object++; Sleep(1); return exports; }
API void RunFixture(callback decoy) {
    napi_module unrelated = {0, 0, "fixture-decoy.node", decoy, "wrapper", nullptr, {}};
    qq_magic_napi_register(&unrelated);
    unrelated.init(&global_object, &global_object);
    napi_module module = {1, 0, "fixture-wrapper.node", initialize, "QQNT", nullptr, {}};
    qq_magic_napi_register(&module);
    auto result = module.init(&global_object, &global_object);
    char path[32768];
    if (GetEnvironmentVariableA("OPENQQ_FIXTURE_OUTPUT", path, sizeof(path))) {
        std::ofstream(std::string(path) + ".return") << (result == &facade_object && scope_closed ? "escaped replacement" : "invalid return");
    }
}
#endif
