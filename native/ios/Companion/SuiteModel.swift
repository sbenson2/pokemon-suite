import SwiftUI
import SuiteCore
import Security
import Network

enum SuitePage: String, CaseIterable, Identifiable {
    case library="Games", live="Live game", pokedex="Bank", farming="Farming", trading="Trading", bot="Bot settings"
    var id: String { rawValue }
    var symbol: String { switch self { case .library:"square.stack.3d.up";case .live:"gamecontroller";case .pokedex:"book.closed";case .farming:"scope";case .trading:"arrow.left.arrow.right";case .bot:"slider.horizontal.3" } }
}

@MainActor final class SuiteModel: ObservableObject {
    @Published var page: SuitePage = .library
    @Published var state: JSONValue = .null
    @Published var dex: JSONValue = .null
    @Published var selectedGame="firered"
    @Published var selectedSpecies=1
    @Published var api: SuiteAPI?
    @Published var pairing: SuitePairing?
    @Published var connected=false
    @Published var connectionIssue:String?
    @Published var starting=false
    @Published var busy=false
    @Published var error: String?
    @Published var notice: String?
    @Published var showSettings=false
    @Published var reportURL: URL?
    let playback=GamePlayback()
    private var poll: Task<Void,Never>?
    private var generation=0
    private var dexGame=""
    private var active=true
    private var refreshingGeneration:Int?
    private var followOnConnect=true
    private var lastMacGame:String?
    private let network=NWPathMonitor()
    private var draftStore:(host:String,store:HuntDraftStore)?
    @Published var manual=false
    /// "Ask the bot" posts through the companion's authenticated relay (the paired SuiteAPI).
    lazy var requests=BotRequestFlow(client:"ios",transport:BotRequestTransport(
        get:{[weak self] path in
            guard let self,self.connected,let api=self.api else{throw SuiteError("Mac unavailable. Reconnecting…")}
            return try await api.get(path)
        },
        post:{[weak self] path,body in
            guard let self,self.connected,let api=self.api else{throw SuiteError("Mac unavailable. Reconnecting…")}
            return try await api.post(path,body)
        }))
    /// The Bank's "Get it": the same request flow as Ask, with its own draft so the two never replace each other's preview.
    lazy var bankRequests=BotRequestFlow(client:"ios-bank",transport:BotRequestTransport(
        get:{[weak self] path in
            guard let self,self.connected,let api=self.api else{throw SuiteError("Mac unavailable. Reconnecting…")}
            return try await api.get(path)
        },
        post:{[weak self] path,body in
            guard let self,self.connected,let api=self.api else{throw SuiteError("Mac unavailable. Reconnecting…")}
            return try await api.post(path,body)
        }))
    var games: [JSONValue] { state["library"].array }
    var game: JSONValue { games.first { $0["id"].string==selectedGame } ?? .null }
    var session: JSONValue { state["sessions"].array.first { $0["game"].string==selectedGame } ?? .null }
    var installed: Bool { game["status"].string=="installed" }
    var gameRunning: Bool { session["state"].string == "reconnecting" || (!session["sessionId"].string.isEmpty && !["offline","closed"].contains(session["state"].string)) }
    var species: [JSONValue] { dex["species"].array }
    var chosenPokemon: JSONValue { species.first { $0["id"].int==selectedSpecies } ?? .null }
    var title: String { game["title"].string.nonempty ?? "Pokémon Suite" }
    func huntDraftStore() throws -> HuntDraftStore {
        guard let pairing else{throw SuiteError("Connect to your Mac first.")}
        let host=pairing.certificateSHA256
        if let draftStore,draftStore.host==host{return draftStore.store}
        let directory=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
        let store=try HuntDraftStore(url:directory.appendingPathComponent("hunt-drafts-\(host).json"))
        draftStore=(host,store);return store
    }
    init() {
        network.pathUpdateHandler={ [weak self] _ in Task { @MainActor in
            guard let self,self.active else{return};await self.refresh()
        }}
        network.start(queue:DispatchQueue(label:"suite-companion-network"))
        if let value=UserDefaults.standard.string(forKey:"companion-page"),let page=SuitePage(rawValue:value=="Pokédex" ? SuitePage.pokedex.rawValue:value) { self.page=page }  // the Pokédex became the Bank
        selectedGame=UserDefaults.standard.string(forKey:"companion-game") ?? "firered"
    }
    func launch() async {
        // Developer provisioning uses the same validated connection code as pairing.
        // Consume it once, moving credentials into Keychain, not into the app bundle.
        let file=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("Companion.json")
        if let data=try? Data(contentsOf:file),let code=String(data:data,encoding:.utf8) {
            do { let value=try SuitePairing(code:code);try PairingStore.save(value);try FileManager.default.removeItem(at:file) }
            catch { self.error=error.localizedDescription }
        }
        if let value=PairingStore.load() { await connect(value) }
    }
    func connectCode(_ code: String) {
        do { let value=try SuitePairing(code:code);try PairingStore.save(value);Task { await connect(value) } }
        catch { self.error=error.localizedDescription }
    }
    func connect(_ value: SuitePairing) async {
        generation+=1;let lease=generation;poll?.cancel();playback.stop()
        pairing=value;starting=true;connected=false;state = .null;dex = .null;dexGame="";error=nil;connectionIssue=nil;followOnConnect=true;lastMacGame=nil
        api=SuiteAPI(baseURL:value.url,bearerToken:value.token,certificateSHA256:value.certificateSHA256)
        await refresh(lease:lease);starting=false
        poll=Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for:.seconds(2)) } catch { return }
                guard let self, self.generation==lease else { return }
                if self.active { await self.refresh(lease:lease) }
            }
        }
    }
    func refresh(lease: Int? = nil) async {
        let ticket=lease ?? generation
        guard let api,refreshingGeneration != ticket else { return }
        refreshingGeneration=ticket
        defer { if refreshingGeneration==ticket{refreshingGeneration=nil} }
        do {
            let current=try await api.get("/api/state")
            guard generation==ticket,!Task.isCancelled else { return }
            state=current;connected=true;connectionIssue=nil
            if let remoteGame=CompanionSelection.game(in:current) {
                if followOnConnect || remoteGame != lastMacGame {
                    if remoteGame != selectedGame {manual=false;playback.releaseInput();playback.stop();selectedGame=remoteGame;dex = .null;dexGame=""}
                    if followOnConnect && gameRunning{page = .live}
                }
                lastMacGame=remoteGame
            }
            followOnConnect=false
            if session["control"]["mode"].string != "manual" {manual=false}
            if notice=="Mac unavailable. Reconnecting…"{notice=nil}
            if !games.contains(where:{$0["id"].string==selectedGame}) { selectedGame=games.first?["id"].string ?? "firered" }
            await loadDex();syncPlayback();writeConnectionReport()
        } catch {
            guard ticket==generation else{return}
            // A failed telemetry poll says nothing about the independent video
            // stream or emulator lifetime. Keep receiving frames and retry the
            // status poll; release controls until fresh status returns.
            connected=false;manual=false;playback.manual=false;playback.releaseInput()
            connectionIssue=error.localizedDescription;notice="Mac unavailable. Reconnecting…"
            writeConnectionReport(error:error.localizedDescription)
        }
    }
    private func writeConnectionReport(error:String?=nil) {
        let value:[String:Any] = ["updatedAt":ISO8601DateFormatter().string(from:Date()),"connected":connected,"host":pairing?.name ?? "","game":selectedGame,"games":games.count,"frames":playback.frameCount,"error":error ?? ""]
        let file=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("Companion-status.json")
        if let data=try? JSONSerialization.data(withJSONObject:value){try? data.write(to:file,options:.atomic)}
    }
    func loadDex() async {
        guard let api,dexGame != selectedGame else{return}
        let game=selectedGame,lease=generation
        guard ["firered","leafgreen","emerald","crystal"].contains(game) else { dex = .null;dexGame=game;return }
        do { let value=try await api.get("/data/pokedex/\(game).json");guard game==selectedGame,lease==generation else{return};dex=value;dexGame=game
            if !species.contains(where:{$0["id"].int==selectedSpecies}) { selectedSpecies=species.first?["id"].int ?? 1 }
        } catch { if game==selectedGame { notice=error.localizedDescription } }
    }
    func selectGame(_ id: String) {
        guard selectedGame != id else{return};followOnConnect=false;playback.stop();selectedGame=id;dex = .null;dexGame=""
        UserDefaults.standard.set(id,forKey:"companion-game")
        Task { await loadDex();syncPlayback() }
    }
    func syncPlayback() {
        UserDefaults.standard.set(page.rawValue,forKey:"companion-page")
        guard active,page == .live,gameRunning,let api else {playback.stop();return}
        playback.connect(api:api,game:selectedGame,sessionID:session["sessionId"].string,platform:game["platform"].string);playback.manual=manual
    }
    func sceneActive(_ value: Bool) { if value && !active{followOnConnect=true};active=value;if !value{manual=false};if value {Task{await refresh()}} else {playback.stop()} }
    deinit{network.cancel();poll?.cancel()}
    func disconnect() {generation+=1;poll?.cancel();playback.stop();api=nil;pairing=nil;connected=false;connectionIssue=nil;state = .null;dex = .null;PairingStore.remove()}
    func perform(_ action: @escaping () async throws -> Void) {
        guard connected,!busy else{return};busy=true;error=nil;notice=nil
        Task {defer{busy=false};do{try await action();await refresh()}catch{self.error=error.localizedDescription}}
    }
    func command(_ path: String, fields: [String:JSONValue]=[:]) {
        let game=selectedGame
        perform { [self] in var value=fields;value["game"] = .string(game);try await api?.post(path,.object(value)) }
    }
    func startGame() {command("/api/pokemon-suite/start-game");page = .live}
    func stopGame() {playback.releaseInput();command("/api/pokemon-suite/stop-game",fields:["sessionId":session["sessionId"]])}
    func saveGame() {command("/api/pokemon-suite/save")}
    func setManual(_ value: Bool) {playback.releaseInput();if value{let game=selectedGame;perform{[self] in try await api?.post("/api/pokemon-suite/player-tasks",.object(["game":.string(game),"action":.string("stop")]));manual=true;playback.manual=true}}else{manual=false;playback.manual=false}}
    func requestsChanged() {Task{await refresh()}}
    func botAction(_ action: String,task: JSONValue?=nil) {var fields:[String:JSONValue]=["action":.string(action)];if let task{fields["task"]=task};command("/api/pokemon-suite/player-tasks",fields:fields)}
    /// A tapped "Why it stopped" fix: the existing player-tasks action with the triage token (the host re-checks it).
    func applyTriageFix(_ fix: StopTriage.Suggestion) {guard fix.canTap,let action=fix.playerTask,let token=fix.token else{return};command("/api/pokemon-suite/player-tasks",fields:["action":.string(action),"triage":.string(token)])}
    func openCompleteSuite() {notice="Additional host configuration is available in Pokémon Suite on your Mac."}
    func openSaveProfile(action:String,task:JSONValue) {
        let game=selectedGame
        perform { [self] in
            playback.releaseInput()
            try await api?.post("/api/pokemon-suite/player-tasks",.object(["game":.string(game),"action":.string(action),"task":task]))
            guard selectedGame==game else{return}
            manual=true;playback.manual=true;page = .live
        }
    }
    func exportReport() {exportReport(stoppingBot:false)}
    func exportReport(stoppingBot:Bool) {
        guard let api else{return}
        let game=selectedGame,sessionID=session["sessionId"].string
        perform { [self] in
            if stoppingBot {
                guard selectedGame==game,session["sessionId"].string==sessionID else{throw SuiteError("The game session changed. Export its report again.")}
                playback.releaseInput()
                try await api.post("/api/pokemon-suite/player-tasks",.object(["game":.string(game),"action":.string("stop")]))
                manual=false;playback.manual=false
            }
            let report=try await api.get("/api/pokemon-suite/reports?game=\(game)")["report"]
            let file=FileManager.default.temporaryDirectory.appendingPathComponent("pokemon-suite-\(game)-report.json")
            let encoder=JSONEncoder();encoder.outputFormatting=[.prettyPrinted,.sortedKeys]
            try encoder.encode(report).write(to:file,options:.atomic);reportURL=file
        }
    }
    func prepareOwnedTrade(_ plan:JSONValue) async throws {
        guard let api, !plan["pokemonId"].string.isEmpty else {throw SuiteError("Refresh the selected Pokémon before trading.")}
        guard plan["load"].isNull else {throw SuiteError("Load this saved collection on the Mac first, then choose Current game here.")}
        let game=plan["game"].string
        try await api.post("/api/pokemon-suite/player-tasks",.object(["game":.string(game),"action":.string("open-trade")]))
        let checked=try await api.post("/api/pokemon-suite/check-radio",.object(["game":.string(game)]))
        guard checked["radio"]["ready"].bool else {throw SuiteError(checked["radio"]["reason"].text)}
        let inventory=try await api.get("/api/pokemon-suite/inventory?game=\(game)&source=current")
        guard let mon=inventory["pokemon"].array.first(where:{$0["id"]==plan["pokemonId"]}),mon["canTrade"].bool else {throw SuiteError("This Pokémon is no longer ready to trade. Refresh the collection.")}
        try await api.post("/api/pokemon-suite/trade-pokemon",.object(["game":.string(game),"pokemonId":plan["pokemonId"],"sessionId":inventory["sessionId"],"sourceId":.string("current")]))
    }
}

enum PairingStore {
    static var query:[String:Any]{[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"pokemon-suite-companion",kSecAttrAccount as String:"mac"]}
    static func save(_ value:SuitePairing)throws {
        let attributes=[kSecValueData as String:Data(value.code.utf8)]
        var status=SecItemUpdate(query as CFDictionary,attributes as CFDictionary)
        if status==errSecItemNotFound {
            var item=query;item[kSecValueData as String]=attributes[kSecValueData as String]
            item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status=SecItemAdd(item as CFDictionary,nil)
        }
        guard status==errSecSuccess else{throw SuiteError("The Mac connection could not be saved securely (\(status)).")}
    }
    static func load()->SuitePairing?{var q=query;q[kSecReturnData as String]=true;var result:CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&result)==errSecSuccess,let data=result as? Data,let code=String(data:data,encoding:.utf8) else{return nil};return try? SuitePairing(code:code)}
    static func remove(){SecItemDelete(query as CFDictionary)}
}
