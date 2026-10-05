import AppKit
import SwiftUI
import SuiteCore

struct LiveView: View {
    @EnvironmentObject var model: SuiteModel
    @ObservedObject var playback: GamePlayback
    @State private var focusRequest = 0
    @State private var section = "Team"
    private var platform: String { model.game["platform"].string }
    private var advancedControls: Bool { ["3ds", "switch"].contains(platform) }
    private var gameButtons: [String] {
        ["up", "down", "left", "right", "a", "b"] + (["gb", "gbc"].contains(platform) ? [] : ["l", "r"]) + (["nds", "3ds", "switch"].contains(platform) ? ["x", "y"] : [])
    }
    var body: some View {
        SuiteSplit(leadingFraction: 0.60) {
            VStack(spacing: 12) {
                GameScreenFrame(ratio: GameScreenGeometry.ratio(image: playback.image, platform: platform)) { screen }.layoutPriority(1)
                HStack {
                    if model.session["state"].string == "reconnecting" { Text("Updating game status…").font(.caption).foregroundStyle(.secondary) }
                    else if !playback.message.isEmpty && playback.image != nil { Text(playback.message).font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if model.manual {
                        InfoButton(title: "Game controls", message: "Move: arrows or WASD\nA: Z   B: X   X: C   Y: V\nL: Q   R: E   ZL: F   ZR: G\nStart: Return   Select: Space\n3DS / Switch sticks: WASD and IJKL\nDS / 3DS: click or drag on the lower screen\nControllers: right face button is A; bottom is B.\nFocus Game enables a connected controller.\nTab or Escape releases the game controls.")
                        Button("Focus Game") { focusRequest += 1 }.help("Tab or Escape releases the keyboard")
                    }
                    Button { playback.toggleSound() } label: { Label(playback.sound ? "Mute" : "Sound", systemImage: playback.sound ? "speaker.wave.2" : "speaker.slash") }.disabled(!model.gameRunning)
                }
                if model.manual {
                    HStack(spacing: 6) {
                        ForEach(gameButtons, id: \.self) { button in
                            HoldButton(title: button.capitalized, button: button, playback: playback).frame(maxWidth: .infinity)
                        }
                    }
                    HStack(spacing: 12) {
                        HoldButton(title: "Start", button: "start", playback: playback)
                        HoldButton(title: "Select", button: "select", playback: playback)
                        if advancedControls {
                            ForEach(platform == "switch" ? ["zl", "zr", "l3", "r3"] : ["zl", "zr"], id: \.self) { button in HoldButton(title: button.uppercased(), button: button, playback: playback) }
                        }
                    }
                    if advancedControls {
                        HStack(spacing: 24) { GameStick(title: "Left stick", offset: 0, playback: playback); GameStick(title: "Right stick", offset: 2, playback: playback) }
                    }
                }
                if !model.manual && model.gameRunning { SessionPanel() }
                Spacer(minLength: 0)
            }.padding(16)
        } trailing: {
            VStack(spacing: 0) {
                TrainerPanel().padding([.horizontal, .top], 12)
                SectionTabs(label: "Game information", items: ["Team", "Hunt", "Activity"], selection: $section)
                TitledScroll(title: section, symbol: section == "Team" ? "circle.grid.2x2" : section == "Hunt" ? "scope" : "list.bullet.rectangle") {
                    if section == "Team" { PartyPanel() }
                    else if section == "Hunt" { HuntDetailView() }
                    else {
                        VStack(alignment: .leading, spacing: 16) {
                            ActivityPanel()
                            Button("Bot Settings") { model.page = .bot }
                        }
                    }
                }.padding([.horizontal, .bottom], 12)
            }
        }
        .onDisappear { playback.releaseInput() }
    }
    /// The black game screen inside the bezel. The image keeps a 4-point inset that the
    /// keyboard and touch surface (GameKeyView) maps against.
    private var screen: some View {
        ZStack {
            Rectangle().fill(.black)
            if let image = playback.image {
                Image(decorative: image, scale: 1).resizable().interpolation(.none).aspectRatio(contentMode: .fit).padding(4)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "gamecontroller").font(.system(size: 40, weight: .light))
                    Text(playback.message).multilineTextAlignment(.center).frame(maxWidth: 320)
                    if model.installed && !model.gameRunning { Button("Start Game", action: model.startGame).buttonStyle(.borderedProminent).disabled(model.busy) }
                }.foregroundStyle(.white).padding()
            }
            if model.session["bot"]["awaitingCommand"].bool && model.session["observation"]["mode"].string == "boot" {
                VStack(spacing: 10) {
                    if SessionProgress.isBrandNewSave(model.session) {
                        Text("This save is brand new. Start a run and the bot plays the story from the beginning.")
                            .font(.callout).multilineTextAlignment(.center).frame(maxWidth: 320)
                        Button("New Run…") { model.openBotSection("New run") }.buttonStyle(.borderedProminent)
                            .help("Choose the starter and team, then the bot plays the story").accessibilityIdentifier("live-new-run")
                    }
                    HStack {
                        Button("Bot Settings") { model.page = .bot }
                        Button("Manual Play") { model.setManual(true) }
                    }
                }.disabled(model.busy).padding(20).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            }
            if model.manual { KeyboardSurface(playback: playback, platform: platform, focusRequest: focusRequest).frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .accessibilityElement(children: .contain).accessibilityLabel("Live game screen")
    }
    func duration(_ ms: Double) -> String { let seconds = Int(ms / 1000); return String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) }
}

