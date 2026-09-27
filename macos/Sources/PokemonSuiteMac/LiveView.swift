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
                GeometryReader { geometry in
                    ZStack {
                        Rectangle().fill(.black)
                        if let image = playback.image {
                            Image(decorative: image, scale: 1).resizable().interpolation(.none).aspectRatio(contentMode: .fit).padding(4)
                        } else {
                            VStack(spacing: 12) {
                                Image(systemName: "gamecontroller").font(.system(size: 40, weight: .light))
                                Text(playback.message).multilineTextAlignment(.center).frame(maxWidth: 320)
                                if model.installed && !model.gameRunning { Button("Start Game", action: model.startGame).buttonStyle(.borderedProminent).disabled(model.busy) }
                            }.foregroundStyle(.white)
                        }
                        if model.session["bot"]["awaitingCommand"].bool && model.session["observation"]["mode"].string == "boot" {
                            HStack {
                                Button("Bot Settings") { model.page = .bot }
                                Button("Manual Play") { model.setManual(true) }
                            }.disabled(model.busy).padding(20).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                        }
                        if model.manual { KeyboardSurface(playback: playback, platform: platform, focusRequest: focusRequest).frame(maxWidth: .infinity, maxHeight: .infinity) }
                    }.frame(width: geometry.size.width, height: geometry.size.height)
                }
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
            }.padding(16)
        } trailing: {
            VStack(spacing: 0) {
                TrainerPanel().padding(16)
                SectionTabs(label: "Game information", items: ["Team", "Hunt", "Activity"], selection: $section)
                BorderedScroll {
                    if section == "Team" { PartyPanel() }
                    else if section == "Hunt" { HuntDetailView() }
                    else {
                        VStack(alignment: .leading, spacing: 16) {
                            ActivityPanel()
                            Button("Bot Settings") { model.page = .bot }
                        }
                    }
                }
            }
        }
        .onDisappear { playback.releaseInput() }
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

struct PartyPanel: View {
    @EnvironmentObject var model: SuiteModel
    var party: [JSONValue] { let party = model.session["spectator"]["party"].array; return party.isEmpty ? model.session["observation"]["party"].array : party }
    var body: some View {
        VStack(spacing: 12) {
            if party.isEmpty { Text("No team loaded").foregroundStyle(.secondary) }
            ForEach(Array(party.enumerated()), id: \.offset) { index, pokemon in
                let item = pokemon["heldItem"]
                let itemID = item["id"].isNull ? item.int : item["id"].int
                HStack(spacing: 8) {
                    Text(String(index + 1)).font(.caption).foregroundStyle(.secondary)
                    ROMSprite(id: pokemon["speciesId"].isNull ? pokemon["species"].int : pokemon["speciesId"].int, shiny: pokemon["shiny"].bool, size: 40).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(pokemon["speciesName"].string.nonempty ?? "Pokémon \(pokemon["species"].text)").fontWeight(.medium)
                            Spacer(); Text("Lv. \(pokemon["level"].text)").font(.caption).foregroundStyle(.secondary)
                        }
                        Gauge(value: Double(max(0, pokemon["hp"].int)), in: 0...Double(max(1, pokemon["maxHp"].int))) { EmptyView() }.controlSize(.small).accessibilityLabel("Health").accessibilityValue("\(pokemon["hp"].text) of \(pokemon["maxHp"].text)")
                        if let ratio = pokemon["experience"]["ratio"].finiteNumber, pokemon["level"].int < 100 {
                            ProgressView(value: max(0, min(1, ratio))).tint(.cyan).accessibilityLabel("Experience to next level").accessibilityValue("\(pokemon["experience"]["remaining"].text) XP remaining")
                        }
                        HStack {
                            Text("\(pokemon["hp"].text)/\(pokemon["maxHp"].text) HP")
                            Spacer()
                            if !["", "OK", "NONE", "HEALTHY"].contains(pokemon["status"].string.uppercased()) { Text(pokemon["status"].string) }
                        }.font(.caption).foregroundStyle(.secondary)
                    }
                    if itemID > 0 { ROMAsset(kind: "item", key: String(itemID), size: 20, fallback: "shippingbox").help(item["name"].string.nonempty ?? CartridgeItem.name(nativeID: itemID, catalog: model.dex["heldItems"].array) ?? "Held item") }
                    InfoButton(title: "\(pokemon["speciesName"].string.nonempty ?? "Pokémon \(index + 1)") details", message: "Held item: \(itemID == 0 ? "None" : item["name"].string.nonempty ?? CartridgeItem.name(nativeID: itemID, catalog: model.dex["heldItems"].array) ?? "Unknown")\n" + (pokemon["experience"].isNull ? "" : pokemon["level"].int >= 100 ? "Maximum level" : "\(pokemon["experience"]["remaining"].int.formatted()) XP to next level"))
                }
            }
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
