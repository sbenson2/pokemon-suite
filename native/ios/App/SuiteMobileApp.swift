import SwiftUI
import WebKit
import AVFoundation
import UniformTypeIdentifiers

@main struct SuiteMobileApp: App {
    @StateObject private var model = MobileModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup { SuiteRoot(model: model).onChange(of: phase) { _, value in
            if value != .active { model.suspend() }
        } }
    }
}

@MainActor final class MobileModel: NSObject, ObservableObject, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    @Published var status: [String: Any] = [:]
    @Published var message: String?
    @Published var ready = false
    @Published var loading = false
    @Published var muted = false
    @Published var hasROM = false
    @Published var selectedTab = 0
    let storage: LocalStorage
    let audio = GameAudio()
    private(set) var webView: WKWebView!
    private var manualButtons = Set<String>()
    private var heartbeat: Timer?
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    var mode: String { status["mode"] as? String ?? "idle" }
    var campaign: [String: Any]? { status["campaign"] as? [String: Any] }
    var trainer: [String: Any]? { status["trainer"] as? [String: Any] }

    override init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        do { storage = try LocalStorage(root: documents.appendingPathComponent("Suite", isDirectory: true)) }
        catch { fatalError("Cannot open the app's local storage: \(error)") }
        super.init()
        hasROM = FileManager.default.fileExists(atPath: storage.romURL.path)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(LocalAssets(storage: storage), forURLScheme: "suite-local")
        config.userContentController.add(self, name: "suiteEvent")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "suiteSave")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false; webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.load(URLRequest(url: URL(string: "suite-local://runtime/index.html")!))
        heartbeat = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, !self.manualButtons.isEmpty, self.mode == "manual" else { return }
                self.command(["action": "buttons", "buttons": Array(self.manualButtons)])
            }
        }
    }
    func command(_ value: [String: Any], done: ((Result<Any?, Error>) -> Void)? = nil) {
        Task { @MainActor in
            do {
                let result = try await webView.callAsyncJavaScript("return await window.suite.command(command)", arguments: ["command": value], in: nil, contentWorld: .page)
                done?(.success(result))
            } catch { loading = false; reportError(error.localizedDescription); done?(.failure(error)) }
        }
    }
    private func reportError(_ text: String) {
        message = text
        try? Data(text.utf8).write(to: storage.root.appendingPathComponent("last-error.txt"), options: .atomic)
    }
    func loadGame() {
        guard hasROM, ready else { return }
        loading = true; message = nil
        command(["action": "load"]) { [weak self] _ in self?.loading = false }
    }
    func importROM(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do { try storage.importROM(Data(contentsOf: url)); hasROM = true; loadGame() }
        catch { message = error.localizedDescription }
    }
    func prepare(starter: String) { command(["action": "prepare", "settings": ["starter": starter]]) }
    func start() { audio.active = !muted; command(["action": "start"]) }
    func manual() { audio.active = !muted; command(["action": "manual"]) }
    func pause() { releaseButtons(); audio.stop(); command(["action": "pause"]) }
    func press(_ key: String, down: Bool) {
        guard mode == "manual" else { return }
        if down { manualButtons.insert(key) } else { manualButtons.remove(key) }
        command(["action": "buttons", "buttons": Array(manualButtons)])
    }
    func releaseButtons() {
        manualButtons.removeAll()
        if mode == "manual" { command(["action": "buttons", "buttons": []]) }
    }
    func newAdventure() {
        command(["action": "close"]) { [weak self] result in
            guard let self, case .success = result else { return }
            do { try self.storage.archiveAdventure(); self.status = [:]; self.loadGame() }
            catch { self.message = error.localizedDescription }
        }
    }
    func suspend() {
        releaseButtons(); audio.stop()
        guard hasROM, ready, !status.isEmpty else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save local adventure") { [weak self] in self?.endBackgroundTask() }
        command(["action": "pause"]) { [weak self] _ in self?.endBackgroundTask() }
    }
    private func endBackgroundTask() {
        if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive event: WKScriptMessage) {
        guard let data = event.body as? [String: Any], let type = data["type"] as? String else { return }
        if type == "ready" { ready = true; loadGame() }
        if type == "error" { reportError(data["message"] as? String ?? "The local runtime stopped."); loading = false }
        if type == "audio", let text = data["pcm"] as? String, let pcm = Data(base64Encoded: text), let rate = data["sampleRate"] as? Double {
            audio.consume(pcm, sampleRate: rate); return
        }
        if type == "status", let value = data["status"] as? [String: Any] {
            status = value; UIApplication.shared.isIdleTimerDisabled = mode == "bot" || mode == "manual"
            if let encoded = try? JSONSerialization.data(withJSONObject: value) {
                try? encoded.write(to: storage.root.appendingPathComponent("status.json"), options: .atomic)
            }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let text = message.body as? String else { replyHandler(nil, "Invalid checkpoint message."); return }
        do { try storage.saveCheckpoint(text); replyHandler(["saved": true], nil) }
        catch { replyHandler(nil, error.localizedDescription) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false; loading = false; audio.stop()
        message = "The local game engine stopped. Reopen the game to restore its last checkpoint."
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.scheme == "suite-local" ? .allow : .cancel)
    }
}