func gameGoal(_ session: JSONValue) -> String? {
    if session["bot"]["runScope"].string == "campaign", let label = session["campaign"]["storyProgress"]["current"]["label"].string.nonempty { return label }
    let goal = session["bot"]["objective"]
    return goal.string.nonempty ?? goal["name"].string.nonempty ?? goal["label"].string.nonempty ?? goal["id"].string.nonempty?.replacingOccurrences(of: "-", with: " ").capitalized ?? session["mission"]["name"].string.nonempty
}

struct TrainerPanel: View {
    @EnvironmentObject var model: SuiteModel
    var trainer: JSONValue { model.session["spectator"]["trainer"] }
    var body: some View {
        GamePanel(title: "Trainer", symbol: "person.crop.square") { content }
    }
    private var content: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                if !trainer["gender"].isNull {
                    ROMAsset(kind: "trainer", key: ["GIRL","FEMALE","1"].contains(trainer["gender"].text.uppercased()) ? "female" : "male", size: 32, fallback: "person.crop.square", label: "Trainer portrait").accessibilityHidden(true)
                }
                Text(trainer["name"].string.nonempty ?? "Trainer").font(.title3.weight(.semibold))
                Spacer()
                Button(model.gameRunning ? "Stop Game" : "Start Game", action: model.gameRunning ? model.stopGame : model.startGame)
                    .disabled(model.busy || !model.installed).help(model.gameRunning ? "Save and close this game" : "Start the selected game")
            }
            HStack {
                Button(model.manual ? "End Manual Play" : "Manual Play") { model.setManual(!model.manual) }.disabled(model.busy || !model.gameRunning)
                Button("Bot Settings") { model.page = .bot }
                Spacer(minLength: 0)
                Button("Save", action: model.saveGame).disabled(!model.gameRunning || model.busy).accessibilityLabel("Save Game")
            }
            LabeledContent("Location", value: model.session["observation"]["mode"].string == "boot" ? "Game startup" : model.session["spectator"]["map"]["name"].string.nonempty ?? model.session["observation"]["map"].text)
            HStack {
                LabeledContent("Money", value: trainer["money"].isNull ? "—" : trainer["money"].int.formatted())
                Spacer(minLength: 20)
                LabeledContent("Caught", value: trainer["pokedex"]["owned"].isNull ? "—" : trainer["pokedex"]["owned"].text)
                    .help("\(trainer["pokedex"]["seen"].text) Pokémon seen")
            }.font(.callout)
            let badges = model.session["spectator"]["badges"].array
            if !badges.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(badges.enumerated()), id: \.offset) { index, badge in
                        ROMAsset(kind: "badges", key: String(index), size: 20, fallback: "seal", label: "\(badge["label"].string), \(badge["earned"].bool ? "earned" : "not earned")")
                            .opacity(badge["earned"].bool ? 1 : 0.3).help(badge["label"].string)
                    }
                }
            }
        }
    }
}

/// What the bot is doing, under the game screen: status, goal and why it waits (details stay in Activity).
struct SessionPanel: View {
    @EnvironmentObject var model: SuiteModel
    private var status: BotRunStatus { BotRunStatus(session: model.session) }
    var body: some View {
        let session = model.session
        let headline = ActivityPresentation(session: session, catalog: model.dex, now: .now).headline ?? gameGoal(session)
        let reason = session["bot"]["reason"].string
        GamePanel(title: "Session", symbol: "hourglass") {
            Label(status.label, systemImage: status == .blocked ? "exclamationmark.circle" : status == .running ? "play.circle" : status == .waiting ? "hourglass" : status == .ready ? "checkmark.circle" : "pause.circle")
                .font(.headline)
            if let headline { Text(headline).font(.callout).lineLimit(2).help(headline) }
            if !reason.isEmpty && reason != headline && [.waiting, .blocked, .ready, .paused].contains(status) {
                Text(reason).font(.callout).foregroundStyle(.secondary).lineLimit(3).help(reason)
            }
        }.accessibilityIdentifier("live-session")
    }
}

