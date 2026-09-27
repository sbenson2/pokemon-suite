#include <DriverKit/IOLib.h>
#include "SuiteUSBProbe.h"
#include "SuiteUSBProbeClient.h"
struct SuiteUSBProbeClient_IVars { SuiteUSBProbe* driver; };
bool SuiteUSBProbeClient::init(){if(!super::init())return false;ivars=IONewZero(SuiteUSBProbeClient_IVars,1);return ivars!=nullptr;}
void SuiteUSBProbeClient::free(){OSSafeReleaseNULL(ivars->driver);IOSafeDeleteNULL(ivars,SuiteUSBProbeClient_IVars,1);super::free();}
kern_return_t SuiteUSBProbeClient::Start_Impl(IOService* provider){
    auto result=Start(provider,SUPERDISPATCH);if(result!=kIOReturnSuccess)return result;
    ivars->driver=OSDynamicCast(SuiteUSBProbe,provider);if(!ivars->driver)return kIOReturnUnsupported;
    ivars->driver->retain();return kIOReturnSuccess;
}
kern_return_t SuiteUSBProbeClient::Stop_Impl(IOService* provider){OSSafeReleaseNULL(ivars->driver);return Stop(provider,SUPERDISPATCH);}
kern_return_t SuiteUSBProbeClient::ExternalMethod(uint64_t selector,IOUserClientMethodArguments* a,const IOUserClientMethodDispatch*,OSObject*,void*){
    if(selector!=0||!a||a->scalarInputCount||a->structureInput||a->structureInputDescriptor||a->completion||
       a->structureOutputDescriptor||a->structureOutputMaximumSize||a->scalarOutputCount!=6||!a->scalarOutput)return kIOReturnBadArgument;
    if(!ivars->driver)return kIOReturnNotReady;
    return ivars->driver->CopyValues(a->scalarOutput,a->scalarOutputCount);
}
