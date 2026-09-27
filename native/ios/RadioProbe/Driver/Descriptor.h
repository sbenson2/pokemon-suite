#pragma once
#include <stddef.h>
// Only the exact tested adapter is eligible. No radio initialization or writes.
inline bool suite_probe_descriptor(const unsigned char* bytes, size_t size, unsigned long long* values) {
    if(!bytes || !values || size<18 || bytes[0]!=18 || bytes[1]!=1) return false;
    const auto u16=[&](size_t at){return unsigned(bytes[at])|(unsigned(bytes[at+1])<<8);};
    if(u16(8)!=0x2357 || u16(10)!=0x012d) return false;
    values[0]=u16(8); values[1]=u16(10); values[2]=u16(2);
    values[3]=bytes[7]; values[4]=bytes[17]; values[5]=u16(12);
    return true;
}