struct PartyPanel: View {
    @EnvironmentObject var model: SuiteModel
    var party: [JSONValue] { let party = model.session["spectator"]["party"].array; return party.isEmpty ? model.session["observation"]["party"].array : party }
    var body: some View {
        if party.isEmpty { Text("No team loaded").foregroundStyle(.secondary) }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 168), spacing: 8)], spacing: 8) {
            ForEach(Array(party.enumerated()), id: \.offset) { index, pokemon in PartyTile(index: index, pokemon: pokemon) }
        }
    }
}

/// One team member: sprite, level, HP and EXP meters. Clicking shows the details the row used to hide behind an info button.
struct PartyTile: View {
    @EnvironmentObject var model: SuiteModel
    let index: Int
    let pokemon: JSONValue
    @State private var details = false
    private var item: JSONValue { pokemon["heldItem"] }
    private var itemID: Int { item["id"].isNull ? item.int : item["id"].int }
    private var itemName: String { itemID == 0 ? "None" : item["name"].string.nonempty ?? CartridgeItem.name(nativeID: itemID, catalog: model.dex["heldItems"].array) ?? "Unknown" }
    private var name: String { pokemon["speciesName"].string.nonempty ?? "Pokémon \(pokemon["species"].text)" }
    private var member: PartyMemberPresentation { PartyMemberPresentation(member: pokemon, index: index) }
    private var hpReading: String { member.hp.flatMap { hp in member.maxHP.map { "\(hp)/\($0) HP" } } ?? "HP unknown" }
    /// EXP progress below level 100 only; at 100 there is nothing left to fill.
    private var experience: Double? { (member.level ?? 100) < 100 ? member.experienceRatio : nil }
    private var experienceReading: String {
        if (member.level ?? 0) >= 100 { return "Maximum level" }
        return member.experienceRemaining.map { "\($0.formatted()) XP to next level" } ?? "Unknown"
    }
    var body: some View {
        Button { details.toggle() } label: {
            HStack(alignment: .top, spacing: 8) {
                ROMSprite(id: pokemon["speciesId"].isNull ? pokemon["species"].int : pokemon["speciesId"].int, shiny: pokemon["shiny"].bool, size: 44).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(name).fontWeight(.semibold).lineLimit(1)
                        Spacer(minLength: 2)
                        if itemID > 0 { ROMAsset(kind: "item", key: String(itemID), size: 16, fallback: "shippingbox", label: "Holds \(itemName)").help(itemName) }
                    }
                    Text("Lv. \(pokemon["level"].text)").font(.caption).foregroundStyle(.secondary)
                    GameMeter(value: member.hpRatio, color: GameMeter.hpColor(member.hpRatio ?? 0), label: "Health", reading: hpReading)
                    HStack {
                        Text(hpReading).monospacedDigit()
                        Spacer(minLength: 2)
                        if let status = member.status { Text(status).fontWeight(.semibold).foregroundStyle(.orange) }
                    }.font(.caption2).foregroundStyle(.secondary)
                    if let experience {
                        HStack(spacing: 4) {
                            Text("EXP").font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary).accessibilityHidden(true)
                            GameMeter(value: experience, color: GameMeter.experienceColor, label: "Experience to next level", reading: experienceReading, height: 3)
                        }
                    }
                }
            }.padding(8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(.plain).gameTile(selected: details)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), level \(pokemon["level"].text), \(hpReading)\(member.status.map { ", " + $0 } ?? "")")
            .accessibilityHint("Shows held item and experience").accessibilityAddTraits(.isButton)
            .help("\(name): click for details")
            .popover(isPresented: $details, arrowEdge: .leading) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(index + 1). \(name)").font(.headline)
                    LabeledContent("Level", value: pokemon["level"].text)
                    LabeledContent("HP", value: hpReading)
                    if let status = member.status { LabeledContent("Status", value: status) }
                    LabeledContent("Held item", value: itemName)
                    LabeledContent("Experience", value: experienceReading)
                }.padding(16).frame(width: 280)
            }
    }
}

struct KeyboardSurface: NSViewRepresentable {
    let playback: GamePlayback
    let platform: String
    var focusRequest: Int
    func makeNSView(context: Context) -> GameKeyView {
        let view = GameKeyView(); view.playback = playback
        view.setAccessibilityElement(true)
        view.setAccessibilityRole(.group)
        view.setAccessibilityLabel("Game screen")
        view.setAccessibilityHelp("Press to focus game controls. Tab or Escape releases the keyboard.")
        view.setAccessibilityIdentifier("game-keyboard")
        return view
    }
    func updateNSView(_ view: GameKeyView, context: Context) {
        view.playback = playback
        view.platform = platform
        if focusRequest != view.focusRequest {
            view.focusRequest = focusRequest
            DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        }
    }
    static func dismantleNSView(_ view: GameKeyView, coordinator: ()) { view.releaseKeys() }
}

