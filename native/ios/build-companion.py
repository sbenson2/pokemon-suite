#!/usr/bin/env python3
"""Generate the native companion target; no emulator, ROM or save is bundled."""
import argparse,json,subprocess,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--team',default='');p.add_argument('--bundle-id',default='org.pokemonsuite.mobile');args=p.parse_args()
root=Path(__file__).resolve().parents[2];out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
shared=root/'macos/Sources/PokemonSuiteMac'
icons=out/'Assets.xcassets/AppIcon.appiconset';icons.mkdir(parents=True,exist_ok=True)
subprocess.run(['swift',str(root/'macos/Assets/Icon.swift'),str(out/'original-icon'),'--ios'],check=True)
shutil.copy2(out/'original-icon/icon_512x512@2x.png',icons/'AppIcon.png')
(icons/'Contents.json').write_text(json.dumps({'images':[{'filename':'AppIcon.png','idiom':'universal','platform':'ios','size':'1024x1024'}],'info':{'author':'xcode','version':1}}))
spec={'name':'PokemonSuiteCompanion','options':{'deploymentTarget':{'iOS':'17.0'}},
 'settings':{'base':{'SWIFT_VERSION':'5.0','DEVELOPMENT_TEAM':args.team,'TARGETED_DEVICE_FAMILY':'1,2','GENERATE_INFOPLIST_FILE':'YES','CODE_SIGN_STYLE':'Automatic',
 'MARKETING_VERSION':'0.2.0','CURRENT_PROJECT_VERSION':'29','INFOPLIST_KEY_CFBundleDisplayName':'Pokémon Suite','INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','INFOPLIST_KEY_UILaunchScreen_Generation':'YES',
 'INFOPLIST_KEY_NSLocalNetworkUsageDescription':'Connect to Pokémon Suite on your Mac to view games, control the bot and prepare trades.',
 'INFOPLIST_KEY_NSMicrophoneUsageDescription':'Hear the request you speak to the bot after you tap the microphone in Ask the bot.',
 'INFOPLIST_KEY_NSSpeechRecognitionUsageDescription':'Turn your spoken bot request into text on this device. Your voice is never sent to a server.',
 'INFOPLIST_KEY_UIFileSharingEnabled':'YES','INFOPLIST_KEY_LSSupportsOpeningDocumentsInPlace':'YES',
 'INFOPLIST_KEY_UISupportedInterfaceOrientations':'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'}},
 'targets':{
 'SuiteCore':{'type':'framework','platform':'iOS','sources':[{'path':str(root/'macos/Sources/SuiteCore')}],'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':args.bundle_id+'.core'}}},
 'PokemonSuiteCompanion':{'type':'application','platform':'iOS','sources':[{'path':str(root/'native/ios/Companion')},{'path':str(out/'Assets.xcassets')}]+[{'path':str(shared/name)} for name in ['GamePlayback.swift','BotView.swift','BotProgressView.swift','ActivityContent.swift','EffortTrainingForm.swift','HuntDetailView.swift','CompetitiveBuildView.swift','FarmingView.swift','HuntingDefaultsForm.swift','SpeciesChooser.swift','BotAskView.swift','SpeechDictation.swift','BankGetItView.swift','CompetitiveBuilderView.swift']],
 # iOS 17+ applies ATS system trust to the Tailscale CGNAT range before our
 # exact certificate pin. This scoped exception enables that manual trust
 # check; SuitePairing still requires HTTPS and the relay requires TLS 1.2+.
 'info':{'path':str(out/'Info.plist'),'properties':{'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True,'NSExceptionDomains':{'100.64.0.0/10':{'NSExceptionAllowsInsecureHTTPLoads':True,'NSExceptionMinimumTLSVersion':'TLSv1.2'}}},'UILaunchScreen':{},'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False}}},
 'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':args.bundle_id,'ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon'}},'dependencies':[{'target':'SuiteCore'},{'sdk':'SceneKit.framework'},{'sdk':'AVFoundation.framework'},{'sdk':'Speech.framework'}]},
 'SuiteCompanionUITests':{'type':'bundle.ui-testing','platform':'iOS','sources':[{'path':str(root/'native/ios/CompanionUITests')}],'dependencies':[{'target':'PokemonSuiteCompanion'}],'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':args.bundle_id+'.uitests','TEST_TARGET_NAME':'PokemonSuiteCompanion'}}},
 'SuiteCompanionTests':{'type':'bundle.unit-test','platform':'iOS','sources':[{'path':str(root/'native/ios/CompanionTests')}],'dependencies':[{'target':'PokemonSuiteCompanion'}],'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':args.bundle_id+'.tests','TEST_HOST':'$(BUILT_PRODUCTS_DIR)/PokemonSuiteCompanion.app/PokemonSuiteCompanion','BUNDLE_LOADER':'$(TEST_HOST)'}}}},
 'schemes':{'PokemonSuiteCompanion':{'build':{'targets':{'PokemonSuiteCompanion':'all'}},'test':{'targets':['SuiteCompanionUITests','SuiteCompanionTests']}}}}
(out/'project.json').write_text(json.dumps(spec,indent=2))
print(out/'project.json')
