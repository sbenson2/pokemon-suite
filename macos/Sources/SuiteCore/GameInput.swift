import Foundation

public struct GameTouch: Equatable, Sendable {
    public var x: Int, y: Int
    public init(x: Int, y: Int) { self.x = x; self.y = y }
    /// Coordinates use the fitted video surface, with its origin at the top left.
    public static func at(x: Double, y: Double, width: Double, height: Double, platform: String) -> GameTouch? {
        guard [x, y, width, height].allSatisfy(\.isFinite), width > 0, height > 0 else { return nil }
        let three = platform == "3ds"
        guard three || platform == "nds" else { return nil }
        let videoWidth = three ? 400.0 : 256.0, videoHeight = three ? 480.0 : 384.0
        let scale = min(width / videoWidth, height / videoHeight)
        let px = (x - (width - videoWidth * scale) / 2) / scale - (three ? 40 : 0)
        let py = (y - (height - videoHeight * scale) / 2) / scale - videoHeight / 2
        guard px >= 0, py >= 0, px < (three ? 320 : 256), py < videoHeight / 2 else { return nil }
        return GameTouch(x: Int(px), y: Int(py))
    }
}

public struct GameInputState: Equatable, Sendable {
    public var buttons: [String]
    public var axes: [Double]
    public var touch: GameTouch?
    public init(buttons: [String] = [], axes: [Double] = [0, 0, 0, 0], touch: GameTouch? = nil) {
        self.buttons = Array(Set(buttons)).sorted()
        self.axes = (0..<4).map { index in
            guard axes.indices.contains(index), axes[index].isFinite, abs(axes[index]) > 0.15 else { return 0 }
            return max(-1, min(1, axes[index]))
        }
        self.touch = touch
    }
    public var isActive: Bool { !buttons.isEmpty || touch != nil || axes.contains { $0 != 0 } }
    public func payload(game: String, platform: String) -> JSONValue {
        let advanced = platform == "3ds" || platform == "switch"
        var allowed: Set<String> = ["up", "down", "left", "right", "a", "b", "start", "select"]
        if !["gb", "gbc"].contains(platform) { allowed.formUnion(["l", "r"]) }
        if advanced || platform == "nds" { allowed.formUnion(["x", "y"]) }
        if advanced { allowed.formUnion(["zl", "zr", "ls-up", "ls-down", "ls-left", "ls-right", "rs-up", "rs-down", "rs-left", "rs-right"]) }
        if platform == "switch" { allowed.formUnion(["l3", "r3"]) }
        var buttons = Set(buttons).intersection(allowed)
        let prefixes = advanced ? ["ls-", "rs-"] : [""]
        for (index, prefix) in prefixes.enumerated() {
            let x = axes[index * 2], y = axes[index * 2 + 1]
            if platform != "switch" {
                if x < -0.2 { buttons.insert(prefix + "left") }; if x > 0.2 { buttons.insert(prefix + "right") }
                if y < -0.2 { buttons.insert(prefix + "up") }; if y > 0.2 { buttons.insert(prefix + "down") }
            }
        }
        var body: JSONValue = .object(["game": .string(game), "buttons": .array(buttons.sorted().map(JSONValue.string))])
        if platform == "nds" || platform == "3ds" {
            body["touch"] = .object(["x": .number(Double(touch?.x ?? 0)), "y": .number(Double(touch?.y ?? 0)), "pressed": .bool(touch != nil)])
        }
        if platform == "switch" { body["axes"] = .array(axes.map(JSONValue.number)) }
        return body
    }
}

public struct GameInputSources {
    private var sources: [String: GameInputState] = [:]
    public init() {}
    public mutating func update(_ source: String, value: GameInputState) {
        if value.isActive { sources[source] = value } else { sources.removeValue(forKey: source) }
    }
    public mutating func releaseAll() { sources.removeAll() }
    public var merged: GameInputState {
        let values = sources.keys.sorted().compactMap { sources[$0] }
        return GameInputState(buttons: values.flatMap(\.buttons), axes: (0..<4).map { index in values.map { $0.axes[index] }.max(by: { abs($0) < abs($1) }) ?? 0 }, touch: values.compactMap(\.touch).first)
    }
}
