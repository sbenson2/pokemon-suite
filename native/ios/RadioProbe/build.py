"""Create a development-only iPad USB descriptor probe; no radio transmission."""
import argparse,json,plistlib
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--output',type=Path,required=True)
p.add_argument('--team',required=True)
p.add_argument('--bundle-id',default='org.pokemonsuite.radio-probe')
a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
source=Path(__file__).resolve().parent
def plist(name,value):
    path=out/name;path.write_bytes(plistlib.dumps(value));return str(path)
driver_entitlements=plist('Driver.entitlements',{'com.apple.developer.driverkit':True,'com.apple.security.app-sandbox':True,
    'com.apple.developer.driverkit.transport.usb':[{'idVendor':'*'}]})
app_entitlements=plist('App.entitlements',{'com.apple.developer.driverkit.communicates-with-drivers':True})
driver_info=plist('DriverInfo.plist',{
    'CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleExecutable':'$(EXECUTABLE_NAME)',
    'CFBundleName':'$(PRODUCT_NAME)','CFBundlePackageType':'$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    'CFBundleShortVersionString':'0.1.0','CFBundleVersion':'1',
    'OSBundleUsageDescription':'Read the Archer T3U USB descriptor for the Pokémon Suite mobile compatibility test.',
    'IOKitPersonalities':{'SuiteUSBProbe':{
        'CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleIdentifierKernel':'com.apple.kpi.iokit',
        'IOClass':'IOUserService','IOProviderClass':'IOUSBHostDevice','IOUserClass':'SuiteUSBProbe',
        'IOUserServerName':'$(PRODUCT_BUNDLE_IDENTIFIER)','IOMatchCategory':'$(PRODUCT_BUNDLE_IDENTIFIER)',
        'idVendor':0x2357,'idProduct':0x012d,
        'UserClientProperties':{'IOClass':'IOUserUserClient','IOUserClass':'SuiteUSBProbeClient'}}}})
spec={'name':'SuiteRadioProbe','options':{'deploymentTarget':{'iOS':'17.0'}},
 'settings':{'base':{'DEVELOPMENT_TEAM':a.team,'CODE_SIGN_STYLE':'Automatic','SWIFT_VERSION':'5.0'}},
 'targets':{
  'SuiteRadioProbe':{'type':'application','platform':'iOS','sources':[str(source/'App')],
   'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':a.bundle_id,'GENERATE_INFOPLIST_FILE':'YES',
     'INFOPLIST_KEY_CFBundleDisplayName':'Suite Radio Probe','INFOPLIST_KEY_UILaunchScreen_Generation':'YES',
     'INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','TARGETED_DEVICE_FAMILY':'2',
     'CODE_SIGN_ENTITLEMENTS':app_entitlements,'CURRENT_PROJECT_VERSION':'1','MARKETING_VERSION':'0.1.0',
     'SWIFT_OBJC_BRIDGING_HEADER':str(source/'App/Probe-Bridging-Header.h')}},
   'dependencies':[{'sdk':'IOKit.framework'},{'target':'SuiteUSBProbe','embed':True,'link':False,'codeSign':False}]},
  'SuiteUSBProbe':{'type':'driver-extension','platform':'macOS','sources':[str(source/'Driver')],
   'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':a.bundle_id+'.driver','SDKROOT':'driverkit',
     'SUPPORTED_PLATFORMS':'driverkit','DRIVERKIT_DEPLOYMENT_TARGET':'23.0','CODE_SIGN_ENTITLEMENTS':driver_entitlements,
     'INFOPLIST_FILE':driver_info,'CLANG_CXX_LANGUAGE_STANDARD':'c++17','SKIP_INSTALL':'YES','GENERATE_INFOPLIST_FILE':'NO'}},
   'dependencies':[{'sdk':'DriverKit.framework'},{'sdk':'USBDriverKit.framework'}]}},
 'schemes':{'SuiteRadioProbe':{'build':{'targets':{'SuiteRadioProbe':'all'}}}}}
(out/'project.json').write_text(json.dumps(spec,indent=2)+'\n')
print(out/'project.json')
