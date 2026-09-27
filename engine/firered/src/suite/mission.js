import {SnorlaxMission} from './snorlax-mission.js';
import {SafariMission} from './safari-mission.js';
import {WildMission} from './wild-mission.js';
import {GiftMission} from './gift-mission.js';
import {StaticMission} from './static-mission.js';
import {RoamerMission} from './roamer-mission.js';

export const createSuiteMission=args=>(args.route?.method??args.state?.method)==='roamer'?new RoamerMission(args):(args.route?.method??args.state?.method)==='static'?new StaticMission(args):(args.route?.method??args.state?.method)==='gift'?new GiftMission(args):args.request.speciesId===143?new SnorlaxMission(args):args.route||args.state?.route?.method?new WildMission(args):new SafariMission(args);

export function assertHuntHandoff(o,previous,wireless,continuation=null){
 if(o.phase!=='stable'||o.emulator.inBattle||o.emulator.mode!=='overworld'||o.playerMemory.trainer?.partyValidity!=='valid')throw new Error('Finish the current battle or menu before starting the next hunt. A stable game is required.');
 if(wireless.remotePlayers!==0)throw new Error('The active link must finish before starting another hunt.');
 if(previous?.protected&&!(previous.nativeTrade?.completion?.nativeSaveVerified&&['complete','saved-exit-incomplete'].includes(continuation))&&previous.status!=='complete')throw new Error('The protected encounter must be caught and saved before starting another hunt.');
}
