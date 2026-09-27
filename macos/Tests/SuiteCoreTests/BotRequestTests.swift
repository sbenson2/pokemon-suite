import XCTest
@testable import SuiteCore

/// "Ask the bot" (G5): typed or dictated text -> interpret -> clarify / confirm
/// -> commit to the goal supervisor. Responses are the real G3/G2 API outputs
/// in BotRequestFixtures; the fake Suite records every request body.
@MainActor final class FakeSuite {
    var calls: [(path: String, body: JSONValue?)] = []
    var replies: [Result<JSONValue, Error>] = []
    var hold = false
    private var held: [CheckedContinuation<Void, Never>] = []
    var transport: BotRequestTransport {
        BotRequestTransport(get: { [unowned self] path in try await self.reply(path, nil) },
                            post: { [unowned self] path, body in try await self.reply(path, body) })
    }
    func reply(_ path: String, _ body: JSONValue?) async throws -> JSONValue {
        calls.append((path, body))
        if hold { await withCheckedContinuation { held.append($0) } }
        guard !replies.isEmpty else { throw SuiteError("Unexpected request to \(path)") }
        return try replies.removeFirst().get()
    }
    func release() { hold = false; held.forEach { $0.resume() }; held = [] }
}

func fixture(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

@MainActor final class BotRequestFlowTests: XCTestCase {
    private var issued = 0
    private func makeFlow(_ suite: FakeSuite, client: String = "mac") -> BotRequestFlow {
        BotRequestFlow(client: client, transport: suite.transport) { [unowned self] in self.issued += 1; return "\(client)-test-key-\(self.issued)" }
    }
    private func commitReply(_ goal: JSONValue) -> JSONValue { .object(["ok": .bool(true), "applied": .array([]), "goal": goal]) }
    private let interpret = "/api/pokemon-suite/requests/interpret", commit = "/api/pokemon-suite/requests/commit"
    private let goalsPath = "/api/pokemon-suite/goals", cancelPath = "/api/pokemon-suite/goals/cancel"

    func testDecodesTheInterpreterExamples() throws {
        let mewtwo = try BotRequestDraft(response: fixture(BotRequestFixtures.mewtwo))
        XCTAssertTrue(mewtwo.understood)
        XCTAssertEqual(mewtwo.confidence, 0.79, accuracy: 0.0001)
        XCTAssertEqual(mewtwo.draftId, "5e86024ebf8246bf9e30b7803af63ac3")
        XCTAssertEqual(mewtwo.summary, "Catch shiny Mewtwo (priority legendary target) (current save if it can reach it, else it asks)")
        XCTAssertTrue(mewtwo.runnable)
        XCTAssertFalse(mewtwo.confirmationRequired)
        XCTAssertNil(mewtwo.clarification)
        XCTAssertEqual(mewtwo.goal["steps"].array.first?["request"]["speciesId"].int, 150)
        XCTAssertEqual(mewtwo.goal["source"]["via"].string, "voice")

        let clarify = try BotRequestDraft(response: fixture(BotRequestFixtures.clarify))
        XCTAssertFalse(clarify.understood)
        XCTAssertFalse(clarify.runnable, "a question is never runnable")
        let question = try XCTUnwrap(clarify.clarification)
        XCTAssertEqual(question.id, "0:species")
        XCTAssertEqual(question.question, "Which Pokémon do you mean?")
        XCTAssertEqual(question.choices, [BotRequestChoice(id: "151", label: "Mew"), BotRequestChoice(id: "150", label: "Mewtwo"), BotRequestChoice(id: "52", label: "Meowth")])
        XCTAssertTrue(question.freeText)

        let trade = try BotRequestDraft(response: fixture(BotRequestFixtures.trade))
        XCTAssertTrue(trade.confirmationRequired)
        XCTAssertEqual(trade.confirmationReasons, ["Trades away your shiny Charizard."])
        XCTAssertEqual(trade.notes, ["Trades away your shiny Charizard."])

        let team = try BotRequestDraft(response: fixture(BotRequestFixtures.team))
        XCTAssertTrue(team.understood)
        XCTAssertFalse(team.runnable)
        XCTAssertEqual(team.answer?.hasPrefix("Team: Fearow Lv100"), true)

        let nonsense = try BotRequestDraft(response: fixture(BotRequestFixtures.nonsense))
        XCTAssertFalse(nonsense.understood)
        XCTAssertEqual(nonsense.message, "I can’t turn “make me a sandwich” into a bot action. Try one of these:")
        XCTAssertEqual(nonsense.suggestions, ["get me a shiny Mewtwo", "heal then go to Cinnabar and save", "catch 3 adamant Abra in Ultra Balls"])

        let release = try BotRequestDraft(response: fixture(BotRequestFixtures.release))
        XCTAssertEqual(release.unsupported, "release")
        XCTAssertTrue(release.message.hasPrefix("Pokémon are never released automatically."))

        let multi = try BotRequestDraft(response: fixture(BotRequestFixtures.multi))
        XCTAssertEqual(multi.summary, "Heal the team → Travel to Cinnabar Island and save → Save the game")
        XCTAssertEqual(multi.goal["steps"].array.count, 3)
        XCTAssertTrue(multi.runnable)

        XCTAssertThrowsError(try BotRequestDraft(response: fixture(#"{"ok":true,"understood":true}"#)), "a response without a draft cannot be committed")
    }

    func testClarificationAnswerThenCommitWithAnIdempotencyKey() async throws {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.clarify)), .success(fixture(BotRequestFixtures.clarify_answered)),
                         .success(commitReply(fixture(BotRequestFixtures.goalsSubmit)["goal"])), .success(fixture(BotRequestFixtures.goalsListRunning))]
        await flow.submit("catch a mewt", via: .typed)
        XCTAssertEqual(suite.calls.first?.path, interpret)
        XCTAssertEqual(suite.calls.first?.body, fixture(#"{"text":"catch a mewt","via":"typed","answers":{}}"#))
        guard case .clarifying(let draft) = flow.stage, let question = draft.clarification else { return XCTFail("expected a clarification, got \(flow.stage)") }
        XCTAssertEqual(flow.resultLine, "Which Pokémon do you mean?")
        XCTAssertNil(flow.confirmLabel)

        await flow.choose(question.choices[1])
        XCTAssertEqual(suite.calls[1].body, fixture(#"{"text":"catch a mewt","via":"typed","answers":{"0:species":"150"}}"#), "the same text is re-interpreted with the answer")
        guard case .ready(let ready) = flow.stage else { return XCTFail("expected a runnable draft, got \(flow.stage)") }
        XCTAssertEqual(ready.goal["steps"].array.first?["request"]["speciesId"].int, 150)
        XCTAssertEqual(flow.confirmLabel, "Run")
        XCTAssertEqual(flow.resultLine, "Catch Mewtwo (priority legendary target) (current save if it can reach it, else it asks)")

        await flow.commit()
        XCTAssertEqual(suite.calls[2].path, commit)
        XCTAssertEqual(suite.calls[2].body, fixture(#"{"draftId":"03ee6b93df734d24875f32aab48a9cac","idempotencyKey":"mac-test-key-2","answers":{}}"#))
        let key = try XCTUnwrap(suite.calls[2].body?["idempotencyKey"].string)
        XCTAssertNotNil(key.range(of: "^[A-Za-z0-9_-]{8,100}$", options: .regularExpression), "the host's idempotencyKey format")
        guard case .committed(let result) = flow.stage else { return XCTFail("expected a committed goal, got \(flow.stage)") }
        XCTAssertEqual(result.goal?.status, "queued")
        XCTAssertEqual(flow.resultLine, "Goal queued: Catch Mewtwo (priority legendary target) (current save if it can reach it, else it asks)")
        XCTAssertEqual(suite.calls[3].path, goalsPath, "the goal list is read after a commit")
        XCTAssertNil(suite.calls[3].body)
        XCTAssertEqual(flow.goals?.active?.phase, "hunting")
        XCTAssertNil(flow.error)
    }

    func testDestructiveRequestNeedsConfirmAndSendsConfirmYes() async throws {
        let suite = FakeSuite(), flow = makeFlow(suite, client: "ios")
        suite.replies = [.success(fixture(BotRequestFixtures.trade)), .success(fixture(BotRequestFixtures.trade_commit)), .success(fixture(BotRequestFixtures.goalsListRunning))]
        await flow.submit("trade my shiny charizard", via: .typed)
        XCTAssertEqual(flow.confirmLabel, "Confirm")
        XCTAssertEqual(flow.draft?.notes, ["Trades away your shiny Charizard."])
        await flow.commit()
        XCTAssertEqual(suite.calls[1].body, fixture(#"{"draftId":"b86927c9ffda49b7a1fade5a2a3ba67c","idempotencyKey":"ios-test-key-1","answers":{"confirm":"yes"}}"#))
        XCTAssertEqual(flow.resultLine, "Goal queued: Trade away your shiny Charizard (Charizard · Adamant · caught 2026-09-10)")
    }

    func testFailedCommitKeepsTheDraftAndRetriesWithTheSameKey() async throws {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.mewtwo)), .failure(SuiteError("The Suite could not complete this request.")),
                         .success(commitReply(fixture(BotRequestFixtures.goalsSubmit)["goal"])), .failure(SuiteError("offline"))]
        await flow.submit("get me a shiny mewtwo", via: .voice)
        XCTAssertEqual(suite.calls[0].body?["via"].string, "voice")
        await flow.commit()
        guard case .ready = flow.stage else { return XCTFail("a failed commit keeps the draft, got \(flow.stage)") }
        XCTAssertEqual(flow.error, "The Suite could not complete this request.")
        await flow.commit()
        XCTAssertEqual(suite.calls[1].body, suite.calls[2].body, "a retry repeats the same draft and key, so the host returns the first result instead of a second goal")
        XCTAssertNil(flow.error)
        guard case .committed = flow.stage else { return XCTFail("expected committed, got \(flow.stage)") }
        XCTAssertNil(flow.goals, "a failed goal-list read does not undo the commit")
    }

    func testEveryNewDraftGetsItsOwnKey() async throws {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.mewtwo)), .success(fixture(BotRequestFixtures.multi)),
                         .success(commitReply(fixture(BotRequestFixtures.goalsSubmit)["goal"])), .success(fixture(BotRequestFixtures.goalsListRunning))]
        await flow.submit("get me a shiny mewtwo", via: .typed)
        let first = flow.idempotencyKey
        await flow.submit("heal then go to cinnabar and save", via: .typed)
        XCTAssertNotEqual(flow.idempotencyKey, first)
        await flow.commit()
        XCTAssertEqual(suite.calls[2].body?["idempotencyKey"].string, "mac-test-key-2")
        XCTAssertEqual(suite.calls[2].body?["draftId"].string, "13f87902d64c4e358afed4574047ba77")
    }

    func testQuestionsAreAnsweredWithNothingToRun() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.team))]
        await flow.submit("what's my team", via: .typed)
        guard case .answered = flow.stage else { return XCTFail("expected an answer, got \(flow.stage)") }
        XCTAssertTrue(flow.resultLine.hasPrefix("Team: Fearow Lv100, 253/253 HP;"))
        XCTAssertNil(flow.confirmLabel)
        await flow.commit()
        XCTAssertEqual(suite.calls.count, 1, "an answered question is never committed")
    }

    func testNonsenseOffersSuggestionsThatReinterpretAsUIRequests() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.nonsense)), .success(fixture(BotRequestFixtures.mewtwo))]
        await flow.submit("make me a sandwich", via: .voice)
        guard case .notUnderstood(let draft) = flow.stage else { return XCTFail("expected not understood, got \(flow.stage)") }
        XCTAssertEqual(flow.resultLine, "I can’t turn “make me a sandwich” into a bot action. Try one of these:")
        await flow.useSuggestion(draft.suggestions[0])
        XCTAssertEqual(suite.calls[1].body, fixture(#"{"text":"get me a shiny Mewtwo","via":"ui","answers":{}}"#))
        XCTAssertEqual(flow.text, "get me a shiny Mewtwo")
    }

    func testUnsupportedRequestExplainsWhy() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.release))]
        await flow.submit("release my magikarp", via: .typed)
        guard case .notUnderstood(let draft) = flow.stage else { return XCTFail("expected not understood, got \(flow.stage)") }
        XCTAssertEqual(draft.unsupported, "release")
        XCTAssertTrue(flow.resultLine.hasPrefix("Pokémon are never released automatically."))
        XCTAssertNil(flow.confirmLabel)
    }

    func testVoiceRequestsKeepTheirSourceThroughAClarification() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.clarify)), .success(fixture(BotRequestFixtures.clarify_answered))]
        await flow.submit("catch a mewt", via: .voice)
        await flow.choose(BotRequestChoice(id: "150", label: "Mewtwo"))
        XCTAssertEqual(suite.calls.map { $0.body?["via"].string }, ["voice", "voice"])
    }

    func testNewTextStartsOverAndTheSameTextKeepsItsAnswers() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.clarify)), .success(fixture(BotRequestFixtures.clarify_answered)),
                         .success(fixture(BotRequestFixtures.clarify_answered)), .success(fixture(BotRequestFixtures.clarify))]
        await flow.submit("catch a mewt", via: .typed)
        await flow.answer("mewtwo")
        XCTAssertEqual(suite.calls[1].body?["answers"], fixture(#"{"0:species":"mewtwo"}"#), "a free-text answer to the pending question")
        await flow.submit("  catch a mewt ", via: .typed)
        XCTAssertEqual(suite.calls[2].body?["answers"], fixture(#"{"0:species":"mewtwo"}"#))
        await flow.submit("catch a meowth", via: .typed)
        XCTAssertEqual(suite.calls[3].body?["answers"], fixture(#"{}"#))
        XCTAssertEqual(suite.calls[3].body?["text"].string, "catch a meowth")
    }

    func testInterpretErrorsAreShown() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.failure(SuiteError("Control requires the current Pokémon Suite session."))]
        await flow.submit("heal", via: .typed)
        XCTAssertEqual(flow.stage, .failed("Control requires the current Pokémon Suite session."))
        XCTAssertEqual(flow.resultLine, "Control requires the current Pokémon Suite session.")
        XCTAssertNil(flow.draft)
    }

    func testEmptyAndOverlongTextAreNotSent() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        await flow.submit("  \n ", via: .typed)
        XCTAssertEqual(flow.stage, .idle)
        await flow.submit(String(repeating: "a", count: 1001), via: .voice)
        XCTAssertEqual(flow.stage, .failed("Keep your request under 1,000 characters."))
        XCTAssertTrue(suite.calls.isEmpty)
    }

    func testResetDropsALateResponse() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.mewtwo))]
        suite.hold = true
        let request = Task { await flow.submit("get me a shiny mewtwo", via: .typed) }
        while suite.calls.isEmpty { await Task.yield() }
        XCTAssertEqual(flow.stage, .interpreting)
        XCTAssertTrue(flow.isWorking)
        flow.reset()
        suite.release()
        await request.value
        XCTAssertEqual(flow.stage, .idle, "a cancelled request never reappears")
        XCTAssertNil(flow.draft)
    }

    func testCancelTellsTheSuiteAndStartsOver() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(BotRequestFixtures.mewtwo)), .failure(SuiteError("offline"))]
        await flow.submit("get me a shiny mewtwo", via: .voice)
        await flow.cancel()
        XCTAssertEqual(flow.stage, .idle)
        XCTAssertNil(flow.idempotencyKey)
        XCTAssertEqual(suite.calls.map(\.path), [interpret, "/api/pokemon-suite/requests/cancel"])
        XCTAssertEqual(suite.calls[1].body, .object(["draftId": .string("5e86024ebf8246bf9e30b7803af63ac3")]),
                       "the Suite drops the draft and logs the owner's no; a failed call changes nothing here")
        await flow.cancel()
        XCTAssertEqual(suite.calls.count, 2, "nothing to tell the Suite without a draft")
    }

    func testWarmUpStartsLayaWithoutWaitingOrTouchingTheRequest() async {
        let suite = FakeSuite()
        var clock = Date(timeIntervalSince1970: 1_000)
        let flow = BotRequestFlow(client: "mac", transport: suite.transport, makeKey: { "mac-test-key" }, now: { clock })
        suite.replies = [.success(fixture(#"{"ok":true,"laya":"loading"}"#)), .success(fixture(BotRequestFixtures.mewtwo)), .success(fixture(#"{"ok":true,"laya":"ready"}"#))]
        await flow.warm()?.value
        XCTAssertEqual(suite.calls.map(\.path), ["/api/pokemon-suite/requests/warm"])
        XCTAssertEqual(suite.calls[0].body, .object([:]), "the host's warm-up takes no parameters")
        XCTAssertEqual(flow.stage, .idle)
        await flow.submit("get me a shiny mewtwo", via: .voice)
        clock += 10
        XCTAssertNil(flow.warm(), "the mic tapped just after Ask opened: Laya is already loading")
        guard case .ready = flow.stage else { return XCTFail("a warm-up never changes the draft, got \(flow.stage)") }
        clock += BotRequestFlow.warmInterval
        await flow.warm()?.value
        XCTAssertEqual(suite.calls.map(\.path).last, "/api/pokemon-suite/requests/warm")
        XCTAssertEqual(flow.idempotencyKey, "mac-test-key")
        XCTAssertNil(flow.error)
    }

    func testAFailedWarmUpIsQuietAndTriedAgainOnTheNextTap() async {
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.failure(SuiteError("Mac unavailable. Reconnecting…")), .success(fixture(#"{"ok":true,"laya":"off"}"#))]
        await flow.warm()?.value
        XCTAssertEqual(flow.stage, .idle)
        XCTAssertNil(flow.error, "a warm-up is best effort; the request itself reports a real outage")
        await flow.warm()?.value
        XCTAssertEqual(suite.calls.count, 2, "a failed warm-up does not hold off the next one")
    }

    func testALayaReadingIsShownBeforeTheConfirmButton() async throws {
        // The host's interpret output (laya-nl-20260925 stage 3) for a step Laya decided: tests/test_laya_primary.py's
        // Scripted Laya reading "the gang looks exhausted" as heal (goal trimmed to its steps).
        let reply = #"{"answer": null, "clarification": null, "confidence": 0.99, "confirmation": {"reasons": ["I read “the gang looks exhausted” as “Heal the team”. Confirm?"], "required": true}, "direct": [], "draftId": "a1b2c3d4e5f60718293a4b5c6d7e8f90", "goal": {"game": "firered", "schema": "pokemon-suite/goal/v1", "source": {"interpreter": {"confidence": 0.99, "parser": "laya"}, "text": "the gang looks exhausted", "via": "voice"}, "status": "draft", "steps": [{"action": "start", "kind": "player-task", "task": {"kind": "heal"}}], "then": "await-command"}, "message": "", "ok": true, "parser": "laya", "preview": [], "suggestions": [], "summary": "Heal the team", "understood": true, "unsupported": null, "warnings": []}"#
        let suite = FakeSuite(), flow = makeFlow(suite)
        suite.replies = [.success(fixture(reply)), .success(commitReply(fixture(BotRequestFixtures.goalsSubmit)["goal"])), .success(fixture(BotRequestFixtures.goalsListRunning))]
        await flow.submit("the gang looks exhausted", via: .voice)
        XCTAssertEqual(flow.resultLine, "Heal the team")
        XCTAssertEqual(flow.draft?.notes, ["I read “the gang looks exhausted” as “Heal the team”. Confirm?"], "the reason line sits above the button")
        XCTAssertEqual(flow.confirmLabel, "Confirm")
        await flow.commit()
        XCTAssertEqual(suite.calls[1].body?["answers"], .object(["confirm": .string("yes")]))
    }

    func testCancelGoalPostsItsIdAndRereadsTheList() async throws {
        let suite = FakeSuite(), flow = makeFlow(suite)
        let running = try XCTUnwrap(SuiteGoals(summary: fixture(BotRequestFixtures.goalsSummaryRunning))?.active)
        suite.replies = [.success(fixture(BotRequestFixtures.goalsCancel)), .success(fixture(BotRequestFixtures.goalsListAfterCancel)),
                         .failure(SuiteError("This goal was already cancelled."))]
        let cancelled = await flow.cancelGoal(running.id)
        XCTAssertTrue(cancelled)
        XCTAssertEqual(suite.calls[0].path, cancelPath)
        XCTAssertEqual(suite.calls[0].body, .object(["id": .string(running.id)]))
        XCTAssertEqual(suite.calls[1].path, goalsPath)
        XCTAssertEqual(flow.goalNotice, "Cancelled “get me a shiny Mewtwo”.")
        XCTAssertEqual(flow.goals?.last?.status, "cancelled")
        XCTAssertEqual(flow.goals?.active?.text, "heal the team")
        let again = await flow.cancelGoal(running.id)
        XCTAssertFalse(again)
        XCTAssertEqual(flow.goalNotice, "This goal was already cancelled.")
    }
}

final class SuiteGoalsTests: XCTestCase {
    func testSessionSummaryShowsTheActiveGoalStepAndPhase() throws {
        let goals = try XCTUnwrap(SuiteGoals(summary: fixture(BotRequestFixtures.goalsSummaryRunning)))
        let active = try XCTUnwrap(goals.active)
        XCTAssertEqual(active.text, "get me a shiny Mewtwo")
        XCTAssertEqual(active.status, "running")
        XCTAssertEqual(active.kindLabel, "Catch")
        XCTAssertEqual(active.phaseLabel, "Hunting")
        XCTAssertEqual(active.detail, "Hunting Mewtwo: hunting, 0 encounters.")
        XCTAssertEqual(active.stepLabel, "Step 1 of 1")
        XCTAssertEqual(active.progressLine, "Running · Hunting", "a one-step goal does not repeat “Step 1 of 1”")
        XCTAssertTrue(active.isOpen)
        XCTAssertEqual(goals.current, active)
        XCTAssertEqual(goals.queued, 0)
        XCTAssertEqual(SuiteGoals(summary: fixture(BotRequestFixtures.goalsSummaryQueued))?.queued, 1)
        XCTAssertNil(SuiteGoals(summary: .null), "no goal store: no status")
    }

    func testAGoalWaitingForTheOwnerShowsItsQuestion() throws {
        let goals = try XCTUnwrap(SuiteGoals(summary: fixture(BotRequestFixtures.goalsSummaryDecision)))
        XCTAssertNil(goals.active)
        let waiting = try XCTUnwrap(goals.current)
        XCTAssertEqual(waiting.status, "waiting")
        XCTAssertEqual(waiting.progressLine, "Waiting · Needs your decision")
        XCTAssertTrue(waiting.question?.hasPrefix("Mewtwo’s one-time encounter is already used in this save.") == true)
        XCTAssertEqual(waiting.choices.map(\.id), ["new-save", "cancel"])
        XCTAssertTrue(waiting.isOpen)
    }

    func testTheGoalListAndTheSessionSummaryAgree() throws {
        for (list, summary) in [(BotRequestFixtures.goalsListRunning, BotRequestFixtures.goalsSummaryRunning),
                                (BotRequestFixtures.goalsListAfterCancel, BotRequestFixtures.goalsSummaryAfterCancel),
                                (BotRequestFixtures.goalsListDecision, BotRequestFixtures.goalsSummaryDecision)] {
            var fromList = SuiteGoals(list: fixture(list))
            XCTAssertNotNil(fromList.supervisorWarning, "the test supervisor has no thread")
            fromList.supervisorWarning = nil
            XCTAssertEqual(fromList, SuiteGoals(summary: fixture(summary)))
        }
        let after = SuiteGoals(list: fixture(BotRequestFixtures.goalsListAfterCancel))
        XCTAssertEqual(after.active?.progressLine, "Running · Starting")
        XCTAssertEqual(after.last?.status, "cancelled")
        XCTAssertFalse(after.last?.isOpen ?? true)
        var running = fixture(BotRequestFixtures.goalsListRunning)
        running["supervisor"]["running"] = .bool(true)
        XCTAssertNil(SuiteGoals(list: running).supervisorWarning)
        XCTAssertEqual(SuiteGoals(list: fixture(BotRequestFixtures.goalsListRunning)).supervisorWarning, "The goal supervisor isn’t running, so requests won’t progress. Restart Pokémon Suite.")
    }

    func testMultiStepProgressAndResults() throws {
        let brief = fixture(#"{"id":"g1","status":"running","text":"heal then go to cinnabar and save","step":1,"steps":3,"kind":"player-task","phase":"task","detail":"Travelling to Cinnabar Island.","question":null,"result":null,"updatedAt":"2026-09-24T12:00:00Z"}"#)
        let goal = try XCTUnwrap(SuiteGoal(brief: brief))
        XCTAssertEqual(goal.stepLabel, "Step 2 of 3")
        XCTAssertEqual(goal.progressLine, "Running · Step 2 of 3 · Running a task")
        let done = try XCTUnwrap(SuiteGoal(brief: fixture(#"{"id":"g2","status":"done","text":"get me a shiny Mewtwo","step":0,"steps":1,"kind":"farming","phase":"done","detail":"Caught.","question":null,"result":{"summary":"Caught a shiny Mewtwo.","step":0}}"#)))
        XCTAssertEqual(done.result, "Caught a shiny Mewtwo.")
        XCTAssertEqual(done.progressLine, "Done")
        XCTAssertFalse(done.isOpen)
        XCTAssertEqual(SuiteGoal(brief: fixture(#"{"id":"g3","status":"waiting","phase":"after-campaign"}"#))?.phaseLabel, "Waiting for the story to finish")
        XCTAssertEqual(SuiteGoal(brief: fixture(#"{"id":"g4","status":"waiting","phase":"some-new-phase"}"#))?.phaseLabel, "Some New Phase", "unknown phases stay readable")
        XCTAssertNil(SuiteGoal(brief: fixture(#"{"status":"running"}"#)))
    }
}

final class DictationReadinessTests: XCTestCase {
    private func check(usage: Bool = true, speech: DictationPermission = .authorized, microphone: DictationPermission = .authorized,
                       recognizer: DictationRecognizer = .onDevice) -> DictationReadiness {
        DictationReadiness.evaluate(usageDescriptions: usage, speech: speech, microphone: microphone, recognizer: recognizer, language: "English (United States)")
    }

    func testOnDeviceRecognitionWithBothPermissionsIsReady() {
        XCTAssertEqual(check(), .ready)
    }

    func testPermissionsAreRequestedOnlyWhenTheyHaveNotBeenAnswered() {
        XCTAssertEqual(check(speech: .notDetermined), .needsPermission)
        XCTAssertEqual(check(microphone: .notDetermined), .needsPermission)
        XCTAssertEqual(check(speech: .notDetermined, microphone: .notDetermined), .needsPermission)
    }

    func testAudioNeverLeavesTheDeviceWhenOnDeviceRecognitionIsUnavailable() {
        let serverOnly = check(speech: .notDetermined, microphone: .notDetermined, recognizer: .serverOnly)
        XCTAssertEqual(serverOnly, .blocked("On-device speech recognition isn’t available for English (United States) here, and Pokémon Suite never sends your voice to a server. Type your request instead."),
                       "no permission prompt and no server fallback")
        XCTAssertEqual(check(recognizer: .unsupportedLocale), .blocked("Speech recognition isn’t available for English (United States). Type your request instead."))
        XCTAssertEqual(check(recognizer: .unavailable), .blocked("Speech recognition is unavailable right now. Try again in a moment, or type your request."))
    }

    func testDenialIsExplainedWithoutAskingAgain() {
        XCTAssertEqual(check(speech: .denied), .blocked("Speech recognition is turned off for Pokémon Suite. Allow it in Privacy & Security settings, or type your request."))
        XCTAssertEqual(check(microphone: .denied), .blocked("Microphone access is turned off for Pokémon Suite. Allow it in Privacy & Security settings, or type your request."))
        XCTAssertEqual(check(speech: .restricted), .blocked("Speech recognition is restricted on this device. Type your request instead."))
        XCTAssertEqual(check(microphone: .restricted), .blocked("The microphone is restricted on this device. Type your request instead."))
        XCTAssertEqual(check(speech: .denied, microphone: .notDetermined), check(speech: .denied), "a denial wins over a pending prompt")
    }

    func testAppWithoutUsageDescriptionsNeverPrompts() {
        XCTAssertEqual(check(usage: false, speech: .notDetermined, microphone: .notDetermined), .blocked("Voice requests need the packaged Pokémon Suite app. Type your request instead."))
    }

    func testDictatedTextStaysAVoiceRequestUntilItIsEdited() {
        XCTAssertEqual(BotRequestVia.resolve(text: "get me a shiny mewtwo", dictated: "get me a shiny mewtwo"), .voice)
        XCTAssertEqual(BotRequestVia.resolve(text: " get me a shiny mewtwo ", dictated: "get me a shiny mewtwo"), .voice)
        XCTAssertEqual(BotRequestVia.resolve(text: "get me a shiny mew", dictated: "get me a shiny mewtwo"), .typed)
        XCTAssertEqual(BotRequestVia.resolve(text: "heal", dictated: nil), .typed)
        XCTAssertEqual(BotRequestVia.resolve(text: "", dictated: ""), .typed)
    }
}
