import XCTest
@testable import SuiteCore

final class ActivityPresentationTests: XCTestCase {
    func testPostgameStopUsesTheHuntReasonInsteadOfCompletedStoryCopy() {
        var s=session
        s["bot"]["runScope"] = .string("postgame")
        s["campaign"]["reason"] = .string("The team entered the Hall of Fame.")
        s["mission"] = value(#"{"state":"blocked","name":"Entei","reason":"Roaming hunt budget reached. The current save is preserved."}"#)
        XCTAssertEqual(present(s).why,"Roaming hunt budget reached. The current save is preserved.")
    }
    func testAFinishedHuntIsNotShownAsTheGoalOfTheNextTask() {
        // Sept 27: while a player task walked to hatch an Egg, the Session card showed the finished Dex hunt
        // ("delibird", state complete) as its Goal.
        let s = value(#"{"sessionId":"live","state":"running","bot":{"enabled":true,"runScope":"task","activity":"postgame","status":"running","objective":{"id":"acquire-postgame-egg-sticker-hatch"}},"mission":{"state":"complete","name":"delibird"}}"#)
        XCTAssertNil(present(s).headline)
        var labelled = s
        labelled["bot"]["objective"]["label"] = .string("Complete remaining postgame objectives")
        XCTAssertEqual(present(labelled).headline, "Complete remaining postgame objectives")
        var running = s
        running["mission"]["state"] = .string("running")
        XCTAssertEqual(present(running).headline, "delibird", "a hunt that is still running remains the goal")
    }
    func testReleasingEggStickerHatchlingsReadsAsItsOwnGoalAndActions() {
        // Sept 27: a full PC stopped postgame; the owner now releases the Egg sticker's own hatchlings.
        let s = value(#"{"sessionId":"live","state":"running","bot":{"enabled":true,"runScope":"postgame","activity":"postgame","status":"running","objective":{"id":"acquire-postgame-pc-release-64604996-release-3","label":"Releasing Egg-sticker hatchlings to free PC space","target":{"kind":"party-roster","map":"MAP_FOUR_ISLAND_POKEMON_CENTER_1F"}}},"decision":{"kind":"act","recommendation":{"kind":"confirm-storage-release","targetOption":"yes","targetIndex":0,"objective":"acquire-postgame-pc-release-64604996-release-3"}},"winner":{"constraints":["observed-pokemon-storage","release-egg-sticker-hatchling"]},"postgame":{"active":"pc-release","entries":[{"id":"egg-sticker","label":"Earn the final Egg sticker","status":"pending"},{"id":"pc-release","label":"Free PC space by releasing Egg-sticker hatchlings","status":"pending","conditional":true}]}}"#)
        let p = present(s)
        XCTAssertEqual(p.goal, "Free PC space by releasing Egg-sticker hatchlings")
        XCTAssertEqual(p.now, "Releasing the selected Egg-sticker hatchling")
        XCTAssertEqual(p.why, "Releasing Egg-sticker hatchlings to free PC space.")
        XCTAssertFalse(p.needsAttention)
        var menu = s
        menu["decision"]["recommendation"] = value(#"{"kind":"choose-storage-menu-action","targetAction":"release","targetIndex":4}"#)
        XCTAssertEqual(present(menu).now, "Choosing Release for the boxed Pokémon")
        var refused = s
        refused["decision"]["recommendation"] = value(#"{"kind":"confirm-storage-release","targetOption":"no","targetIndex":1}"#)
        XCTAssertEqual(present(refused).now, "Keeping the Pokémon: its release was not verified")
        var message = s
        message["decision"]["recommendation"] = value(#"{"kind":"acknowledge-storage-message","message":"bye-bye"}"#)
        XCTAssertEqual(present(message).now, "Advancing the PC message")
    }
    func testRoamerSearchExplainsIntentionalCrossingsAndUsesLiveDestination() {
        let s = value(#"{"sessionId":"live","state":"running","bot":{"enabled":true,"runScope":"postgame","activity":"task"},"mission":{"state":"running","name":"Entei","method":"roamer","phase":"tracking","encounters":0,"route":"MAP_ONE_ISLAND_POKEMON_CENTER_1F"},"decision":{"recommendation":{"kind":"move-toward","objective":"track-entei","targetMap":"MAP_ROUTE1"}},"postgame":{"active":"roamer","entries":[{"id":"roamer","label":"Catch the roaming legendary","status":"pending"}],"progress":{"completed":29,"total":57}}}"#)
        let p = present(s)
        XCTAssertEqual(p.now, "Tracking Entei")
        XCTAssertTrue(p.why?.contains("Pallet Town and Route 1") == true)
        XCTAssertEqual(p.destination, "Route 1")
        XCTAssertTrue(p.facts.contains { $0.label == "Encounters" && $0.value == "0" })
        XCTAssertTrue(p.facts.contains { $0.label == "Postgame goals" && $0.value == "29 / 57" })
        XCTAssertFalse(p.needsAttention)
    }
    func testDeferredHuntDoesNotHideCurrentPostgameTask() {
        let s = value(#"{"sessionId":"live","state":"running","bot":{"enabled":true,"runScope":"postgame","activity":"postgame","objective":{"id":"postgame-togepi-hatch","target":{"kind":"friendship-walk"}}},"mission":{"state":"blocked","name":"Moltres","reason":"repeated-navigation-cycle"},"postgame":{"active":"togepi","entries":[{"id":"togepi","label":"Receive and hatch Togepi","status":"pending"},{"id":"moltres","label":"Catch Moltres","status":"pending","retry":{"reason":"repeated-navigation-cycle","attempts":1}}]}}"#)
        let p = present(s)
        XCTAssertEqual(p.now, "Walking to hatch Togepi")
        XCTAssertEqual(p.goal, "Receive and hatch Togepi")
        XCTAssertFalse(p.needsAttention)
        XCTAssertTrue(p.facts.contains { $0.label.contains("Deferred") && $0.value.contains("Moltres") && $0.value.contains("route") })
    }
    func testUnsupportedNavigationIsExplainedAsWaitingNotHealthyMovement() {
        var s = session
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"wait-for-supported-objective"}}"#)
        let p = present(s)
        XCTAssertTrue(p.needsAttention)
        XCTAssertTrue(p.now.contains("route"))
        XCTAssertTrue(p.why?.contains("next action") == true)
    }
    private func value(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private var session: JSONValue { value(#"{"sessionId":"test","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","bot":{"enabled":true,"runScope":"campaign"},"campaign":{"storyProgress":{"current":{"id":"badge-thunder","label":"Defeat Lt. Surge","detail":"Win the Gym battle."},"next":{"label":"Receive the Bike Voucher"}},"supervision":{"elapsedMs":120000}},"spectator":{"map":{"name":"Rock Tunnel"},"party":[{"slot":0,"speciesId":15,"speciesName":"Beedrill","hp":0,"maxHp":77,"level":27}]}}"#) }
    private func present(_ s: JSONValue, now: Double = 1002) -> ActivityPresentation { ActivityPresentation(session: s, now: Date(timeIntervalSince1970: now)) }

    func testRecoveryExplainsImmediateDetourAndReturnToStoryGoal() {
        var s = session
        s["campaign"]["task"] = value(#"{"kind":"recovery","phase":"travel","objective":{"target":{"map":"MAP_ROUTE10_POKEMON_CENTER_1F"}}}"#)
        let p = present(s)
        XCTAssertTrue(p.now.contains("Pokémon Center")); XCTAssertTrue(p.why?.contains("Beedrill") == true)
        XCTAssertTrue(p.why?.contains("fainted") == true); XCTAssertTrue(p.next?.contains("Lt. Surge") == true)
        XCTAssertEqual(p.goal, "Defeat Lt. Surge")
    }
    func testBattleDuringRecoveryDoesNotClaimItIsWalking() {
        var s = session; s["mode"] = .string("battle")
        s["campaign"]["task"] = value(#"{"kind":"recovery","objective":{"target":{"map":"MAP_ROUTE10_POKEMON_CENTER_1F"}}}"#)
        XCTAssertTrue(present(s).now.contains("battle")); XCTAssertTrue(present(s).next?.contains("Pokémon Center") == true)
    }
    func testShoppingExplainsMedicineDetourInsteadOfOnlyShowingGymGoal() {
        var s = session
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"move-toward","objective":"battle-medicine:badge-thunder:MAP_LAVENDER_TOWN_MART","targetMap":"MAP_LAVENDER_TOWN_MART","remainingSteps":31}}"#)
        let p = present(s)
        XCTAssertTrue(p.now.contains("Lavender")); XCTAssertTrue(p.why?.contains("medicine") == true)
        XCTAssertTrue(p.facts.contains { $0.label == "Route remaining" && $0.value.contains("31") })
    }
    func testMovesUseSelectedGamesCatalogAndDoNotInventDamageOrTypeMultipliers() {
        var s = session; s["mode"] = .string("battle")
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"choose-battle-move","targetMoveId":55,"expectedUtility":68.5}}"#)
        s["winner"] = value(#"{"constraints":["positive-pp","observed-active-battlers"],"evidenceRefs":["cartridge:move:55"]}"#)
        let p = ActivityPresentation(session:s, catalog:value(#"{"moves":[{"id":55,"name":"Water Gun"}]}"#), now:Date(timeIntervalSince1970:1002))
        XCTAssertEqual(p.now,"Using Water Gun")
        XCTAssertFalse(p.why?.contains("68") == true); XCTAssertFalse(p.why?.contains("super effective") == true)
        XCTAssertTrue(p.why?.contains("available moves") == true)
    }
    func testTransitionSamplesDoNotTurnAnOldMoveIntoCurrentActivity() {
        var s = session; s["mode"] = .string("battle")
        s["decision"] = value(#"{"kind":"resample","reason":"transition"}"#)
        s["decisionFeed"]["entries"] = value(#"[{"id":"old","mode":"battle","lastFrame":99,"updatedAt":"1970-01-01T00:16:39Z","decision":{"kind":"act","recommendation":{"kind":"choose-battle-move","targetMoveId":55}}}]"#)
        let p = present(s); XCTAssertFalse(p.now.contains("Move 55")); XCTAssertFalse(p.now.contains("transition"))
        XCTAssertEqual(p.decisions.count,1); XCTAssertTrue(p.decisions[0].title.contains("55"))
    }
    func testStaleConnectionKeepsLastKnownContextWithoutCallingGameStopped() {
        let p = present(session,now:1045)
        XCTAssertEqual(p.status,"Waiting for telemetry"); XCTAssertTrue(p.stale)
        XCTAssertFalse(p.now.contains("stopped")); XCTAssertEqual(p.goal,"Defeat Lt. Surge")
    }
    func testPausedManualReadyAndBlockedTakePrecedenceOverOldActions() {
        var s = session; s["bot"]["enabled"] = .bool(false)
        XCTAssertEqual(present(s).status,"Bot paused")
        s["control"]["mode"] = .string("manual"); XCTAssertEqual(present(s).status,"Manual play")
        s["control"] = .null; s["bot"]["awaitingCommand"] = .bool(true)
        XCTAssertEqual(present(s).status,"Ready for a command")
        s["campaign"]["status"] = .string("blocked"); s["campaign"]["reason"] = .string("No safe route to the Pokémon Center.")
        XCTAssertTrue(present(s).needsAttention); XCTAssertEqual(present(s).why,"No safe route to the Pokémon Center.")
    }
    func testMissingTelemetryAndCountersAreNotInventedZeros() {
        let p = present(.null)
        XCTAssertEqual(p.status,"No game loaded"); XCTAssertTrue(p.metrics.isEmpty)
        var s=session; s["spectator"]["progress"]["captures"] = .number(0)
        XCTAssertEqual(present(s).metrics.first { $0.label == "Captures" }?.value,"0")
        XCTAssertNil(present(s).metrics.first { $0.label == "Battles" })
    }
    func testTrainingShowsIndividualLevelGateAndSeparateMeasuredRate() {
        var s=session
        s["campaign"]["task"] = value(#"{"kind":"training","objective":{"trainingSpecies":15,"trainingPartySlot":0,"minimumTeamAnchorLevel":28,"target":{"map":"MAP_ROUTE11"}}}"#)
        s["campaign"]["training"] = value(#"{"species":15,"estimatedXpPerMinute":320,"measuredXpPerMinute":210}"#)
        let p=present(s)
        XCTAssertTrue(p.now.contains("Beedrill")); XCTAssertTrue(p.why?.contains("28") == true)
        XCTAssertTrue(p.facts.contains { $0.label == "Measured XP/min" && $0.value == "210" })
        XCTAssertTrue(p.facts.contains { $0.label == "Estimated XP/min" && $0.value == "320" })
    }
    func testProtectedShinyAndTradeCompletionHaveSpecificNextSteps() {
        var s=session; s["campaign"] = .null
        s["mission"] = value(#"{"state":"running","name":"Chansey","shiny":"required","phase":"capturing","protected":true,"encounters":34,"elapsedMs":91000,"rng":{"method":"wild-land"}}"#)
        let hunt=present(s); XCTAssertTrue(hunt.now.contains("Chansey")); XCTAssertTrue(hunt.next?.contains("save") == true)
        XCTAssertTrue(hunt.facts.contains { $0.label == "Shiny protection" })
        s["tradeTask"] = value(#"{"phase":"exchanging","exchangeStarted":true,"reason":"Waiting for both games to finish the exchange."}"#)
        let trade=present(s); XCTAssertTrue(trade.now.lowercased().contains("trade")); XCTAssertTrue(trade.why?.contains("both games") == true)
    }
    func testHistoryOmitsNeutralSamplesGroupsRepeatedActionsAndUsesUniqueIDs() {
        var s=session
        s["decisionFeed"]["entries"] = value(#"[{"id":"1","map":"MAP_ROUTE1","decision":{"kind":"act","recommendation":{"kind":"move-toward","targetMap":"MAP_PALLET_TOWN"}}},{"id":"2","decision":{"kind":"resample","reason":"transition"}},{"id":"3","map":"MAP_ROUTE1","decision":{"kind":"act","recommendation":{"kind":"move-toward","targetMap":"MAP_PALLET_TOWN"}}}]"#)
        let p=present(s); XCTAssertEqual(p.decisions.count,1); XCTAssertEqual(p.decisions[0].repeats,2)
    }
    func testEVAndStorageUseActualReadbackAndDoNotClaimOnlineReadiness() {
        var s=session; s["campaign"] = .null
        s["bot"]["preparation"] = value(#"{"kind":"ev-training","phase":"training","progress":{"current":{"speed":8},"target":{"speed":252}}}"#)
        s["storage"] = value(#"{"known":true,"pcUsed":415,"pcCapacity":420,"free":5,"reserveSlots":4,"captureBudget":1}"#)
        let p=present(s)
        XCTAssertTrue(p.facts.contains { $0.label == "Speed EVs" && $0.value == "8 / 252" })
        XCTAssertTrue(p.facts.contains { $0.label == "PC boxes" && $0.value == "415 / 420" })
        XCTAssertFalse(p.now.contains("online"))
    }
    func testNativeTrainingContextNamesTheCommittedIndividualWithoutAssumingTheLead() {
        var s=session
        s["campaign"]["task"] = value(#"{"kind":"training","member":"[8,9]","minimumLevel":28,"targetLevel":44}"#)
        s["spectator"]["strategy"]["training"] = value(#"{"pokemon":{"name":"Exeggcute","level":27,"slot":4,"experienceRemaining":1614},"nextLevel":28,"targetLevel":44}"#)
        let p=present(s)
        XCTAssertEqual(p.now,"Training Exeggcute"); XCTAssertTrue(p.why?.contains("28") == true)
        XCTAssertTrue(p.facts.contains { $0.label == "Preparation target" && $0.value.contains("44") })
        s["spectator"]["strategy"]["training"] = .null
        let older=present(s)
        XCTAssertFalse(older.now.contains("Beedrill")); XCTAssertTrue(older.why?.contains("28") == true)
    }
    func testResampleDoesNotUseAStaleWinnerAndUnknownActionsRemainHonest() {
        var s=session;s["mode"] = .string("battle");s["decision"] = value(#"{"kind":"resample","reason":"transition"}"#)
        s["winner"] = value(#"{"recommendation":{"kind":"choose-battle-move","targetMoveId":55}}"#)
        XCTAssertFalse(present(s).now.contains("55"))
    }
    func testCompletedEvolutionDoesNotReplaceCurrentActionAndTradeFailureIsActionable() {
        var s=session;s["localEvolution"] = value(#"{"phase":"complete","reason":"Returned and saved."}"#)
        XCTAssertFalse(present(s).now.contains("evolution"))
        s["tradeTask"] = value(#"{"phase":"trade-outcome-unresolved","reason":"The final save handshake is not verified.","exchangeStarted":true}"#)
        let p=present(s);XCTAssertTrue(p.needsAttention);XCTAssertEqual(p.why,"The final save handshake is not verified.")
    }
    func testPCMenusAndSaveTasksExplainTheActualOperation() {
        var s=session;s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"choose-storage-box","targetBox":4}}"#)
        XCTAssertEqual(present(s).now,"Opening PC Box 5")
        s["campaign"] = .null;s["decision"] = .null;s["bot"]["preparation"] = value(#"{"kind":"save","phase":"working"}"#)
        XCTAssertTrue(present(s).now.contains("Saving"));XCTAssertTrue(present(s).next?.contains("Verify") == true)
    }
    func testTrainingNextStepUsesRotationOrFollowingCheckpointInsteadOfRepeatingTraining() {
        var s=session
        s["campaign"]["task"] = value(#"{"kind":"training","minimumLevel":28,"targetLevel":44,"rotation":"one-level"}"#)
        XCTAssertTrue(present(s).next?.contains("Recheck") == true)
        s["campaign"]["task"]["rotation"] = .null
        s["campaign"]["storyProgress"]["current"] = value(#"{"id":"master-native-103-evolve-train","label":"Master Native 103 Evolve Train"}"#)
        s["campaign"]["storyProgress"]["next"] = value(#"{"label":"Use the Leaf Stone"}"#)
        XCTAssertEqual(present(s).next,"Use the Leaf Stone")
    }
    // Captured postgame telemetry shape: the evolution is carried by the dex
    // objective, while preparation still says postgame/national-dex.
    private var dexEvolutionSession: JSONValue {
        value(#"{"sessionId":"live","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"battle","bot":{"enabled":true,"status":"recovering","runScope":"postgame","activity":"postgame","objective":{"identityEvolution":true,"coreSpecies":[48],"target":{"kind":"map"}},"preparation":{"kind":"postgame","phase":"national-dex","requestId":"dex-example","progress":{"level":26,"required":31,"friendship":81}},"progress":{"status":"temporarily-blocked","reason":"Wait for the current game interaction to finish."}},"decision":{"kind":"resample","reason":"Waiting for the evolution observation."},"postgame":{"active":"national-collection","entries":[{"id":"national-collection","label":"Complete the National Pokédex"}],"workflows":{"dex":{"target":{"speciesId":49,"method":"evolution"}}},"collection":[{"speciesId":49,"name":"venomoth","fromSpecies":48,"method":"evolution"}]},"spectator":{"party":[{"speciesId":22,"speciesName":"Fearow","level":93},{"speciesId":48,"speciesName":"Venonat","level":26}]}}"#)
    }
    func testPostgameEvolutionWaitExplainsTheAssignedPokemonAndMeasuredLevel() {
        let p=present(dexEvolutionSession)
        XCTAssertTrue(p.goal?.contains("Venonat") == true)
        XCTAssertTrue(p.goal?.contains("Venomoth") == true)
        XCTAssertTrue(p.facts.contains { $0.label == "Evolution level" && $0.value == "26 / 31" })
        XCTAssertTrue(p.why?.contains("31") == true)
        XCTAssertFalse(p.why?.contains("not published") == true)
        XCTAssertEqual(p.status,"In battle")
        XCTAssertEqual(p.now,"Training battle in progress")
        XCTAssertFalse(p.needsAttention)
        XCTAssertFalse(p.now.contains("Fearow"))
    }
    func testFriendshipRequirementIsNotMislabeledAsALevelAndThresholdIsNotCompletion() {
        var s=dexEvolutionSession;s["mode"] = .string("overworld")
        s["bot"]["objective"]["target"]["kind"] = .string("friendship-walk")
        s["bot"]["preparation"]["progress"] = value(#"{"friendship":177,"required":220}"#)
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"move-toward"}}"#)
        let p=present(s)
        XCTAssertTrue(p.now.lowercased().contains("walking"))
        XCTAssertTrue(p.facts.contains { $0.label == "Friendship" && $0.value == "177 / 220" })
        XCTAssertFalse(p.facts.contains { $0.label == "Evolution level" })
        s["bot"]["preparation"]["progress"] = value(#"{"level":31,"required":31,"friendship":90}"#)
        s["bot"]["objective"]["target"]["kind"] = .string("map")
        let reached=present(s)
        XCTAssertFalse(reached.status.lowercased().contains("complete"))
        XCTAssertFalse(reached.now.lowercased().contains("saved"))
        XCTAssertTrue(reached.next?.lowercased().contains("verify") == true)
    }
    func testRecoveryRequiresExplicitRecoveryEvidenceAndRetainsItsReason() {
        var s=dexEvolutionSession
        s["bot"]["reason"] = .string("Rechecking the blocked route against the current game state.")
        s["bot"]["progress"]["status"] = .string("retry")
        s["decision"]["reason"] = s["bot"]["reason"]
        let p=present(s)
        XCTAssertTrue(p.status.lowercased().contains("recovering"))
        XCTAssertTrue(p.why?.contains("Rechecking") == true)
        XCTAssertFalse(p.needsAttention)
        s["bot"]["status"] = .string("blocked")
        s["bot"]["reason"] = .string("No progress after the recovery budget.")
        let stopped=present(s)
        XCTAssertTrue(stopped.needsAttention)
        XCTAssertEqual(stopped.why,"No progress after the recovery budget.")
        XCTAssertTrue(stopped.now.lowercased().contains("review"))
    }
    func testResampleReasonIsNotLostOrReplacedWithOldCampaignCopy() {
        var s=session
        s["decision"] = value(#"{"kind":"resample","reason":"Waiting for the current game interaction to finish."}"#)
        let p=present(s)
        XCTAssertTrue(p.why?.contains("interaction") == true)
        XCTAssertTrue(p.status.lowercased().contains("waiting"))
        XCTAssertFalse(p.needsAttention)
    }
    func testFundingIsExplainedAsEarningMoneyRatherThanShopping() {
        var s=session
        s["bot"]["runScope"] = .string("postgame")
        s["bot"]["objective"] = value(#"{"id":"fund-capture-supplies","incomePreparation":true,"target":{"kind":"object","map":"MAP_ROUTE8"}}"#)
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"move-toward","objective":"fund-capture-supplies","targetMap":"MAP_ROUTE8"}}"#)
        let p=present(s)
        XCTAssertTrue(p.now.lowercased().contains("earning"))
        XCTAssertFalse(p.now.contains("Buying"))
        XCTAssertTrue(p.why?.lowercased().contains("money") == true)
    }
    func testCurrentPostgameGoalDoesNotBorrowCompletedStoryTrainingOrEvolution() {
        var s=dexEvolutionSession
        s["campaign"]["task"] = value(#"{"kind":"recovery","objective":{"target":{"map":"MAP_ROUTE10_POKEMON_CENTER_1F"}}}"#)
        let p=present(s)
        XCTAssertFalse(p.now.contains("Pokémon Center"))
        s["bot"]["objective"] = value(#"{"id":"postgame-togepi-hatch","target":{"kind":"friendship-walk"}}"#)
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"move-toward"}}"#)
        let next=present(s)
        XCTAssertFalse(next.goal?.contains("Venomoth") == true)
        XCTAssertFalse(next.facts.contains { $0.label == "Evolution level" })
    }

    func testRoutineWaitReasonDoesNotTurnRecoveringFlagIntoRouteRecovery() {
        var s=dexEvolutionSession
        s["bot"]["reason"] = .string("Waiting for the current game interaction to finish.")
        let p=present(s)
        XCTAssertEqual(p.status,"In battle")
        XCTAssertFalse(p.needsAttention)
        s["mode"] = .string("overworld")
        XCTAssertEqual(present(s).status,"Waiting for the game")
    }
    func testDisconnectedFreshCacheAndReconnectDoNotClaimTheBotHasStopped() {
        var s=dexEvolutionSession
        let disconnected=ActivityPresentation(session:s,connected:false,now:Date(timeIntervalSince1970:1002))
        XCTAssertTrue(disconnected.stale)
        XCTAssertEqual(disconnected.status,"Waiting for telemetry")
        XCTAssertTrue(disconnected.freshness.contains("Disconnected"))
        XCTAssertTrue(disconnected.why?.contains("last reported") == true)
        XCTAssertEqual(disconnected.goal,present(s).goal)
        XCTAssertEqual(disconnected.goalProgress?.value,"26 / 31")
        s["bot"]["status"] = .string("blocked")
        XCTAssertEqual(ActivityPresentation(session:s,connected:false,now:Date(timeIntervalSince1970:1002)).attention,.none)
        XCTAssertEqual(present(s).attention,.review,"Fresh reconnection must restore a genuine review stop")
    }
    func testStopDecisionAndUnsupportedRouteHaveDifferentWarningSeverity() {
        var s=session
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"stop-for-review","reason":"Cannot verify the save."}}"#)
        XCTAssertEqual(present(s).attention,.review)
        XCTAssertEqual(present(s).why,"Cannot verify the save.")
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"wait-for-supported-objective"}}"#)
        XCTAssertEqual(present(s).attention,.routeUnavailable)
        s["commandError"] = value(#"{"message":"The requested task could not start."}"#)
        XCTAssertEqual(present(s).attention,.review)
        XCTAssertEqual(present(s).why,"The requested task could not start.")
    }
    func testEvolutionMissingReadbackAndCompletedHandoffDoNotInventProgress() {
        var s=dexEvolutionSession
        s["bot"]["preparation"]["progress"]["level"] = .null
        XCTAssertNil(present(s).goalProgress)
        s["bot"]["preparation"]["phase"] = .string("complete")
        XCTAssertNil(present(s).goalProgress)
        XCTAssertEqual(present(s).goal,"Complete the National Pokédex")
        s["bot"]["awaitingCommand"] = .bool(true)
        XCTAssertEqual(present(s).status,"Ready for a command")
        XCTAssertFalse(present(s).status.contains("complete"))
    }
    func testBoundaryRecoveryExplainsFinishingTheInteractionBeforeDeferral() {
        var s=dexEvolutionSession
        s["bot"]["progress"]["status"] = .string("draining")
        s["bot"]["reason"] = .string("Finishing the current interaction before saving or deferring: no progress.")
        let p=present(s)
        XCTAssertEqual(p.status,"Recovering automatically")
        XCTAssertTrue(p.now.contains("Finishing"))
        XCTAssertEqual(p.why,s["bot"]["reason"].string)
        XCTAssertTrue(p.next?.contains("save") == true)
        XCTAssertFalse(p.needsAttention)
    }
    func testBlockedDecisionIsVisibleBeforeTheBotStatusUpdates() {
        var s=session
        s["decision"] = value(#"{"kind":"blocked","reason":"The required save could not be verified."}"#)
        s["bot"]["status"] = .string("waiting")
        XCTAssertEqual(present(s).attention,.review)
        XCTAssertEqual(present(s).why,"The required save could not be verified.")
    }
    func testEvolutionSaveStopDoesNotBorrowAnOldGiftSuccessMessage() {
        var s=dexEvolutionSession
        s["state"] = .string("blocked");s["bot"]["status"] = .string("blocked")
        s["bot"]["reason"] = .string("unexpected-hunt-battle-menu")
        s["mission"] = value(#"{"state":"complete","phase":"complete","reason":"Gift received, saved in game, and identity verified."}"#)
        s["bot"]["objective"] = value(#"{"identityEvolution":true,"target":{"kind":"save-game","saveVerified":false}}"#)
        s["postgame"]["collection"] = value(#"[{"speciesId":49,"name":"venomoth","method":"owned","status":"complete"}]"#)
        s["decision"] = value(#"{"kind":"blocked","reason":"unexpected-hunt-battle-menu"}"#)
        let p=present(s)
        XCTAssertEqual(p.attention,.review)
        XCTAssertTrue(p.why?.contains("menu") == true)
        XCTAssertFalse(p.why?.contains("Gift received") == true)
        XCTAssertTrue(p.goal?.contains("save") == true)
        XCTAssertTrue(p.diagnostics.contains { $0.label == "Stop reason" && $0.value == "unexpected-hunt-battle-menu" })
    }

}