final class LocalAssets: NSObject, WKURLSchemeHandler {
    let storage: LocalStorage
    init(storage: LocalStorage) { self.storage = storage }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        do {
            guard let url = task.request.url else { throw CocoaError(.fileReadInvalidFileName) }
            let data: Data; let mime: String
            guard url.host == "runtime" else { throw CocoaError(.fileReadNoPermission) }
            if url.path == "/cartridge.gba" { data = try Data(contentsOf: storage.romURL); mime = "application/octet-stream" }
            else if url.path == "/current.json" {
                let saved = FileManager.default.fileExists(atPath: storage.checkpointURL.path)
                    ? try String(contentsOf: storage.checkpointURL, encoding: .utf8) : "null"
                data = Data(("{\"checkpoint\":" + saved + "}").utf8); mime = "application/json"
            } else {
                let allowed = ["index.html", "runtime.js", "mgba.js", "mgba.wasm", "build-manifest.json", "runtime.json", "world.json", "story.json", "battle.json"]
                let name = String(url.path.dropFirst())
                guard url.host == "runtime", allowed.contains(name), let base = Bundle.main.resourceURL else { throw CocoaError(.fileReadNoPermission) }
                data = try Data(contentsOf: base.appendingPathComponent("RuntimeAssets").appendingPathComponent(name))
                mime = name.hasSuffix(".html") ? "text/html" : name.hasSuffix(".js") ? "application/javascript" : name.hasSuffix(".json") ? "application/json" : "application/wasm"
            }
            task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-store"])!)
            task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

@MainActor final class GameAudio {
    private let engine = AVAudioEngine(), player = AVAudioPlayerNode()
    private var format: AVAudioFormat?
    var active = false
    init() { engine.attach(player) }
    func consume(_ data: Data, sampleRate: Double) {
        guard active, !data.isEmpty else { return }
        do {
            if format == nil {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                try AVAudioSession.sharedInstance().setActive(true)
                format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)
                engine.connect(player, to: engine.mainMixerNode, format: format)
            }
            if !engine.isRunning { try engine.start() }
            if !player.isPlaying { player.play() }
            let frames = data.count / 4
            guard let format, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)), let channels = buffer.floatChannelData else { return }
            buffer.frameLength = AVAudioFrameCount(frames)
            data.withUnsafeBytes { raw in
                let samples = raw.bindMemory(to: Int16.self)
                for i in 0..<frames { channels[0][i] = Float(Int16(littleEndian: samples[i*2])) / 32768; channels[1][i] = Float(Int16(littleEndian: samples[i*2+1])) / 32768 }
            }
            player.scheduleBuffer(buffer)
        } catch { active = false }
    }
    func stop() { active = false; player.stop(); engine.pause() }
}

