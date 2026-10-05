import XCTest
import SwiftUI
import AppKit
import SuiteCore
@testable import PokemonSuiteMac

/// The Bank's Get It and Inspect sheets keep their content within the sheet width.
/// With BANK_REVIEW_URL (a Suite serving the Bank and ROM artwork, e.g. tools/bank_stub.py) the page
/// and sheets are rendered with that Suite's data and artwork; BANK_REVIEW_IMAGES keeps those PNGs.
/// The fit checks run without a Suite, so their sprites are the offline placeholder and no PNG is kept.
@MainActor final class BankLayoutTests: XCTestCase {
    private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private var abra: JSONValue { json(#"{"id":63,"name":"Abra","types":["psychic"],"genderRate":2,"abilities":[{"id":28,"name":"Synchronize"},{"id":39,"name":"Inner Focus"}],"encounters":[],"evolutions":[]}"#) }
    private var route: JSONValue { json(#"{"category":"wild","label":"Wild","detail":"Walking: Road 24, Road 25","obtainable":true,"hunt":true}"#) }
    private var individual: JSONValue { json(#"{"id":"aa","slotId":"box:2:4","sourceId":"current","saveLabel":"Current game","isActiveSave":true,"name":"Abra","nationalSpeciesId":63,"types":["psychic"],"shiny":true,"level":20,"natureName":"Timid","ability":"Synchronize","heldItem":0,"location":{"kind":"box","box":2,"slot":4},"ivs":{"hp":31,"attack":2,"defense":20,"spAttack":30,"spDefense":25,"speed":31},"evs":{"hp":0,"attack":0,"defense":0,"spAttack":0,"spDefense":0,"speed":0},"moveDetails":[{"name":"Teleport","pp":20}],"canPrepare":true,"canTrade":false,"tradeReason":"Stop the current bot task before preparing a trade."}"#) }
    private var preview: JSONValue { json(#"{"ok":true,"understood":true,"confidence":1.0,"summary":"Catch shiny Timid Abra, then send it to the Switch (current save if it can reach it, else it asks)","message":"","clarification":null,"confirmation":{"required":true,"reasons":["Trades the shiny Abra away to the Switch after it is caught and saved."]},"goal":{"schema":"pokemon-suite/goal/v1","steps":[{"kind":"farming","request":{"speciesId":63,"quantity":1,"shiny":"required","limits":{"maxMinutes":60,"maxEncounters":1000}}},{"kind":"trade","via":"trade-pokemon","payload":{"pokemonId":{"$ref":"steps[0].result.captures.0.pokemonId"},"sourceId":"current"}}]},"direct":[],"answer":null,"suggestions":[],"unsupported":null,"preview":[{"clause":0,"speciesId":63,"canStart":true,"limitations":["Continue the current game and prepare the selected encounter route. Each new catch is saved before the next search."]}],"draftId":"b86927c9ffda49b7a1fade5a2a3ba67c"}"#) }

    private func model() -> SuiteModel {
        let model = SuiteModel()
        model.dex = json(#"{"game":"firered","natures":[{"id":"hardy","name":"Hardy","increased":null,"decreased":null},{"id":"timid","name":"Timid","increased":"speed","decreased":"attack"}],"species":[]}"#)
        return model
    }

    func testGetItShowsAsksReviewWithinTheSheet() async throws {
        let m = model()
        let flow = BotRequestFlow(client: "mac-bank", transport: BotRequestTransport(get: { _ in throw SuiteError("offline") }, post: { [preview] _, _ in preview }))
        var settings = BankDraft(speciesId: 63); settings.shiny = true; settings.natures = ["timid"]; settings.destination = "switch"; settings.setMinimumIV("speed", 31)
        await flow.select(settings.selection)
        XCTAssertEqual(flow.confirmLabel, "Confirm", "a Send to the Switch goal asks before running, as in Ask")
        let view = BankGetItView(mon: abra, route: route, flow: flow, settings: settings).environmentObject(m)
        let host = NSHostingView(rootView: view.frame(width: 560))
        XCTAssertLessThanOrEqual(host.fittingSize.width, 561)
        let unavailable = BankGetItView(mon: json(#"{"id":151,"name":"Mew","types":["psychic"],"genderRate":-1,"abilities":[],"encounters":[]}"#),
                                        route: json(#"{"category":"external","label":"External","detail":"Requires a legitimately acquired Pokémon from a compatible external source.","obtainable":false}"#), flow: flow).environmentObject(m)
        XCTAssertLessThanOrEqual(NSHostingView(rootView: unavailable.frame(width: 560)).fittingSize.width, 561)
    }

    func testInspectIsTradingsDetailWithSendToSwitch() throws {
        let sheet = BankIndividualSheet(mon: individual, owned: .null) {}.environmentObject(model())
        let host = NSHostingView(rootView: sheet)
        XCTAssertLessThanOrEqual(host.fittingSize.width, 481)
    }

    /// The whole page with a Suite's data (tools/bank_stub.py serves the Bank over read-only save copies).
    func testBankPageWithASuite() async throws {
        guard let address = ProcessInfo.processInfo.environment["BANK_REVIEW_URL"], let url = URL(string: address) else { throw XCTSkip("Set BANK_REVIEW_URL to render the page with a Suite's data.") }
        let m = SuiteModel()
        let api = SuiteAPI(baseURL: url)
        try await api.connect()
        m.api = api; m.state = try await api.get("/api/state"); m.selectedGame = "firered"
        m.dex = try await api.get("/data/pokedex/firered.json"); m.selectedSpecies = 63; m.page = .pokedex
        for dark in [false, true] {
            let page = PokedexView().environmentObject(m)
            let host = NSHostingView(rootView: page.frame(width: 1180, height: 760).background(Color(nsColor: .windowBackgroundColor)).environment(\.colorScheme, dark ? .dark : .light))
            host.frame = CGRect(x: 0, y: 0, width: 1180, height: 760)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            window.contentView = host
            window.orderFront(nil)
            for _ in 0..<40 { try await Task.sleep(for: .milliseconds(150)); host.layoutSubtreeIfNeeded() }
            if let directory = ProcessInfo.processInfo.environment["BANK_REVIEW_IMAGES"], let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: bitmap)
                try FileManager.default.createDirectory(at: URL(fileURLWithPath: directory), withIntermediateDirectories: true)
                try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("bank-page-\(dark ? "dark" : "light").png"))
            }
            window.orderOut(nil)
        }
        // The sheets as the page presents them: the same views with the page's model (its Suite, state and artwork).
        let bank = try await api.get("/api/pokemon-suite/bank?game=firered")
        let route = { (id: Int) in bank["species"].array.first { $0["id"].int == id }?["route"] ?? .null }
        var settings = BankDraft(speciesId: 63); settings.shiny = true; settings.natures = ["timid"]; settings.destination = "switch"
        await m.bankRequests.select(settings.selection)
        for dark in [false, true] {
            try await capture(BankGetItView(mon: m.chosenPokemon, route: route(63), flow: m.bankRequests, settings: settings).environmentObject(m),
                              size: CGSize(width: 560, height: 1250), name: "bank-get-it-abra-\(dark ? "dark" : "light")", dark: dark)
        }
        let mew = m.species.first { $0["id"].int == 151 } ?? .null
        try await capture(BankGetItView(mon: mew, route: route(151), flow: BotRequestFlow(client: "review", transport: BotRequestTransport(get: { _ in .null }, post: { _, _ in .null }))).environmentObject(m),
                          size: CGSize(width: 560, height: 380), name: "bank-get-it-mew")
        let owned = try await api.get("/api/pokemon-suite/bank?game=firered&species=63")
        if let first = BankIndex.individuals(owned).first {
            try await capture(BankIndividualSheet(mon: first, owned: owned) {}.environmentObject(m), size: CGSize(width: 480, height: 600), name: "bank-inspect-abra")
        }
    }

    private func capture<V: View>(_ view: V, size: CGSize, name: String, dark: Bool = false) async throws {
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height).background(Color(nsColor: .windowBackgroundColor)).environment(\.colorScheme, dark ? .dark : .light))
        host.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host; window.orderFront(nil)
        for _ in 0..<20 { try await Task.sleep(for: .milliseconds(150)); host.layoutSubtreeIfNeeded() }
        if let directory = ProcessInfo.processInfo.environment["BANK_REVIEW_IMAGES"], let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
            host.cacheDisplay(in: host.bounds, to: bitmap)
            try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
        }
        window.orderOut(nil)
    }
}
