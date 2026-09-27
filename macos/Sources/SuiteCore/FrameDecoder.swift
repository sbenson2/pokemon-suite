import Foundation

public struct GameFrame: Sendable {
    public let width: Int
    public let height: Int
    public let pixels: Data
}

public struct FrameDecoder {
    private var pending = Data()
    public init() {}
    public mutating func append(_ bytes: Data) throws -> GameFrame? {
        guard pending.count + bytes.count <= 96 * 1024 * 1024 else { throw SuiteError("The game frame stream exceeded its buffer limit.") }
        pending.append(bytes)
        var offset = 0
        var latest: GameFrame?
        func word(_ start: Int, _ length: Int) -> Int {
            pending[(pending.startIndex + start)..<(pending.startIndex + start + length)].reduce(0) { ($0 << 8) | Int($1) }
        }
        while pending.count - offset >= 16 {
            let width = word(offset + 4, 2), height = word(offset + 6, 2), length = word(offset + 8, 4)
            guard word(offset, 4) == 0x4d524631, (1...4096).contains(width), (1...4096).contains(height), length == width * height * 4 else {
                pending.removeAll()
                throw SuiteError("The emulator sent an invalid game frame.")
            }
            guard pending.count - offset >= 16 + length else { break }
            latest = GameFrame(width: width, height: height, pixels: pending.subdata(in: offset + 16..<offset + 16 + length))
            offset += 16 + length
        }
        if offset > 0 { pending = Data(pending.dropFirst(offset)) }
        return latest
    }
}
