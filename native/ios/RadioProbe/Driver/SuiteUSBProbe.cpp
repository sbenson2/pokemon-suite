#include <DriverKit/IOLib.h>
#include <USBDriverKit/IOUSBHostDevice.h>
#include <USBDriverKit/USBDriverKitDefs.h>
#include "SuiteUSBProbe.h"
#include "SuiteUSBProbeClient.h"
#include "Descriptor.h"

struct SuiteUSBProbe_IVars { unsigned long long values[6]; bool ready; };
bool SuiteUSBProbe::init() {
    if(!super::init()) return false;
    ivars=IONewZero(SuiteUSBProbe_IVars,1); return ivars!=nullptr;
}
void SuiteUSBProbe::free() { IOSafeDeleteNULL(ivars,SuiteUSBProbe_IVars,1); super::free(); }
kern_return_t SuiteUSBProbe::Start_Impl(IOService* provider) {
    auto result=Start(provider,SUPERDISPATCH); if(result!=kIOReturnSuccess)return result;
    auto device=OSDynamicCast(IOUSBHostDevice,provider); if(!device)return kIOReturnUnsupported;
    const auto descriptor=device->CopyDeviceDescriptor();
    if(!descriptor)return kIOReturnNotReady;
    ivars->ready=suite_probe_descriptor(reinterpret_cast<const unsigned char*>(descriptor),sizeof(*descriptor),ivars->values);
    IOUSBHostFreeDescriptor(descriptor);
    return ivars->ready?RegisterService():kIOReturnUnsupported;
}
kern_return_t SuiteUSBProbe::Stop_Impl(IOService* provider) { ivars->ready=false; return Stop(provider,SUPERDISPATCH); }
kern_return_t SuiteUSBProbe::CopyValues(uint64_t* values,uint32_t count) {
    if(!ivars->ready)return kIOReturnNotReady;
    if(!values||count!=6)return kIOReturnBadArgument;
    for(unsigned i=0;i<6;i++)values[i]=ivars->values[i]; return kIOReturnSuccess;
}
kern_return_t SuiteUSBProbe::NewUserClient_Impl(uint32_t type,IOUserClient** client) {
    if(type!=0||!client)return kIOReturnBadArgument;
    IOService* service=nullptr;auto result=Create(this,"UserClientProperties",&service);
    if(result!=kIOReturnSuccess)return result;
    *client=OSDynamicCast(SuiteUSBProbeClient,service);
    if(!*client){service->release();return kIOReturnUnsupported;}return kIOReturnSuccess;
}
