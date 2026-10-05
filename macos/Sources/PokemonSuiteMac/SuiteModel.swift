import AppKit
import SwiftUI
import SuiteCore
import UniformTypeIdentifiers

enum SuitePage: String, CaseIterable, Identifiable {
    case library = "Games", live = "Live game", pokedex = "Bank", farming = "Farming", trading = "Trading", bot = "Bot settings"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .library: "square.stack.3d.up"
        case .live: "gamecontroller"
        case .pokedex: "book.closed"
        case .farming: "scope"
        case .trading: "arrow.left.arrow.right"
        case .bot: "slider.horizontal.3"
        }
    }
}

@MainActor final class SuiteModel: ObservableObject {
    @Published var page: SuitePage = .library
    @Published var state: JSONValue = .null
    @Published var selectedGame = "firered"
    @Published var selectedSpecies = 1
    @Published var dex: JSONValue = .null
    @Published var api: SuiteAPI?
    @Published var error: String?
    @Published var notice: String?
    @Published var busy = false
    @Published var starting = true
    @Published var manual = false
    @Published var quitting = false
    @Published var profile: URL
    /// A Bot settings section another page asked to show (for example New run for a brand-new save).
    @Published var botSectionRequest: String?
    let host = ServiceHost()
    let companion = CompanionHost()
    let playback = GamePlayback()
    private var poll: Task<Void, Never>?
    private var dexGame = ""
    private var dexRevision = ""
    private var refreshing = false
    private var switching = false
    private var presentingPanel = false
    private var draftStore: (profile: URL, store: HuntDraftStore)?
    private let smoke: Bool
    /// "Ask the bot": natural-language requests through the local control session.
    lazy var requests = BotRequestFlow(client: "mac", transport: BotRequestTransport(
        get: { [weak self] path in
            guard let api = self?.api else { throw SuiteError("The game service is unavailable.") }
            return try await api.get(path)
        },
        post: { [weak self] path, body in
            guard let api = self?.api else { throw SuiteError("The game service is unavailable.") }
            return try await api.post(path, body)
        }))

    /// The Bank's "Get it": the same request flow as Ask, with its own draft so the two never replace each other's preview.
    lazy var bankRequests = BotRequestFlow(client: "mac-bank", transport: BotRequestTransport(
        get: { [weak self] path in
            guard let api = self?.api else { throw SuiteError("The game service is unavailable.") }
            return try await api.get(path)
        },
        post: { [weak self] path, body in
            guard let api = self?.api else { throw SuiteError("The game service is unavailable.") }
            return try await api.post(path, body)
        }))

