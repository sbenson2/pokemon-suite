import AppKit
import GameController
import SwiftUI
import SuiteCore

/// Poll only while the manual game surface owns focus. Apple normalizes physical
/// devices to an extended profile; positions below retain Nintendo's A/B layout.
@MainActor final class GameControllerInput {
    private var task: Task<Void, Never>?
    private weak var playback: GamePlayback?
    func start(playback: GamePlayback, focused: @escaping () -> Bool) {
        stop(); self.playback = playback
        task = Task { [weak playback] in
            while !Task.isCancelled {
                guard let playback else { return }
                if focused(), NSApp.isActive, playback.manual, let pad = GCController.controllers().first(where: { $0.extendedGamepad != nil })?.extendedGamepad {
                    let bindings: [(String, GCControllerButtonInput?)] = [
                        ("b", pad.buttonA), ("a", pad.buttonB), ("y", pad.buttonX), ("x", pad.buttonY),
                        ("up", pad.dpad.up), ("down", pad.dpad.down), ("left", pad.dpad.left), ("right", pad.dpad.right),
                        ("l", pad.leftShoulder), ("r", pad.rightShoulder), ("zl", pad.leftTrigger), ("zr", pad.rightTrigger),
                        ("start", pad.buttonMenu), ("select", pad.buttonOptions), ("l3", pad.leftThumbstickButton), ("r3", pad.rightThumbstickButton)
                    ]
                    let buttons = bindings.filter { $0.1?.isPressed == true }.map(\.0)
                    let axes = [Double(pad.leftThumbstick.xAxis.value), -Double(pad.leftThumbstick.yAxis.value), Double(pad.rightThumbstick.xAxis.value), -Double(pad.rightThumbstick.yAxis.value)]
                    playback.updateInput(GameInputState(buttons: buttons, axes: axes), source: "controller")
                } else { playback.releaseInput(source: "controller") }
                do { try await Task.sleep(for: .milliseconds(33)) } catch { return }
            }
        }
    }
    func stop() { task?.cancel(); task = nil; playback?.releaseInput(source: "controller") }
    deinit { task?.cancel() }
}

struct GameStick: View {
    let title: String
    let offset: Int
    let playback: GamePlayback
    @State private var displacement = CGSize.zero
    @Environment(\.controlActiveState) private var activeState
    private var source: String { "stick-\(offset)" }
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(.quaternary).overlay { Circle().stroke(.separator) }
                Circle().fill(.secondary).frame(width: 20, height: 20).offset(displacement)
            }.frame(width: 56, height: 56).contentShape(Circle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                    let x = (value.location.x - 28) / 20, y = (value.location.y - 28) / 20
                    let length = max(1, hypot(x, y)), dx = x / length, dy = y / length
                    displacement = CGSize(width: dx * 18, height: dy * 18)
                    var axes = [0.0, 0, 0, 0]; axes[offset] = dx; axes[offset + 1] = dy
                    playback.updateInput(GameInputState(axes: axes), source: source)
                }.onEnded { _ in release() })
                .accessibilityLabel(title).accessibilityValue("Use keyboard or a connected controller")
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .onChange(of: activeState) { _, value in if value == .inactive { release() } }
        .onDisappear { release() }
    }
    private func release() { displacement = .zero; playback.releaseInput(source: source) }
}