final class GameKeyView: NSView {
    weak var playback: GamePlayback?
    var focusRequest = 0
    private var keyboard = GameKeyboard()
    private let controller = GameControllerInput()
    var platform = "gba" { didSet { if platform != oldValue { releaseKeys(); keyboard = GameKeyboard(platform: platform) } } }
    private var touching = false
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) { window?.makeFirstResponder(self); updateTouch(event, beginning: true) }
    override func mouseDragged(with event: NSEvent) { if touching { updateTouch(event, beginning: false) } }
    override func mouseUp(with event: NSEvent) { touching = false; playback?.releaseInput(source: "touch") }
    private func updateTouch(_ event: NSEvent, beginning: Bool) {
        let point = convert(event.locationInWindow, from: nil)
        let touch = GameTouch.at(x: point.x - 4, y: bounds.height - point.y - 4, width: bounds.width - 8, height: bounds.height - 8, platform: platform)
        if beginning { touching = touch != nil }
        playback?.updateInput(GameInputState(touch: touch), source: "touch")
    }
    override func accessibilityPerformPress() -> Bool { window?.makeFirstResponder(self) ?? false }
    override func becomeFirstResponder() -> Bool {
        needsDisplay = true
        if let playback { controller.start(playback: playback) { [weak self] in guard let self else { return false }; return self.window?.isKeyWindow == true && self.window?.firstResponder === self } }
        return true
    }
    override func draw(_ dirtyRect: NSRect) {
        if window?.firstResponder === self { NSColor.keyboardFocusIndicatorColor.setStroke(); let outline = NSBezierPath(rect: bounds.insetBy(dx: 3, dy: 3)); outline.lineWidth = 3; outline.stroke() }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 48 || event.keyCode == 53 {
            releaseKeys()
            if event.modifierFlags.contains(.shift) { window?.selectPreviousKeyView(self) }
            else { window?.selectNextKeyView(self) }
            if window?.firstResponder === self { window?.makeFirstResponder(nil) }
            return
        }
        guard !event.modifierFlags.contains(.command), !event.modifierFlags.contains(.option), !event.modifierFlags.contains(.control) else { super.keyDown(with: event); return }
        if let keys = keyboard.update(keyCode: event.keyCode, pressed: true) { playback?.input(keys) } else { super.keyDown(with: event) }
    }
    override func keyUp(with event: NSEvent) { if let keys = keyboard.update(keyCode: event.keyCode, pressed: false) { playback?.input(keys) } }
    override func resignFirstResponder() -> Bool { releaseKeys(); needsDisplay = true; return super.resignFirstResponder() }
    override func viewDidMoveToWindow() {
        NotificationCenter.default.removeObserver(self)
        if let window { NotificationCenter.default.addObserver(self, selector: #selector(releaseKeys), name: NSWindow.didResignKeyNotification, object: window) }
    }
    @objc func releaseKeys() { _ = keyboard.releaseAll(); touching = false; controller.stop(); playback?.releaseInput() }
    deinit { NotificationCenter.default.removeObserver(self) }
}

/// A real Mac button supports pointer holds, keyboard activation, and VoiceOver presses.
struct HoldButton: NSViewRepresentable {
    let title: String
    let button: String
    let playback: GamePlayback
    func makeNSView(context: Context) -> GamePadButton {
        let view = GamePadButton(title: title, target: nil, action: nil)
        view.bezelStyle = .rounded; view.setButtonType(.momentaryPushIn)
        view.target = view; view.action = #selector(GamePadButton.activate)
        view.setAccessibilityLabel("Game " + title)
        view.toolTip = "Hold to press " + title + " in the game"
        return view
    }
    func updateNSView(_ view: GamePadButton, context: Context) { view.playback = playback; view.gameButton = button }
    static func dismantleNSView(_ view: GamePadButton, coordinator: ()) { view.release() }
}
final class GamePadButton: NSButton {
    weak var playback: GamePlayback?
    var gameButton = ""
    private var held = false
    private var pulse: Task<Void, Never>?
    override func mouseDown(with event: NSEvent) {
        pulse?.cancel(); held = true; playback?.input([gameButton], source: "button-" + gameButton)
        super.mouseDown(with: event)
        held = false; playback?.releaseInput(source: "button-" + gameButton)
    }
    @objc func activate() {
        guard !held else { return }
        pulse?.cancel(); playback?.input([gameButton], source: "button-" + gameButton)
        pulse = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(150)) } catch { return }
            guard let self else { return }; self.playback?.releaseInput(source: "button-" + self.gameButton)
        }
    }
    func release() { pulse?.cancel(); playback?.releaseInput(source: "button-" + gameButton) }
}