struct GameSurface: UIViewRepresentable {
    let model: MobileModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct SuiteRoot: View {
    @ObservedObject var model: MobileModel
    @State private var importing = false
    @State private var confirmNew = false
    @State private var starter = "random"
    var body: some View {
        GeometryReader { geometry in
        VStack(spacing: 0) {
            ZStack {
                GameSurface(model: model).background(.black)
                if model.loading { ProgressView("Loading local game…").padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)) }
            }
            .frame(width: min(geometry.size.width - 32, geometry.size.height * 0.38 * 1.5), height: min((geometry.size.width - 32) / 1.5, geometry.size.height * 0.38))
            .clipShape(RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(.separator))
            .padding(.top, 8)
            // The runtime stays mounted while changing tabs; detaching a WKWebView
            // suspends its timers even while the app remains in the foreground.
        TabView(selection: $model.selectedTab) {
            NavigationStack { play.navigationTitle("FireRed").navigationBarTitleDisplayMode(.inline).toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button { model.muted.toggle(); if model.muted { model.audio.stop() } else { model.audio.active = true } } label: { Image(systemName: model.muted ? "speaker.slash" : "speaker.wave.2") }.accessibilityLabel(model.muted ? "Unmute game" : "Mute game") }
            } }.tabItem { Label("Play", systemImage: "gamecontroller") }.tag(0)
            NavigationStack { bot.navigationTitle("Bot settings").navigationBarTitleDisplayMode(.inline) }.tabItem { Label("Bot", systemImage: "slider.horizontal.3") }.tag(1)
            NavigationStack { trading.navigationTitle("Trading").navigationBarTitleDisplayMode(.inline) }.tabItem { Label("Trading", systemImage: "arrow.left.arrow.right") }.tag(2)
        }
        }.frame(maxWidth: .infinity)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { result in
            switch result { case .success(let url): model.importROM(url); case .failure(let error): model.message = error.localizedDescription }
        }
        .alert("Pokémon Suite", isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) { Button("OK") { model.message = nil } } message: { Text(model.message ?? "") }
        .confirmationDialog("Create another adventure?", isPresented: $confirmNew, titleVisibility: .visible) {
            Button("Keep save and create adventure") { model.newAdventure() }
        } message: { Text("The current checkpoint will stay in the local Adventures folder.") }
    }
    private var play: some View {
        VStack(spacing: 12) {
            if !model.hasROM {
                ContentUnavailableView { Label("Add FireRed", systemImage: "gamecontroller") } description: { Text("Import your FireRed US revision 1 ROM. Your game and saves stay on this device.") } actions: { Button("Import ROM") { importing = true }.buttonStyle(.borderedProminent) }
            } else {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.trainer?["name"] as? String ?? "FireRed adventure").font(.headline)
                        Text(model.mode == "bot" ? "Bot playing on this device" : model.mode == "manual" ? "Manual play" : "Ready on this device").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Manual", systemImage: "hand.tap") { model.manual() }.labelStyle(.iconOnly).accessibilityLabel("Manual play").disabled(model.loading)
                    Button("Bot settings", systemImage: "slider.horizontal.3") { model.selectedTab = 1 }.labelStyle(.iconOnly)
                    Button("Pause and save", systemImage: "pause.fill") { model.pause() }.labelStyle(.iconOnly).disabled(!["bot", "manual"].contains(model.mode))
                }.padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                Controller(model: model).disabled(model.mode != "manual")
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if let task = model.status["decision"] as? String { Text(task.replacingOccurrences(of: "-", with: " ")).font(.subheadline) }
                        if let party = model.trainer?["party"] as? [[String: Any]], !party.isEmpty {
                            ForEach(Array(party.enumerated()), id: \.offset) { _, mon in
                                HStack { Text(mon["nickname"] as? String ?? "Pokémon"); Spacer(); Text("Lv. \(mon["level"] as? Int ?? 0)"); Text("\(mon["hp"] as? Int ?? 0)/\(mon["maxHp"] as? Int ?? 0) HP").monospacedDigit() }.font(.subheadline)
                            }
                        }
                        LabeledContent("Frames", value: "\(model.status["frame"] as? Int ?? 0)")
                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }.scrollIndicators(.visible).overlay(RoundedRectangle(cornerRadius: 12).stroke(.separator))
            }
        }.padding(.horizontal, 16).padding(.bottom, 8)
    }
    private var bot: some View {
        Form {
            Section("Adventure") {
                if model.campaign == nil {
                    Picker("Starter", selection: $starter) { Text("Random").tag("random"); Text("Bulbasaur").tag("bulbasaur"); Text("Charmander").tag("charmander"); Text("Squirtle").tag("squirtle") }
                    LabeledContent("Team", value: "Random adventure")
                    Button("Choose team") { model.prepare(starter: starter) }.disabled(!model.hasROM || model.loading || model.status.isEmpty)
                } else {
                    if let team = model.campaign?["team"] as? [[String: Any]] {
                        ForEach(Array(team.enumerated()), id: \.offset) { _, mon in Text(mon["label"] as? String ?? mon["name"] as? String ?? "Species \(mon["species"] as? Int ?? 0)") }
                    }
                    Button(model.mode == "bot" ? "Pause and save" : "Start bot") { if model.mode == "bot" { model.pause() } else { model.start() } }.disabled(model.loading)
                        .accessibilityValue("\(model.status["decisions"] as? Int ?? 0) decisions")
                }
            }
            Section("Current task") {
                LabeledContent("Status", value: model.mode.capitalized)
                if let objective = model.campaign?["objective"] as? [String: Any] { Text(objective["id"] as? String ?? "Starting adventure") }
                Text(model.status["decision"] as? String ?? "Waiting for your command").foregroundStyle(.secondary)
                LabeledContent("Decisions", value: "\(model.status["decisions"] as? Int ?? 0)")
                    .accessibilityElement(children: .ignore).accessibilityLabel("Decisions")
                    .accessibilityValue("\(model.status["decisions"] as? Int ?? 0)").accessibilityIdentifier("suite.decisions")
            }
            Section("Local saves") {
                Button("Create another adventure") { confirmNew = true }.disabled(!model.hasROM || model.loading)
                Button("Import ROM") { importing = true }.disabled(model.mode == "bot" || model.mode == "manual")
                Text("Each device keeps its own game. The bot pauses and checkpoints when you leave the app.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
    private var trading: some View {
        Form {
            Section("Switch and Switch 2") {
                Label("Direct trading unavailable", systemImage: "antenna.radiowaves.left.and.right.slash")
                Text("FireRed runs on this device. The Archer adapter cannot provide console trading through this app yet.").foregroundStyle(.secondary)
            }
            Section("Archer T3U") {
                LabeledContent("Adapter identity", value: "2357:012d")
                Text(UIDevice.current.userInterfaceIdiom == .pad ? "The M-series iPad USB probe only checks adapter access. Apple does not document a supported Wi-Fi driver path for this adapter; the probe does not enable trading." : "iOS does not support installing a USB Wi-Fi driver for this adapter on iPhone.")
            }
        }
    }
}

struct Controller: View {
    @ObservedObject var model: MobileModel
    private func key(_ label: String, _ value: String, symbol: Bool = false) -> some View {
        Group { if symbol { Image(systemName: label) } else { Text(label).fontWeight(.semibold) } }
            .frame(minWidth: 44, minHeight: 44).background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle()).gesture(DragGesture(minimumDistance: 0).onChanged { _ in model.press(value, down: true) }.onEnded { _ in model.press(value, down: false) })
            .accessibilityLabel(value.capitalized).accessibilityAddTraits(.isButton)
            .accessibilityAction { model.press(value, down: true); DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { model.press(value, down: false) } }
    }
    var body: some View {
        VStack(spacing: 4) {
            HStack { key("L", "l"); Spacer(); key("R", "r") }
            HStack {
                VStack(spacing: 2) { key("chevron.up", "up", symbol: true); HStack(spacing: 2) { key("chevron.left", "left", symbol: true); key("chevron.down", "down", symbol: true); key("chevron.right", "right", symbol: true) } }
                Spacer(minLength: 12)
                key("B", "b"); key("A", "a")
            }
            HStack { Spacer(); key("Select", "select"); key("Start", "start"); Spacer() }
        }.onDisappear { model.releaseButtons() }
    }
}
