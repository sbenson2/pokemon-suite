import XCTest
@testable import SuiteCore

final class ActivityOutlineTests: XCTestCase {
    private func value(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private let catalog = try! JSONDecoder().decode(JSONValue.self, from: Data(#"{"species":[{"id":22,"name":"Fearow"},{"id":231,"name":"Phanpy"},{"id":232,"name":"Donphan"}]}"#.utf8))
    private func present(_ s: JSONValue, now: Double = 1002) -> ActivityPresentation { ActivityPresentation(session: s, catalog: catalog, now: Date(timeIntervalSince1970: now)) }

    /// Shaped like the live FireRed status while training Phanpy for Donphan.
    private var training: JSONValue {
        value(#"{"sessionId":"live","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","map":"MAP_ROUTE24","bot":{"enabled":true,"status":"running","runScope":"postgame","activity":"postgame","objective":{"id":"evolution-dex-7-9-232-train","identityEvolution":true,"coreSpecies":[231],"target":{"kind":"map","map":"MAP_ROUTE24"}},"preparation":{"kind":"postgame","phase":"national-dex","requestId":"dex-7-9-232","progress":{"level":11,"required":25,"friendship":78}}},"decision":{"kind":"act","reason":"policy-resolution","recommendation":{"kind":"move-toward","objective":"train-battle-member-with-vs-seeker","targetMap":"MAP_ROUTE24","remainingSteps":22}},"decisionFeed":{"entries":[{"id":"a","map":"MAP_ROUTE24","campaignId":"evolution-dex-7-9-232-train","updatedAt":"1970-01-01T00:16:30Z","decision":{"kind":"act","recommendation":{"kind":"move-toward","objective":"train-battle-member-with-vs-seeker","targetMap":"MAP_ROUTE24","remainingSteps":22}}}]},"postgame":{"active":"national-collection","entries":[{"id":"league","label":"Enter the Hall of Fame","status":"complete"},{"id":"lorelei-visit","label":"Visit Lorelei","status":"pending","executable":false,"reason":"Missed on this save."},{"id":"memorial-pillar","label":"Complete the Memorial Pillar tribute","status":"pending","executable":true,"retry":{"reason":"Route unavailable","retryAt":2000000}},{"id":"national-collection","label":"Complete the National Pokédex","status":"pending","executable":true,"retry":{"reason":"No progress for five active minutes.","retryAt":900000}},{"id":"unown-forms","label":"Collect all 28 Unown forms","status":"pending","executable":true},{"id":"oak-completion","label":"Show Oak the completed Pokédex","status":"pending","executable":false,"reason":"Requires the diploma count."},{"id":"event-islands","label":"Event island encounters","status":"unknown","executable":false,"conditional":true,"reason":"Requires event tickets."}],"workflows":{"dex":{"target":{"speciesId":232,"method":"evolution"}}},"progress":{"dex":{"known":true,"caught":98,"total":386,"kanto":{"caught":90,"total":150},"diploma":{"caught":98,"total":380}},"species":[{"speciesId":232,"name":"donphan","fromSpecies":231,"requirements":{"fromSpecies":231,"speciesId":232,"trigger":"level-up","level":25}}]}},"spectator":{"map":{"name":"Route 24"},"party":[{"speciesId":22,"speciesName":"Fearow","level":93},{"speciesId":231,"speciesName":"Phanpy","level":11,"experience":{"remaining":190}}]}}"#)
    }

    func testPostgameOutlineNamesTheGoalTaskAndOnlyProvenSteps() {
        let o = present(training).outline
        XCTAssertEqual(o.goalKind, "Postgame goal")
        XCTAssertEqual(o.goal?.title, "Complete the National Pokédex")
        XCTAssertEqual(o.goal?.meter, ActivityMeter(value: 98, total: 386, label: "98 of 386 species registered"))
        XCTAssertEqual(o.goal?.notes, ["Kanto Pokédex 90 of 150", "Oak’s diploma 98 of 380"])
        XCTAssertEqual(o.task?.title, "Evolve Phanpy into Donphan")
        XCTAssertEqual(o.task?.detail, "Donphan isn’t registered yet. Phanpy evolves at level 25.")
        XCTAssertEqual(o.task?.species, [231, 232])
        XCTAssertEqual(o.task?.meter?.label, "Level 11 of 25")
        XCTAssertEqual(o.task?.notes, ["190 XP to level 12"])
        XCTAssertEqual(o.plan.map(\.id), ["party", "level", "evolve", "save"])
        XCTAssertEqual(o.plan.map(\.state), [.done, .current, .upcoming, .upcoming])
        XCTAssertEqual(o.method, "Rebattling trainers with the VS Seeker for experience")
        XCTAssertNil(o.route, "walking to a trainer on the training map is not a trip")
        XCTAssertEqual(present(training).headline, "Complete the National Pokédex · Evolve Phanpy into Donphan")
    }

    func testAgendaSeparatesRunnableWaitingAndUnavailableGoals() {
        let p = present(training), agenda = try! XCTUnwrap(p.outline.agenda)
        let state = Dictionary(uniqueKeysWithValues: agenda.items.map { ($0.id, $0.state) })
        XCTAssertEqual(state["national-collection"], .active, "an expired retry does not defer the active goal")
        XCTAssertEqual(state["memorial-pillar"], .waiting)
        XCTAssertEqual(state["lorelei-visit"], .unavailable)
        XCTAssertEqual(state["event-islands"], .unavailable)
        XCTAssertEqual(agenda.completed, 1)
        XCTAssertEqual(agenda.total, 7)
        XCTAssertEqual(agenda.upNext.map(\.id), ["unown-forms"])
        XCTAssertEqual(agenda.notNow.map(\.id), ["lorelei-visit", "memorial-pillar", "oak-completion"], "a conditional goal without its prerequisite is not a problem to report")
        XCTAssertTrue(agenda.notNow.first { $0.id == "memorial-pillar" }?.note?.hasPrefix("Route unavailable. Retrying at") == true)
        XCTAssertFalse(p.facts.contains { $0.label == "Deferred: Complete the National Pokédex" })
        XCTAssertTrue(p.facts.contains { $0.label == "Deferred: Complete the Memorial Pillar tribute" })
    }

    func testAPausedLeagueTrainingHoldIsReportedWithItsResumeNote() {
        var s = training
        let paused = "Paused after a battler fainted at Hall of Fame entry 101. To resume, turn League training off in Bot settings and save, then turn it on and save again."
        s["postgame"]["entries"] = .array(s["postgame"]["entries"].array + [value(#"{"id":"league-training","label":"Train a Pokémon with the League Exp. Share","status":"pending","executable":false,"paused":true,"reason":"\#(paused)"}"#)])
        let agenda = try! XCTUnwrap(present(s).outline.agenda)
        XCTAssertEqual(agenda.notNow.first { $0.id == "league-training" }?.note, paused)
    }

    func testWithdrawAndEvolvedPartyAdvanceThePlanFromEvidence() {
        var s = training
        s["bot"]["objective"]["id"] = .string("evolution-dex-7-9-232-withdraw")
        s["spectator"]["party"] = value(#"[{"speciesId":22,"speciesName":"Fearow","level":93}]"#)
        var plan = present(s).outline.plan
        XCTAssertEqual(plan.map(\.state), [.current, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(plan.first?.detail, "Withdrawing it from the PC")
        s["bot"]["objective"]["id"] = .string("evolution-dex-7-9-232-save")
        s["spectator"]["party"] = value(#"[{"speciesId":232,"speciesName":"Donphan","level":25}]"#)
        plan = present(s).outline.plan
        XCTAssertEqual(plan.map(\.state), [.done, .done, .done, .current])
    }

    func testTravelNamesTheDestinationNextExitStepsAndRecentMaps() {
        var s = training
        s["map"] = .string("MAP_CERULEAN_CITY")
        s["bot"]["objective"]["id"] = .string("evolution-dex-7-9-232-withdraw")
        let travel = #"{"kind":"move-toward","objective":"evolution-dex-7-9-232-withdraw","targetMap":"MAP_CELADON_CITY_POKEMON_CENTER_1F","transit":{"kind":"connection","destinationMap":"MAP_ROUTE5","direction":"south"},"remainingSteps":48,"travelMode":"run"}"#
        s["decision"] = value(#"{"kind":"act","reason":"policy-resolution","recommendation":\#(travel)}"#)
        s["decisionFeed"] = value(#"{"entries":[{"id":"1","map":"MAP_ROUTE24","campaignId":"evolution-dex-7-9-232-withdraw","decision":{"kind":"act","recommendation":{"kind":"move-toward","targetMap":"MAP_CELADON_CITY_POKEMON_CENTER_1F"}}},{"id":"2","map":"MAP_ROUTE24","campaignId":"evolution-dex-7-9-232-withdraw","decision":{"kind":"act","recommendation":{"kind":"move-toward","targetMap":"MAP_CELADON_CITY_POKEMON_CENTER_1F"}}},{"id":"3","map":"MAP_CERULEAN_CITY","campaignId":"evolution-dex-7-9-232-withdraw","decision":{"kind":"act","recommendation":\#(travel)}}]}"#)
        let expected = ActivityRoute(destination: "Celadon City Pokémon Center", next: "South exit to Route 5", steps: 48, mode: "Running", trail: ["Route 24", "Cerulean City"])
        XCTAssertEqual(present(s).outline.route, expected)
        s["mode"] = .string("battle")
        s["decision"] = value(#"{"kind":"resample","reason":"hunt-battle-transition"}"#)
        XCTAssertEqual(present(s).outline.route, expected, "a battle on the way keeps the published trip")
    }

    func testFlyDecisionShowsTheLanding() {
        var s = training
        s["decision"] = value(#"{"kind":"act","recommendation":{"kind":"choose-fly-destination","objective":"fly-to-MAPSEC_CELADON_CITY"}}"#)
        XCTAssertEqual(present(s).outline.route, ActivityRoute(destination: "Celadon City", next: nil, steps: nil, mode: "Flying", trail: []))
    }

    func testEvolutionSceneIsReportedFromTheGameMode() {
        var s = training
        s["mode"] = .string("evolution")
        s["decision"] = value(#"{"kind":"resample","reason":"hunt-battle-transition"}"#)
        let p = present(s)
        XCTAssertEqual(p.status, "Evolution in progress")
        XCTAssertEqual(p.now, "Phanpy is evolving into Donphan")
        XCTAssertEqual(p.outline.plan.first { $0.state == .current }?.id, "evolve")
    }

    func testItemRecoveryKeepsItsExplanationThroughWaits() {
        var s = training
        s["bot"]["objective"] = value(#"{"id":"restore-postgame-party-with-items","target":{"kind":"heal-with-items","travel":true}}"#)
        s["decision"] = value(#"{"kind":"resample","reason":"transition"}"#)
        let p = present(s)
        XCTAssertEqual(p.now, "Restoring the party with items")
        XCTAssertTrue(p.why?.contains("medicine from the Bag") == true)
        XCTAssertNil(p.outline.task, "the evolution card belongs to the evolution objective")
    }

    func testWaitCodesAreExplainedOrOmittedNeverShownRaw() {
        var s = value(#"{"sessionId":"live","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","bot":{"enabled":true},"decision":{"kind":"resample","reason":"hunt-battle-transition"}}"#)
        XCTAssertEqual(present(s).why, "Waiting for the battle to advance.")
        s["decision"]["reason"] = .string("some-new-code")
        XCTAssertFalse(present(s).why?.contains("some-new-code") == true)
    }

    func testLatestActionAgeUsesTheSnapshotClock() {
        var s = training
        s["decision"] = value(#"{"kind":"resample","reason":"transition"}"#)
        s["bot"]["objective"]["identityEvolution"] = .bool(false)
        XCTAssertEqual(present(s).latestAction, "Travelling to Route 24 · 12s ago")
        XCTAssertNil(present(s, now: 1200).latestAction, "an old action is not presented as current")
    }

    func testStoryRunUsesTheCheckpointAsTheGoal() {
        let s = value(#"{"sessionId":"live","state":"running","updatedAt":"1970-01-01T00:16:40Z","bot":{"enabled":true,"runScope":"campaign"},"campaign":{"storyProgress":{"current":{"id":"surge","label":"Defeat Lt. Surge","detail":"Earn the Thunder Badge."},"completed":12,"total":40,"badges":{"known":1,"earned":2,"total":8}}}}"#)
        let o = present(s).outline
        XCTAssertEqual(o.goalKind, "Story goal")
        XCTAssertEqual(o.goal, ActivityGoal(title: "Defeat Lt. Surge", detail: "Earn the Thunder Badge.", meter: ActivityMeter(value: 12, total: 40, label: "12 of 40 story checkpoints"), notes: ["2 of 8 badges verified"], species: []))
        XCTAssertNil(o.agenda)
    }
}