    init() {
        let args = ProcessInfo.processInfo.arguments
        smoke = args.contains("--smoke-test")
        let explicit = args.firstIndex(of: "--profile").flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil }
        let saved = UserDefaults.standard.string(forKey: "profilePath")
        profile = URL(fileURLWithPath: explicit ?? saved ?? NSHomeDirectory() + "/Library/Application Support/PokemonSuite", isDirectory: true)
        if let explicit, !smoke { UserDefaults.standard.set(explicit, forKey: "profilePath") }
        if let raw = UserDefaults.standard.string(forKey: "selectedPage"), let value = SuitePage(rawValue: raw) { page = value }
        if UserDefaults.standard.string(forKey: "selectedPage") == "Caught shinies" { page = .trading }
        if UserDefaults.standard.string(forKey: "selectedPage") == "Pokédex" { page = .pokedex }  // the Pokédex became the Bank
        UserDefaults.standard.removeObject(forKey: "appearance")  // the Light/Dark setting was removed; the app follows macOS
    }

    var games: [JSONValue] { state["library"].array }
    var game: JSONValue { games.first { $0["id"].string == selectedGame } ?? .null }
    var session: JSONValue { state["sessions"].array.first { $0["game"].string == selectedGame } ?? .null }
    var installed: Bool { game["status"].string == "installed" }
    var gameRunning: Bool { session["state"].string == "reconnecting" || (!session["sessionId"].string.isEmpty && !["offline", "closed"].contains(session["state"].string)) }
    var species: [JSONValue] { dex["species"].array }
    var chosenPokemon: JSONValue { species.first { $0["id"].int == selectedSpecies } ?? species.first ?? .null }
    var title: String { game["title"].string.nonempty ?? "Pokémon Suite" }

    func huntDraftStore() throws -> HuntDraftStore {
        if let draftStore, draftStore.profile == profile { return draftStore.store }
        let store = try HuntDraftStore(url: profile.appendingPathComponent("native/hunt-drafts.json"))
        draftStore = (profile, store)
        return store
    }

    func openBotSection(_ section: String) { botSectionRequest = section; page = .bot }

    func openCompleteSuite() { if let url = host.baseURL { NSWorkspace.shared.open(url) } }
    func openHelp() {
        if let url = Bundle.main.resourceURL?.appendingPathComponent("Suite/docs/MACOS.md") { NSWorkspace.shared.open(url) }
    }

    func launch() async {
        guard api == nil, !switching else { return }
        starting = true; error = nil
        do {
            let address = try await host.start(profile: profile)
            let client = SuiteAPI(baseURL: address)
            try await client.connect(); api = client
            try await refresh()
            if let current = state["session"]["game"].string.nonempty { selectedGame = current }
            await loadDex()
            starting = false
            if UserDefaults.standard.bool(forKey: "companionEnabled") { companion.start(service: address, profile: profile) }
            poll = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(2))
                    guard let self, !Task.isCancelled, !self.quitting else { continue }
                    do { try await self.refresh() } catch { self.notice = error.localizedDescription }
                }
            }
            if smoke { page = .pokedex }
        } catch { starting = false; self.error = error.localizedDescription }
    }

    func refresh() async throws {
        guard let api, !refreshing else { return }
        refreshing = true; defer { refreshing = false }
        state = try await api.get("/api/state")
        if dexGame == selectedGame && dexRevision != state["software"]["active"]["data:" + selectedGame].string { dexGame = ""; await loadDex() }
        if gameRunning && page == .live && NSApp.windows.contains(where: { $0.isVisible }) { playback.connect(api: api, game: selectedGame, sessionID: session["sessionId"].string, platform: game["platform"].string) }
        else { playback.stop() }
        let nativeManual = session["control"]["mode"].string == "manual"
        if manual && !nativeManual { manual = false; playback.releaseInput() }
        playback.manual = manual && nativeManual
    }

    func selectGame(_ id: String) async {
        guard id != selectedGame else { return }
        manual = false; playback.releaseInput(); playback.stop(); selectedGame = id
        do {
            if installed { try await api?.post("/api/select", .object(["game": .string(id)])) }
            try await refresh(); await loadDex()
        } catch { self.error = error.localizedDescription }
    }

    func loadDex() async {
        guard let api, dexGame != selectedGame else { return }
        let game = selectedGame
        guard ["firered","leafgreen","emerald","crystal"].contains(game) else { dex = .null; dexGame = game; return }
        do {
            let result = try await api.get("/data/pokedex/\(game).json")
            guard selectedGame == game else { return }
            dex = result; dexGame = game; dexRevision = state["software"]["active"]["data:" + game].string
            if !species.contains(where: { $0["id"].int == selectedSpecies }) { selectedSpecies = species.first?["id"].int ?? 1 }
        } catch { self.error = error.localizedDescription }
    }

    func perform(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true; error = nil; notice = nil
        Task { defer { busy = false }; do { try await action(); try await refresh() } catch { self.error = error.localizedDescription } }
    }

    func startGame() {
        perform { [self] in
            try await api?.post("/api/pokemon-suite/start-game", .object(["game": .string(selectedGame)]))
            page = .live; manual = false
        }
    }
    func stopGame() {
        let game = selectedGame, id = session["sessionId"].string
        perform { [self] in
            playback.releaseInput()
            let result = try await api?.post("/api/pokemon-suite/stop-game", .object(["game": .string(game), "sessionId": .string(id)]))
            if result?["session"]["state"].string != "closed" { notice = "The game is paused for a linked task. Finish the trade or evolution before closing it." }
            manual = false
        }
    }
    func saveGame() { perform { [self] in try await api?.post("/api/pokemon-suite/save", .object(["game": .string(selectedGame)])); notice = "Game saved." } }
    func setManual(_ value: Bool) {
        perform { [self] in
            playback.releaseInput()
            if value { try await api?.post("/api/pokemon-suite/player-tasks", .object(["game": .string(selectedGame), "action": .string("stop")])) }
            manual = value; playback.manual = value
        }
    }
    /// A request was committed or cancelled: show the goal status without waiting for the next poll.
    func requestsChanged() { Task { try? await refresh() } }
    func botAction(_ action: String, task: JSONValue? = nil) {
        perform { [self] in
            var value: JSONValue = .object(["game": .string(selectedGame), "action": .string(action)])
            if let task { value["task"] = task }
            try await api?.post("/api/pokemon-suite/player-tasks", value)
            manual = false; playback.manual = false
        }
    }

    /// A tapped "Why it stopped" fix: the existing player-tasks action with the triage token.
    /// The host re-derives the suggestion and refuses it (409) if the stop changed.
    func applyTriageFix(_ fix: StopTriage.Suggestion) {
        guard fix.canTap, let action = fix.playerTask, let token = fix.token else { return }
        let game = selectedGame
        perform { [self] in
            try await api?.post("/api/pokemon-suite/player-tasks", .object(["game": .string(game), "action": .string(action), "triage": .string(token)]))
            manual = false; playback.manual = false
        }
    }

    func openSaveProfile(action: String, task: JSONValue) {
        let game = selectedGame
        perform { [self] in
            playback.releaseInput()
            try await api?.post("/api/pokemon-suite/player-tasks", .object(["game": .string(game), "action": .string(action), "task": task]))
            guard selectedGame == game else { return }
            manual = true; playback.manual = true; page = .live
        }
    }

    private func present(_ panel: NSSavePanel) async -> NSApplication.ModalResponse {
        await withCheckedContinuation { continuation in
            if let window = NSApp.keyWindow {
                panel.beginSheetModal(for: window) { continuation.resume(returning: $0) }
            } else { panel.begin { continuation.resume(returning: $0) } }
        }
    }

    func addFireRed() {
        guard !presentingPanel, !busy, api != nil else { return }
        presentingPanel = true
        Task {
            defer { presentingPanel = false }
            let rom = NSOpenPanel(); rom.title = "Choose your FireRed or LeafGreen US revision 1 game"; rom.allowedContentTypes = [UTType(filenameExtension: "gba") ?? .data]; rom.allowsMultipleSelection = false
            guard await present(rom) == .OK, let image = rom.url else { return }
            perform { [self] in
                // The emulator core and bot knowledge ship inside the app. The
                // verified image says whether it is FireRed or LeafGreen.
                let installed = try await api?.post("/api/install/frlg", .object(["rom": .string(image.path)]))
                let game = installed?["game"].string == "leafgreen" ? "leafgreen" : "firered"
                selectedGame = game; dexGame = ""; await loadDex(); page = .live; notice = "\(game == "leafgreen" ? "LeafGreen" : "FireRed") added. Start game when you’re ready."
            }
        }
    }

    func chooseProfile() {
        guard !presentingPanel, !busy else { return }
        presentingPanel = true
        Task {
            defer { presentingPanel = false }
            let panel = NSOpenPanel(); panel.title = "Open a Pokémon Suite library"; panel.canChooseDirectories = true; panel.canChooseFiles = false
            guard await present(panel) == .OK, let folder = panel.url else { return }
            guard FileManager.default.fileExists(atPath: folder.appendingPathComponent("config.json").path) else { error = "Choose the Suite folder containing config.json and your game saves."; return }
            perform { [self] in
                try await quitService()
                profile = folder; UserDefaults.standard.set(folder.path, forKey: "profilePath")
                dexGame = ""; state = .null; quitting = false
                await launch()
            }
        }
    }

    func chooseROMFolder() {
        guard !presentingPanel, !busy, api != nil else { return }
        presentingPanel = true
        Task {
            defer { presentingPanel = false }
            let panel = NSOpenPanel()
            panel.title = "Choose your ROM collection"
            panel.message = "Choose the folder containing your gb, gbc, gba, nds, 3ds, or switch folders. ROMs stay in their current location."
            panel.canChooseDirectories = true; panel.canChooseFiles = false
            guard await present(panel) == .OK, let folder = panel.url else { return }
            perform { [self] in
                try await api?.post("/api/pokemon-suite/scan-library", .object(["folder": .string(folder.path)]))
                notice = "ROM collection scanned. Available artwork now loads from your cartridges."
            }
        }
    }

    func prepareOwnedTrade(_ plan: JSONValue) async throws {
        let game = plan["game"].string, pokemon = plan["pokemonId"]
        guard !game.isEmpty, !pokemon.string.isEmpty else { throw SuiteError("Refresh the selected Pokémon before trading.") }
        if let path = plan["load"]["libraryPath"].string.nonempty {
            let folder = URL(fileURLWithPath: path, isDirectory: true)
            if folder.resolvingSymlinksInPath() != profile.resolvingSymlinksInPath() {
                try await quitService()
                profile = folder; UserDefaults.standard.set(folder.path, forKey: "profilePath")
                dexGame = ""; state = .null; quitting = false
                await launch()
            }
            guard let api else { throw SuiteError(error ?? "The saved game’s library could not open.") }
            try await api.post("/api/pokemon-suite/player-tasks", .object(["game": .string(game), "action": .string("restore-save"), "task": .object(["profileId": plan["load"]["profileId"]])]))
        } else {
            guard let api else { throw SuiteError("The game service is unavailable.") }
            try await api.post("/api/pokemon-suite/player-tasks", .object(["game": .string(game), "action": .string("open-trade")]))
        }
        guard let api else { throw SuiteError("The game service is unavailable.") }
        selectedGame = game; manual = false; playback.manual = false
        try await api.post("/api/pokemon-suite/inventory-source", .object(["game": .string(game), "sourceId": .string("current")]))
        let radio = (try await api.post("/api/pokemon-suite/check-radio", .object(["game": .string(game)])))["radio"]
        guard radio["ready"].bool else { throw SuiteError(radio["reason"].string) }
        let inventory = try await api.get("/api/pokemon-suite/inventory?game=\(game)&source=current")
        guard let selected = inventory["pokemon"].array.first(where: { $0["id"] == pokemon }), selected["canTrade"].bool else {
            throw SuiteError(inventory["pokemon"].array.first(where: { $0["id"] == pokemon })?["tradeReason"].string.nonempty ?? "The selected Pokémon could not be verified in the loaded save.")
        }
        try await api.post("/api/pokemon-suite/trade-pokemon", .object(["game": .string(game), "pokemonId": pokemon, "sessionId": inventory["sessionId"], "sourceId": .string("current")]))
        page = .trading
    }

    func quitService() async throws {
        quitting = true; playback.releaseInput()
        do {
            if let api { try await api.post("/api/desktop/quit") }
            else { host.cancelStartup() }
            if host.running { try await host.finishAfterGracefulQuit() }
            companion.stop(); playback.stop(); poll?.cancel(); poll = nil; api = nil
        } catch { quitting = false; throw error }
    }

    func exportReport() { exportReport(stoppingBot: false) }

    func exportReport(stoppingBot: Bool) {
        guard !presentingPanel, !busy, let api else { return }
        let game = selectedGame, sessionID = session["sessionId"].string
        presentingPanel = true; busy = true
        Task {
            defer { presentingPanel = false; busy = false }
            let panel = NSSavePanel(); panel.nameFieldStringValue = "pokemon-suite-\(game)-report.json"; panel.allowedContentTypes = [.json]
            guard await present(panel) == .OK, let url = panel.url else { return }
            busy = true
            do {
                if stoppingBot {
                    guard selectedGame == game, session["sessionId"].string == sessionID else {
                        throw SuiteError("The selected game session changed. Export its report again.")
                    }
                    playback.releaseInput()
                    try await api.post("/api/pokemon-suite/player-tasks", .object(["game": .string(game), "action": .string("stop")]))
                    manual = false; playback.manual = false
                }
                let report = try await api.get("/api/pokemon-suite/reports?game=\(game)")["report"]
                let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                try encoder.encode(report).write(to: url, options: .atomic)
                notice = stoppingBot ? "Stop requested and report exported." : "Report exported."
                try await refresh()
            } catch { self.error = error.localizedDescription }
        }
    }
}
