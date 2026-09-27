#include "../Driver/Descriptor.h"
#include <cassert>
int main() {
    const unsigned char descriptor[18] = {18,1,0x10,0x02,0,0,0,64,0x57,0x23,0x2d,0x01,0,2,1,2,3,1};
    unsigned long long values[6] = {};
    assert(suite_probe_descriptor(descriptor,18,values));
    assert(values[0]==0x2357 && values[1]==0x012d && values[2]==0x0210 && values[3]==64 && values[4]==1);
    assert(!suite_probe_descriptor(descriptor,17,values));
    unsigned char wrong[18]; for(int i=0;i<18;i++) wrong[i]=descriptor[i];
    wrong[10]=0x38; assert(!suite_probe_descriptor(wrong,18,values));
    assert(!suite_probe_descriptor(nullptr,18,values));
}
