#pragma once
#include <windows.h>
#include <cstdint>

using AddonInit = void* (*)(void*, void*);
struct BootstrapConfig {
    AddonInit original;
    HMODULE runtime;
    const char* source;
    LONG status;
    char error[256];
};
static_assert(sizeof(void*) == 8, "OpenQQ requires Windows x64");
