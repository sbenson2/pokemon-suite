import Foundation

public struct GameKeyboard {
    private var keys = Set<UInt16>()
    private let platform: String
    private static let bindings: [UInt16: String] = [
        126:"up",125:"down",123:"left",124:"right",13:"up",1:"down",0:"left",2:"right",
        6:"a",7:"b",12:"l",14:"r",36:"start",49:"select"
    ]
    public init(platform: String = "gba") { self.platform = platform }
    private var bindings: [UInt16: String] {
        var result = Self.bindings
        if ["nds", "3ds", "switch"].contains(platform) { result[8] = "x"; result[9] = "y" }
        if ["3ds", "switch"].contains(platform) {
            result.merge([13:"ls-up",1:"ls-down",0:"ls-left",2:"ls-right",34:"rs-up",40:"rs-down",38:"rs-left",37:"rs-right",3:"zl",5:"zr"]) { _, new in new }
        }
        return result
    }
    public mutating func update(keyCode: UInt16, pressed: Bool) -> [String]? {
        guard bindings[keyCode] != nil else { return nil }
        if pressed { keys.insert(keyCode) } else { keys.remove(keyCode) }
        return Array(Set(keys.compactMap { bindings[$0] })).sorted()
    }
    public mutating func releaseAll() -> [String] { keys.removeAll(); return [] }
}
