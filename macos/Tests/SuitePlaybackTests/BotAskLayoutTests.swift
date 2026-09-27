import XCTest
import SwiftUI
import AppKit
import SuiteCore
@testable import PokemonSuiteMac

/// "Ask the bot" in the Bot header and the request card in Activity stay
/// compact and readable. Set ASK_REVIEW_IMAGES to a folder to keep PNGs.
@MainActor final class BotAskLayoutTests: XCTestCase {
    private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    // Trimmed copies of the G3 interpret samples (goal-g3-20260923/logs/api-samples.json).
    private var clarify: String { #"{"ok":true,"understood":false,"confidence":0.875,"summary":"","message":"Which Pokémon do you mean?","clarification":{"id":"0:species","slot":"species","clause":0,"question":"Which Pokémon do you mean?","choices":[{"id":"151","label":"Mew"},{"id":"150","label":"Mewtwo"},{"id":"52","label":"Meowth"}],"freeText":true},"confirmation":{"required":false,"reasons":[]},"goal":null,"direct":[],"answer":null,"suggestions":[],"unsupported":null,"draftId":"5b008b50a70544138eec9a0475c254d6"}"# }
    private var trade: String { #"{"ok":true,"understood":true,"confidence":1.0,"summary":"Trade away your shiny Charizard (Charizard · Adamant · caught 2026-09-10)","message":"","clarification":null,"confirmation":{"required":true,"reasons":["Trades away your shiny Charizard."]},"goal":{"schema":"pokemon-suite/goal/v1","steps":[{"kind":"trade","via":"trade-shiny","payload":{"shinyId":"1111111111111111111111111111111111111111111111111111111111111111"}}]},"direct":[],"answer":null,"suggestions":[],"unsupported":null,"draftId":"b86927c9ffda49b7a1fade5a2a3ba67c"}"# }
    private var nonsense: String { #"{"ok":true,"understood":false,"confidence":0.0,"summary":"","message":"I can’t turn “make me a sandwich” into a bot action. Try one of these:","clarification":null,"confirmation":{"required":false,"reasons":[]},"goal":null,"direct":[],"answer":null,"suggestions":["get me a shiny Mewtwo","heal then go to Cinnabar and save","catch 3 adamant Abra in Ultra Balls"],"unsupported":null,"draftId":"f02a9af6bf8942d58b4d921faa5f2512"}"# }
    // G2 session.goals (the real GoalStore.summary for a running Mewtwo goal with one queued behind it).
    private var goals: String { #"{"active":{"detail":"Hunting Mewtwo: hunting, 0 encounters.","id":"490efe01-cda4-4a4d-9ca2-59c2fb0b7b67","kind":"farming","phase":"hunting","question":null,"result":null,"status":"running","step":0,"steps":1,"text":"get me a shiny Mewtwo","updatedAt":"2026-09-24T12:14:37.893397+00:00"},"decisions":[],"last":null,"queued":1}"# }

    private func flow(after reply: String?, text: String = "catch a mewt") async -> BotRequestFlow {
        let value = reply.map(json)
        let flow = BotRequestFlow(client: "mac", transport: BotRequestTransport(get: { _ in throw SuiteError("offline") }, post: { _, _ in
            guard let value else { throw SuiteError("offline") }
            return value
        }))
        if reply != nil { await flow.submit(text, via: .voice) }
        return flow
    }

    private func render<V: View>(_ view: V, width: CGFloat, name: String) throws -> CGSize {
        let host = NSHostingView(rootView: view.padding(12).frame(width: width).background(Color(nsColor: .windowBackgroundColor)))
        let size = host.fittingSize
        host.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        if let directory = ProcessInfo.processInfo.environment["ASK_REVIEW_IMAGES"], let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
            host.cacheDisplay(in: host.bounds, to: bitmap)
            try FileManager.default.createDirectory(at: URL(fileURLWithPath: directory), withIntermediateDirectories: true)
            try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
        }
        return size
    }

    func testAskStatesFitTheBotHeader() async throws {
        let summary = SuiteGoals(summary: json(goals))
        for (name, reply, text) in [("ask-idle", nil, ""), ("ask-clarify", clarify, "catch a mewt"), ("ask-confirm", trade, "trade my shiny charizard"),
                                    ("ask-suggestions", nonsense, "make me a sandwich")] as [(String, String?, String)] {
            let flow = await flow(after: reply, text: text)
            let size = try render(BotAskPanel(flow: flow, sessionGoals: summary), width: 620, name: name)
            XCTAssertEqual(size.width, 620, accuracy: 1)
            XCTAssertLessThanOrEqual(size.height, 260, "\(name): the Ask area must leave the Bot page its configuration forms")
        }
    }

    func testActivityShowsTheRequestCard() throws {
        var session = json(#"{"sessionId":"fixture","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","bot":{"enabled":true,"runScope":"task"},"spectator":{"map":{"name":"Cerulean Cave B1F"}}}"#)
        session["goals"] = json(goals)
        let p = ActivityPresentation(session: session, now: Date(timeIntervalSince1970: 1002))
        XCTAssertNotNil(p.outline.request)
        for width in [340.0, 700.0] {
            let size = try render(ActivityContent(presentation: p), width: width, name: "activity-request-\(Int(width))")
            XCTAssertLessThanOrEqual(size.height, 600)
        }
    }
}
